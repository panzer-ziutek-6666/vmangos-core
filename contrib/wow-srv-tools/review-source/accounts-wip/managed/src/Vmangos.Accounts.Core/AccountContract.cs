using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Vmangos.Accounts.Core;

// Deliberately not a record: generated ToString/JSON must never expose a password.
public sealed class PasswordSecret : IDisposable
{
    private char[]? _characters;
    public PasswordSecret(string value) => _characters = value.ToCharArray();
    public bool IsValid => _characters is { Length: >= 12 and <= 16 } &&
        _characters.All(c => c is >= 'A' and <= 'Z' or >= '0' and <= '9');
    public bool EqualsName(string name) => _characters is not null && _characters.AsSpan().SequenceEqual(name.AsSpan());
    public void Use(Action<ReadOnlyMemory<char>> consumer)
    {
        if (_characters is null) throw new ObjectDisposedException(nameof(PasswordSecret));
        consumer(_characters);
    }
    public override string ToString() => "[SECRET]";
    public void Dispose()
    {
        if (_characters is not null) Array.Clear(_characters);
        _characters = null;
    }
}

public sealed class CreateAccountRequest : IDisposable
{
    public Guid OperationId { get; }
    public string AccountName { get; }
    [JsonIgnore] public PasswordSecret Password { get; }
    public CreateAccountRequest(Guid operationId, string accountName, PasswordSecret password)
    { OperationId = operationId; AccountName = accountName; Password = password; }
    public override string ToString() => "CreateAccountRequest[REDACTED]";
    public void Dispose() => Password.Dispose();
}

public static class AccountPolicy
{
    public const int BodyByteCap = 2048;
    private static readonly HashSet<string> TechnicalNames = new(StringComparer.Ordinal)
    { "ADMIN", "ADMINISTRATOR", "CONSOLE", "SYSTEM", "SOAP", "COLLECTOR", "VMANGOS", "ROOT" };
    public static bool TryCanonicalName(string? raw, out string canonical)
    {
        canonical = "";
        if (raw is null || raw.Length is < 3 or > 16 ||
            raw.Any(c => !(c is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or >= '0' and <= '9'))) return false;
        canonical = raw.ToUpperInvariant();
        return !canonical.StartsWith("RNDBOT", StringComparison.Ordinal) && !TechnicalNames.Contains(canonical);
    }
    public static bool ValidSid(string? value)
    {
        if (value is null || value.Length is < 7 or > 184 || !value.StartsWith("S-1-", StringComparison.Ordinal)) return false;
        string[] parts = value[4..].Split('-');
        return parts.Length is >= 2 and <= 16 && parts.All(p => p.Length is >= 1 and <= 10 && p.All(char.IsAsciiDigit) && ulong.TryParse(p, out ulong n) && n <= uint.MaxValue);
    }
    public static bool Valid(CreateAccountRequest request) => request.OperationId != Guid.Empty &&
        TryCanonicalName(request.AccountName, out string name) && name == request.AccountName && request.Password.IsValid && !request.Password.EqualsName(name);

    public static bool TryParse(ReadOnlyMemory<byte> body, out CreateAccountRequest? request)
    {
        request = null;
        if (body.Length is 0 or > BodyByteCap) return false;
        try
        {
            using var document = JsonDocument.Parse(body, new JsonDocumentOptions { MaxDepth = 2 });
            var root = document.RootElement;
            if (!StrictJson.Shape(root, "operationId", "accountName", "password")) return false;
            if (!Guid.TryParseExact(root.GetProperty("operationId").GetString(), "D", out Guid id) || id == Guid.Empty ||
                !TryCanonicalName(root.GetProperty("accountName").GetString(), out string name)) return false;
            var secret = new PasswordSecret(root.GetProperty("password").GetString() ?? "");
            if (!secret.IsValid || secret.EqualsName(name)) { secret.Dispose(); return false; }
            request = new CreateAccountRequest(id, name, secret);
            return true;
        }
        catch (Exception error) when (error is JsonException or InvalidOperationException or ArgumentException)
        { return false; }
    }
}

public static class StrictJson
{
    public static bool Shape(JsonElement element, params string[] names)
    {
        if (element.ValueKind != JsonValueKind.Object) return false;
        var found = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in element.EnumerateObject())
            if (!names.Contains(property.Name, StringComparer.Ordinal) || !found.Add(property.Name) ||
                property.Value.ValueKind != JsonValueKind.String) return false;
        return found.Count == names.Length;
    }
}

public enum AccountState { Rejected, FailedBeforeDispatch, Running, AlreadyExists, Succeeded, Unknown, ReconciliationRequired, SucceededAuditIncomplete }
public enum AccountError { None, Disabled, InvalidRequest, Forbidden, Conflict, Busy, Pending, AuditUnavailable, JournalUnavailable, BaselineUnavailable, AlreadyExists, TransportUncertain, VerificationIncomplete, RecoveryRequired, TerminalWriteFailed, Cancelled }
public sealed record AccountStatus(Guid OperationId, string AccountName, AccountState State, AccountError ErrorCode, int DispatchAttempts, long? AccountId = null)
{
    public bool RequiresReconciliation => State is AccountState.Unknown or AccountState.ReconciliationRequired or AccountState.SucceededAuditIncomplete;
    public static string StateText(AccountState state) => state switch
    {
        AccountState.FailedBeforeDispatch => "failed_before_dispatch", AccountState.AlreadyExists => "already_exists",
        AccountState.ReconciliationRequired => "reconciliation_required", AccountState.SucceededAuditIncomplete => "succeeded_audit_incomplete",
        _ => state.ToString().ToLowerInvariant()
    };
}

public sealed record AccountCapabilities(bool Enabled, bool LiveReady, string Mode);
public interface IAccountGateway
{
    AccountCapabilities Capabilities { get; }
    Task<AccountStatus> SubmitAsync(CreateAccountRequest request, string operatorSid, CancellationToken token);
    Task<AccountStatus?> GetAsync(Guid operationId, string operatorSid, CancellationToken token);
}

// The ONLY gateway wired into the application in A130. No configuration switch can activate SOAP.
public sealed class DisabledAccountGateway : IAccountGateway
{
    public AccountCapabilities Capabilities => new(false, false, "unavailable");
    public Task<AccountStatus> SubmitAsync(CreateAccountRequest request, string operatorSid, CancellationToken token) =>
        Task.FromResult(new AccountStatus(request.OperationId, "", AccountState.Rejected, AccountError.Disabled, 0));
    public Task<AccountStatus?> GetAsync(Guid operationId, string operatorSid, CancellationToken token) => Task.FromResult<AccountStatus?>(null);
}
