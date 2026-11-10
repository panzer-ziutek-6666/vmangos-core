using System.Text.Json;
using Vmangos.Accounts.Core;

namespace Vmangos.Accounts.Windows;

internal static class WireCodec
{
    private static readonly JsonDocumentOptions Options = new() { MaxDepth = 3 };
    private static byte[] Write(Action<Utf8JsonWriter> action)
    {
        using var memory = new MemoryStream();
        try
        {
            using (var writer = new Utf8JsonWriter(memory)) { writer.WriteStartObject(); action(writer); writer.WriteEndObject(); }
            return memory.ToArray();
        }
        finally { if (memory.TryGetBuffer(out var buffer)) Array.Clear(buffer.Array!, buffer.Offset, buffer.Count); }
    }

    public static byte[] Handshake(Guid generation, Guid nonce, bool acknowledgement) => Write(w =>
    {
        BoundaryLimits.Check(generation != Guid.Empty && nonce != Guid.Empty, BoundaryError.HandshakeInvalid);
        w.WriteString("version", "A135-1"); w.WriteString("phase", acknowledgement ? "ready" : "hello");
        w.WriteString("generation", generation.ToString("D")); w.WriteString("nonce", nonce.ToString("D"));
    });

    public static Guid ReadHandshake(ReadOnlyMemory<byte> bytes, Guid expectedGeneration, bool acknowledgement, Guid? expectedNonce = null)
    {
        try
        {
            BoundaryLimits.Check(bytes.Length is > 0 and <= BoundaryLimits.HandshakeBytes && expectedGeneration != Guid.Empty, BoundaryError.HandshakeInvalid);
            using var doc = JsonDocument.Parse(bytes, Options); var root = doc.RootElement;
            BoundaryLimits.Check(StrictJson.Shape(root, "version", "phase", "generation", "nonce") &&
                root.GetProperty("version").GetString() == "A135-1" &&
                root.GetProperty("phase").GetString() == (acknowledgement ? "ready" : "hello") &&
                Guid.TryParseExact(root.GetProperty("generation").GetString(), "D", out Guid generation) && generation == expectedGeneration &&
                Guid.TryParseExact(root.GetProperty("nonce").GetString(), "D", out Guid nonce) && nonce != Guid.Empty &&
                (expectedNonce is null || nonce == expectedNonce), BoundaryError.HandshakeInvalid);
            return Guid.ParseExact(root.GetProperty("nonce").GetString()!, "D");
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException or FormatException or ArgumentException)
        { throw new BoundaryException(BoundaryError.HandshakeInvalid); }
    }

    public static byte[] Request(CreateAccountRequest request, string sid, Guid generation) => Write(w =>
    {
        BoundaryLimits.Check(AccountPolicy.Valid(request) && AccountPolicy.ValidSid(sid) && generation != Guid.Empty, BoundaryError.FrameInvalid);
        w.WriteString("version", "A135-1"); w.WriteString("generation", generation.ToString("D"));
        w.WriteString("operationId", request.OperationId.ToString("D")); w.WriteString("accountName", request.AccountName);
        request.Password.Use(chars => w.WriteString("password", chars.Span));
        w.WriteString("operatorSid", sid);
    });

