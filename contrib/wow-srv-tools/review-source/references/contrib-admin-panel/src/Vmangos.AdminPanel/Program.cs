using Microsoft.AspNetCore.Antiforgery;
using System.Security.Principal;
using Vmangos.AdminPanel.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<RuntimeStatusService>();
builder.Services.AddSingleton<ControlAuditWriter>();
builder.Services.AddSingleton<TaskControlService>();
builder.Services.AddAntiforgery(options =>
{
    options.HeaderName = "X-VMANGOS-CSRF";
    options.Cookie.Name = "VMANGOS-CSRF";
    options.Cookie.HttpOnly = true;
    options.Cookie.SameSite = SameSiteMode.Strict;
    options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
});

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/status", (HttpContext httpContext, RuntimeStatusService statusService) =>
{
    var status = statusService.GetStatus();

    return Results.Ok(new
    {
        authenticated = httpContext.User.Identity?.IsAuthenticated ?? false,
        user = httpContext.User.Identity?.Name,
        status
    });
});

app.MapGet("/api/identity", (HttpContext httpContext) =>
{
    return Results.Ok(new
    {
        authenticated = httpContext.User.Identity?.IsAuthenticated ?? false,
        user = httpContext.User.Identity?.Name,
        authenticationType = httpContext.User.Identity?.AuthenticationType,
        controlAllowed = IsControlOperator(httpContext)
    });
});

app.MapGet("/api/csrf", (HttpContext httpContext, IAntiforgery antiforgery) =>
{
    if (!IsControlOperator(httpContext))
    {
        return Results.StatusCode(StatusCodes.Status403Forbidden);
    }

    var tokens = antiforgery.GetAndStoreTokens(httpContext);
    httpContext.Response.Headers.CacheControl = "no-store";

    return Results.Ok(new
    {
        requestToken = tokens.RequestToken
    });
});

app.MapPost("/api/actions/start-all", async (
    HttpContext httpContext,
    IAntiforgery antiforgery,
    TaskControlService controls) =>
{
    return await DispatchAsync(
        httpContext,
        antiforgery,
        (request, cancellationToken) => controls.StartAllAsync(request, cancellationToken));
});

app.MapPost("/api/actions/stop-all", async (
    HttpContext httpContext,
    IAntiforgery antiforgery,
    TaskControlService controls) =>
{
    return await DispatchAsync(
        httpContext,
        antiforgery,
        (request, cancellationToken) => controls.StopAllAsync(request, cancellationToken));
});

app.MapPost("/api/actions/restart-world", async (
    HttpContext httpContext,
    IAntiforgery antiforgery,
    TaskControlService controls) =>
{
    return await DispatchAsync(
        httpContext,
        antiforgery,
        (request, cancellationToken) => controls.RestartWorldAsync(request, cancellationToken));
});

app.MapFallbackToFile("index.html");

app.Run();

static bool IsControlOperator(HttpContext httpContext)
{
    if (httpContext.User.Identity?.IsAuthenticated != true ||
        !OperatingSystem.IsWindows() ||
        httpContext.User.Identity is not WindowsIdentity windowsIdentity)
    {
        return false;
    }

    var administratorsSid = new SecurityIdentifier(
        WellKnownSidType.BuiltinAdministratorsSid,
        domainSid: null);

    var windowsPrincipal = new WindowsPrincipal(windowsIdentity);
    return windowsPrincipal.IsInRole(administratorsSid);
}

static async Task<IResult> DispatchAsync(
    HttpContext httpContext,
    IAntiforgery antiforgery,
    Func<ControlRequestContext, CancellationToken, Task<ControlDispatchResult>> dispatch)
{
    if (!IsControlOperator(httpContext))
    {
        return Results.StatusCode(StatusCodes.Status403Forbidden);
    }

    try
    {
        await antiforgery.ValidateRequestAsync(httpContext);
    }
    catch (AntiforgeryValidationException)
    {
        return Results.BadRequest(new
        {
            ok = false,
            error = "Invalid anti-forgery token."
        });
    }

    var request = new ControlRequestContext(
        CorrelationId: Guid.NewGuid().ToString("N"),
        User: httpContext.User.Identity?.Name ?? "unknown",
        RemoteIp: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown");

    var result = await dispatch(request, httpContext.RequestAborted);

    if (!result.Accepted)
    {
        return Results.Problem(
            title: "VMaNGOS control dispatch failed",
            detail: result.Message,
            statusCode: StatusCodes.Status503ServiceUnavailable,
            extensions: new Dictionary<string, object?>
            {
                ["correlationId"] = result.CorrelationId,
                ["operation"] = result.Operation
            });
    }

    return Results.Accepted(
        value: new
        {
            ok = true,
            accepted = true,
            correlationId = result.CorrelationId,
            operation = result.Operation,
            message = result.Message
        });
}
