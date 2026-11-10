using System.Buffers.Binary;
using System.Text.Json;
using System.Text.Json.Nodes;
using Vmangos.Accounts.Core;
using Vmangos.Accounts.Windows;

namespace Vmangos.Accounts.Windows.Tests;

internal static class ModelData
{
    public static readonly Guid Generation = Guid.Parse("a1320000-0000-4000-8000-000000000001");
    public const string Operator = "S-1-5-21-1-2-3-1001";
    public static string Root => @"C:\VMANGOS-Accounts-Fixture-A139-" + Generation.ToString("N");
    public static string Secret() => Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(8));
    public static CreateAccountRequest Request(Guid? id = null) => new(id ?? Guid.NewGuid(), "A135PLAYER", new PasswordSecret(Secret()));
    public static byte[] Frame(byte[] body)
    {
        byte[] result = new byte[body.Length + 4]; BinaryPrimitives.WriteInt32LittleEndian(result, body.Length);
        body.CopyTo(result, 4); Array.Clear(body); return result;
    }
    public static byte[] Join(params byte[][] parts)
    {
        byte[] result = new byte[parts.Sum(p => p.Length)]; int offset = 0;
        foreach (var part in parts) { part.CopyTo(result, offset); offset += part.Length; Array.Clear(part); }
        return result;
    }
    public static JsonObject SpecNode()
    {
        JsonObject Bundle(string folder, string app)
        {
            var names = new[] { app + ".exe", app + ".dll", app + ".deps.json", app + ".runtimeconfig.json", "Vmangos.Accounts.Core.dll", "Vmangos.Accounts.Windows.dll" };
            var array = new JsonArray();
            foreach (string name in names) array.Add(new JsonObject { ["path"] = folder + "/" + name, ["length"] = 100, ["sha256"] = new string('A', 64) });
            return new JsonObject { ["image"] = folder + "/" + app + ".exe", ["files"] = array };
        }
        return new JsonObject
        {
            ["schema"] = "A139-FIXTURE-1", ["generation"] = Generation.ToString("D"), ["clientSid"] = BoundaryLimits.TargetPoolSid,
            ["operatorSid"] = Operator, ["sessionLimit"] = 2,
            ["worker"] = Bundle("worker", "Vmangos.Accounts.Worker"), ["client"] = Bundle("client", "Vmangos.Accounts.Windows.Tests"),
            ["launcher"] = Bundle("launcher", "Vmangos.Accounts.FixtureLauncher"),
            ["processAccessPolicy"] = ProcessAccessPolicy.Id,
            ["limits"] = new JsonObject { ["stageSeconds"] = 300, ["ownedProcesses"] = 3, ["captureBytes"] = 65536 },
            ["runtime"] = RuntimeNode()
        };
    }
    public static JsonObject RuntimeNode()
    {
        var array = new JsonArray();
        foreach (string path in new[] { "host/fxr/10.0.12/hostfxr.dll", "shared/Microsoft.NETCore.App/10.0.12/hostpolicy.dll", "shared/Microsoft.NETCore.App/10.0.12/coreclr.dll", "shared/Microsoft.NETCore.App/10.0.12/System.Private.CoreLib.dll" })
            array.Add(new JsonObject { ["path"] = path, ["length"] = 100, ["sha256"] = new string('A', 64) });
        return new JsonObject { ["root"] = @"C:\Program Files\dotnet", ["fxrVersion"] = "10.0.12", ["frameworkName"] = "Microsoft.NETCore.App", ["frameworkVersion"] = "10.0.12", ["rollForward"] = "Disable", ["files"] = array };
    }
    public static FixtureSpec Spec(JsonObject? node = null)
    {
        byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(node ?? SpecNode());
        return FixtureSpec.Parse(Root, bytes, Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes)));
    }
}

internal sealed class MemoryJournal : IOperationJournal
{
    public List<JournalEntry> Entries { get; } = [];
    public IReadOnlyList<JournalEntry> Read() => Entries.ToArray();
    public void Append(JournalEntry entry) => Entries.Add(entry);
}
internal sealed class MemoryAudit : IAccountAudit
{
    public List<SafeAudit> Entries { get; } = [];
    public void Append(SafeAudit entry) => Entries.Add(entry);
}
internal sealed class ModelPeer(int failOn = 0) : IPeerLease
{
    public int Calls { get; private set; }
    public bool Disposed { get; private set; }
    public void Revalidate()
    {
        Calls++; if (Calls == failOn) throw new BoundaryException(BoundaryError.PeerRejected);
    }
    public void Dispose() => Disposed = true;
}

internal class ScriptedStream : Stream
{
    private byte[] _input;
    private int _offset;
    private readonly MemoryStream _output = new();
    public int Chunk { get; init; } = 3;
    public bool StallOnEnd { get; init; }
    public int BytesRead { get; private set; }
    public byte[] Written => _output.ToArray();
    public ScriptedStream(byte[] input) => _input = input;
    protected void ReplaceInput(byte[] input) { Array.Clear(_input); _input = input; _offset = 0; }
    public override bool CanRead => true; public override bool CanWrite => true; public override bool CanSeek => false;
    public override long Length => throw new NotSupportedException(); public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken token = default)
    {
        token.ThrowIfCancellationRequested();
        if (_offset == _input.Length && StallOnEnd) await Task.Delay(Timeout.Infinite, token);
        int length = Math.Min(Math.Min(buffer.Length, Chunk), _input.Length - _offset);
        _input.AsMemory(_offset, length).CopyTo(buffer); _offset += length; BytesRead += length; return length;
    }
    public override ValueTask WriteAsync(ReadOnlyMemory<byte> bytes, CancellationToken token = default)
    { token.ThrowIfCancellationRequested(); _output.Write(bytes.Span); return ValueTask.CompletedTask; }
    public override void Flush() { }
    public override int Read(byte[] b, int o, int c) => throw new NotSupportedException();
    public override void Write(byte[] b, int o, int c) => _output.Write(b, o, c);
    public override long Seek(long o, SeekOrigin s) => throw new NotSupportedException();
    public override void SetLength(long v) => throw new NotSupportedException();
    protected override void Dispose(bool disposing)
    {
        if (disposing) { Array.Clear(_input); if (_output.TryGetBuffer(out var b)) Array.Clear(b.Array!, b.Offset, b.Count); _output.Dispose(); }
        base.Dispose(disposing);
    }
}

internal sealed class ClientScript(Guid generation, Guid operation, bool wrongNonce = false, bool wrongGeneration = false, bool dropResponse = false) : ScriptedStream([])
{
    private bool _prepared;
    public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken token = default)
    {
        if (!_prepared)
        {
            byte[] output = Written;
            int length = BinaryPrimitives.ReadInt32LittleEndian(output);
            Guid nonce = WireCodec.ReadHandshake(output.AsMemory(4, length), generation, false);
            byte[] ack = ModelData.Frame(WireCodec.Handshake(wrongGeneration ? Guid.NewGuid() : generation, wrongNonce ? Guid.NewGuid() : nonce, true));
            byte[] reply = dropResponse ? [] : ModelData.Frame(WireCodec.Response(new(operation, "A135PLAYER", AccountState.Succeeded, AccountError.None, 1, 1001)));
            ReplaceInput(ModelData.Join(ack, reply)); _prepared = true; Array.Clear(output);
        }
        return base.ReadAsync(buffer, token);
    }
}
