using System.Security.Principal;
using System.Text.Json;
using Microsoft.AspNetCore.Antiforgery;
using Vmangos.Accounts.Core;

namespace Vmangos.AdminPanel.Services;

public static class AccountEndpoints
{
    public static async Task HttpsGuard(HttpContext context, RequestDelegate next)
    {
        if (context.Request.Path.StartsWithSegments("/api/accounts", StringComparison.OrdinalIgnoreCase))
        {
            Headers(context);
            if (!context.Request.IsHttps) { await Error(context,400,"HTTPS_REQUIRED"); return; }
        }
        await next(context);
    }
    public static void MapAccounts(this WebApplication app)
    {
        app.MapGet("/api/accounts/capabilities", Capabilities);
        app.MapPost("/api/accounts/create", Create);
        app.MapGet("/api/accounts/operations/{operationId}", Status);
    }
    // No DTO parameter: Minimal API model binding cannot read the password before this guard.
    public static async Task Create(HttpContext context, IAccountGateway gateway, IAntiforgery antiforgery)
    {
        try { await CreateCore(context, gateway, antiforgery, WindowsOperatorSid); }
        catch { await Error(context, 503, "UNAVAILABLE"); } // Never log or return raw exceptions.
    }
    public static async Task CreateCore(HttpContext context, IAccountGateway gateway, IAntiforgery antiforgery,
        Func<HttpContext,string?> operatorSid)
    {
        Headers(context);
        if (!context.Request.IsHttps) { await Error(context,400,"HTTPS_REQUIRED"); return; }
        string? sid = operatorSid(context);
        if (sid is null || !AccountPolicy.ValidSid(sid)) { await Error(context,403,"FORBIDDEN"); return; }
        // A130 always refuses before body in the actual application, even if any configuration is edited.
        if (!gateway.Capabilities.Enabled) { await Error(context,503,"FEATURE_DISABLED"); return; }
        if (context.Request.QueryString.HasValue || context.Request.ContentType is not ("application/json" or "application/json; charset=utf-8") ||
            context.Request.Headers.ContentEncoding.Count != 0) { await Error(context,415,"JSON_REQUIRED"); return; }
        if (!context.Request.Headers.TryGetValue("X-VMANGOS-CSRF",out var csrf) || csrf.Count != 1 || string.IsNullOrEmpty(csrf[0]))
        { await Error(context,400,"CSRF_INVALID"); return; }
        try { await antiforgery.ValidateRequestAsync(context); }
        catch (AntiforgeryValidationException) { await Error(context,400,"CSRF_INVALID"); return; }
        if (context.Request.ContentLength is < 0 or > AccountPolicy.BodyByteCap) { await Error(context,413,"BODY_TOO_LARGE"); return; }
        byte[] buffer = new byte[AccountPolicy.BodyByteCap+1];
        try
        {
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
            deadline.CancelAfter(TimeSpan.FromSeconds(2));
            int used = 0;
            while (used < buffer.Length)
            {
                int count = await context.Request.Body.ReadAsync(buffer.AsMemory(used),deadline.Token);
                if (count == 0) break;
                used += count;
            }
            if (used > AccountPolicy.BodyByteCap) { await Error(context,413,"BODY_TOO_LARGE"); return; }
            if (!AccountPolicy.TryParse(buffer.AsMemory(0,used),out var request)) { await Error(context,400,"INVALID_REQUEST"); return; }
            using (request!)
            {
                AccountStatus result = await gateway.SubmitAsync(request!,sid,context.RequestAborted);
                int code = result.State switch
                {
                    AccountState.Succeeded => 201,
                    AccountState.AlreadyExists => 409,
                    AccountState.Running or AccountState.Unknown or AccountState.ReconciliationRequired or AccountState.SucceededAuditIncomplete => 202,
                    AccountState.FailedBeforeDispatch => 503,
                    _ => result.ErrorCode == AccountError.InvalidRequest ? 400 : 409
                };
                await Reply(context,code,SafeView(result));
            }
        }
        finally { Array.Clear(buffer); }
    }
    public static async Task Capabilities(HttpContext context, IAccountGateway gateway)
    {
        Headers(context);
        if (!context.Request.IsHttps) { await Error(context,400,"HTTPS_REQUIRED"); return; }
        if (WindowsOperatorSid(context) is null) { await Error(context,403,"FORBIDDEN"); return; }
        await Reply(context,200,new { enabled = gateway.Capabilities.Enabled, liveReady = false, mode = gateway.Capabilities.Mode });
    }
    public static async Task Status(HttpContext context, string operationId, IAccountGateway gateway)
    {
        Headers(context);
        if (!context.Request.IsHttps) { await Error(context,400,"HTTPS_REQUIRED"); return; }
        string? sid = WindowsOperatorSid(context);
        if (sid is null) { await Error(context,403,"FORBIDDEN"); return; }
        if (!Guid.TryParseExact(operationId,"D",out Guid id) || id == Guid.Empty) { await Error(context,404,"NOT_FOUND"); return; }
        try
        {
            AccountStatus? status = await gateway.GetAsync(id,sid,context.RequestAborted);
            if (status is null) { await Error(context,404,"NOT_FOUND"); return; }
            await Reply(context,200,SafeView(status));
        }
        catch { await Error(context,503,"UNAVAILABLE"); }
    }
    public static string? WindowsOperatorSid(HttpContext context)
    {
        if (!OperatingSystem.IsWindows() || context.User.Identity is not WindowsIdentity identity || !identity.IsAuthenticated) return null;
        var administrators = new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid,null);
        return new WindowsPrincipal(identity).IsInRole(administrators) ? identity.User?.Value : null;
    }
    public static void Headers(HttpContext context)
    {
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers.Pragma = "no-cache";
        context.Response.Headers["X-Content-Type-Options"] = "nosniff";
        context.Response.Headers["Referrer-Policy"] = "no-referrer";
    }
    public static Task Error(HttpContext context,int code,string error) => Reply(context,code,new { errorCode = error });
    private static object SafeView(AccountStatus s) => new
    { operationId = s.OperationId, accountName = s.AccountName, state = AccountStatus.StateText(s.State), errorCode = s.ErrorCode.ToString(),
        dispatchAttempts = s.DispatchAttempts, accountId = s.AccountId, requiresReconciliation = s.RequiresReconciliation };
    private static async Task Reply(HttpContext context,int code,object body)
    {
        context.Response.StatusCode = code;
        context.Response.ContentType = "application/json; charset=utf-8";
        await JsonSerializer.SerializeAsync(context.Response.Body,body,body.GetType());
    }
}