    public static CreateAccountRequest ReadRequest(ReadOnlyMemory<byte> bytes, Guid expectedGeneration, string expectedOperator)
    {
        try
        {
            BoundaryLimits.Check(bytes.Length is > 0 and <= BoundaryLimits.FrameBytes, BoundaryError.FrameInvalid);
            using var doc = JsonDocument.Parse(bytes, Options); var root = doc.RootElement;
            BoundaryLimits.Check(StrictJson.Shape(root, "version", "generation", "operationId", "accountName", "password", "operatorSid") &&
                root.GetProperty("version").GetString() == "A135-1" && expectedGeneration != Guid.Empty &&
                Guid.TryParseExact(root.GetProperty("generation").GetString(), "D", out Guid generation) && generation == expectedGeneration,
                BoundaryError.FrameInvalid);
            BoundaryLimits.Check(AccountPolicy.ValidSid(expectedOperator) && root.GetProperty("operatorSid").GetString() == expectedOperator,
                BoundaryError.OperatorRejected);
            BoundaryLimits.Check(Guid.TryParseExact(root.GetProperty("operationId").GetString(), "D", out Guid id) && id != Guid.Empty &&
                AccountPolicy.TryCanonicalName(root.GetProperty("accountName").GetString(), out _), BoundaryError.FrameInvalid);
            var secret = new PasswordSecret(root.GetProperty("password").GetString() ?? "");
            var request = new CreateAccountRequest(id, root.GetProperty("accountName").GetString()!, secret);
            if (!AccountPolicy.Valid(request)) { request.Dispose(); throw new BoundaryException(BoundaryError.FrameInvalid); }
            return request;
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException or ArgumentException)
        { throw new BoundaryException(BoundaryError.FrameInvalid); }
    }

    public static byte[] Response(AccountStatus result) => Write(w =>
    {
        w.WriteString("version", "A135-1"); w.WriteString("operationId", result.OperationId.ToString("D"));
        w.WriteString("state", AccountStatus.StateText(result.State)); w.WriteString("errorCode", result.ErrorCode.ToString());
        w.WriteNumber("dispatchAttempts", result.DispatchAttempts); w.WriteBoolean("synthetic", true);
    });

    public static FixtureOutcome ReadResponse(ReadOnlyMemory<byte> bytes, Guid operation)
    {
        try
        {
            BoundaryLimits.Check(bytes.Length is > 0 and <= BoundaryLimits.FrameBytes && operation != Guid.Empty, BoundaryError.FrameInvalid);
            using var doc = JsonDocument.Parse(bytes, Options); var root = doc.RootElement;
            ExactFields(root, "version", "operationId", "state", "errorCode", "dispatchAttempts", "synthetic");
            BoundaryLimits.Check(root.GetProperty("version").GetString() == "A135-1" &&
                root.GetProperty("operationId").GetString() == operation.ToString("D") && root.GetProperty("synthetic").GetBoolean(), BoundaryError.FrameInvalid);
            string state = root.GetProperty("state").GetString() ?? "", error = root.GetProperty("errorCode").GetString() ?? "";
            int attempts = root.GetProperty("dispatchAttempts").GetInt32();
            BoundaryLimits.Check(Enum.GetValues<AccountState>().Any(v => AccountStatus.StateText(v) == state) &&
                Enum.GetNames<AccountError>().Contains(error, StringComparer.Ordinal) && attempts is 0 or 1, BoundaryError.FrameInvalid);
            BoundaryLimits.Check(state switch
            {
                "succeeded" => attempts == 1 && error == "None",
                "alreadyexists" => attempts == 0 && error == "AlreadyExists",
                "rejected" or "failed_before_dispatch" => attempts == 0 && error != "None",
                "succeeded_audit_incomplete" => attempts == 1 && error != "None",
                "unknown" or "reconciliation_required" => error != "None",
                "running" => error == "None",
                _ => false
            }, BoundaryError.FrameInvalid);
            return new(operation, state, error, attempts);
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException or FormatException or KeyNotFoundException)
        { throw new BoundaryException(BoundaryError.FrameInvalid); }
    }

    internal static void ExactFields(JsonElement root, params string[] expected)
    {
        BoundaryLimits.Check(root.ValueKind == JsonValueKind.Object, BoundaryError.InvalidSpec);
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var field in root.EnumerateObject())
            BoundaryLimits.Check(expected.Contains(field.Name, StringComparer.Ordinal) && names.Add(field.Name), BoundaryError.InvalidSpec);
        BoundaryLimits.Check(names.Count == expected.Length, BoundaryError.InvalidSpec);
    }
}
