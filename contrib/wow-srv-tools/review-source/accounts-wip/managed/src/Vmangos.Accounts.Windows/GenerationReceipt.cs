using System.Text.Json;
using System.Runtime.Versioning;

namespace Vmangos.Accounts.Windows;

internal sealed record GenerationReceipt(Guid Generation, int Pid, long CreatedFileTime, string SpecSha256)
{
    public void Validate(FixtureSpec spec)
    {
        BoundaryLimits.Check(Generation == spec.Generation && Generation != Guid.Empty && Pid > 0 &&
            CreatedFileTime >= new DateTime(2020, 1, 1, 0, 0, 0, DateTimeKind.Utc).ToFileTimeUtc() &&
            CreatedFileTime <= DateTime.UtcNow.AddSeconds(2).ToFileTimeUtc() && SpecSha256 == spec.Sha256, BoundaryError.InvalidReceipt);
    }
    public byte[] Encode() => JsonSerializer.SerializeToUtf8Bytes(new
    { schema = "A135-READY-1", generation = Generation.ToString("D"), pid = Pid, createdFileTime = CreatedFileTime, specSha256 = SpecSha256 });
    internal static GenerationReceipt Decode(FixtureSpec spec, ReadOnlyMemory<byte> bytes)
    {
        try
        {
            BoundaryLimits.Check(bytes.Length is > 0 and <= 2048, BoundaryError.InvalidReceipt);
            using var doc = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 2 }); var top = doc.RootElement;
            WireCodec.ExactFields(top, "schema", "generation", "pid", "createdFileTime", "specSha256");
            BoundaryLimits.Check(top.GetProperty("schema").GetString() == "A135-READY-1" &&
                Guid.TryParseExact(top.GetProperty("generation").GetString(), "D", out _), BoundaryError.InvalidReceipt);
            var result = new GenerationReceipt(Guid.ParseExact(top.GetProperty("generation").GetString()!, "D"),
                top.GetProperty("pid").GetInt32(), top.GetProperty("createdFileTime").GetInt64(), top.GetProperty("specSha256").GetString() ?? "");
            result.Validate(spec); return result;
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException or FormatException or ArgumentException or OverflowException)
        { throw new BoundaryException(BoundaryError.InvalidReceipt); }
    }
    [SupportedOSPlatform("windows")]
    public static GenerationReceipt Read(FixtureSpec spec)
    {
        using var stream = ProtectedFiles.OpenRead(spec.PathOf("ready.json"), spec.ClientSid);
        BoundaryLimits.Check(stream.Length is > 0 and <= 2048, BoundaryError.InvalidReceipt);
        byte[] bytes = new byte[(int)stream.Length];
        try { stream.ReadExactly(bytes); return Decode(spec, bytes); }
        finally { Array.Clear(bytes); }
    }
}
