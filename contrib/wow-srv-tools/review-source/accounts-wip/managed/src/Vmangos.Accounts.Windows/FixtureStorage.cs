using System.Runtime.Versioning;
using System.Text.Json;
using Vmangos.Accounts.Core;

namespace Vmangos.Accounts.Windows;

[SupportedOSPlatform("windows")]
public static class FixtureStorage
{
    // Explicit preparation command only. A worker never invokes this method.
    public static void Initialize(FixtureSpec spec)
    {
        NativeMethods.RequireWindows();
        RuntimeProcessPolicy.AssertCurrent();
        BoundaryLimits.Check(PeerProbe.CurrentSid() == BoundaryLimits.SystemSid, BoundaryError.PeerRejected);
        using var own = new BundleLease(spec, spec.Worker);
        PeerProbe.RequireOwnImage(own, BoundaryLimits.SystemSid);
        ProtectedFiles.AssertDirectory(spec.PathOf("private"), null);
        ProtectedFiles.CreateNew(spec.PathOf("private/journal.jsonl"), [], null);
        ProtectedFiles.CreateNew(spec.PathOf("private/audit.jsonl"), [], null);
        byte[] receipt = Encode(spec);
        try { ProtectedFiles.CreateNew(spec.PathOf("private/INITIALIZED.json"), receipt, null); }
        finally { Array.Clear(receipt); }
    }
    private static byte[] Encode(FixtureSpec spec) => JsonSerializer.SerializeToUtf8Bytes(new
    { schema = "A135-STORAGE-1", generation = spec.Generation.ToString("D"), specSha256 = spec.Sha256 });

    internal static void VerifyExisting(FixtureSpec spec)
    {
        ProtectedFiles.AssertDirectory(spec.PathOf("private"), null);
        using var init = ProtectedFiles.OpenRead(spec.PathOf("private/INITIALIZED.json"), null);
        byte[] expected = Encode(spec), actual = new byte[expected.Length];
        try
        {
            BoundaryLimits.Check(init.Length == expected.Length, BoundaryError.StorageUnavailable);
            init.ReadExactly(actual);
            BoundaryLimits.Check(actual.AsSpan().SequenceEqual(expected), BoundaryError.StorageUnavailable);
        }
        finally { Array.Clear(expected); Array.Clear(actual); }
        foreach (string file in new[] { "private/journal.jsonl", "private/audit.jsonl" })
        {
            using var held = ProtectedFiles.OpenRead(spec.PathOf(file), null);
            BoundaryLimits.Check(held.Length <= 1048576, BoundaryError.StorageUnavailable);
        }
    }
}

public sealed record WorkerFixtureReport(int SessionsCompleted, int SyntheticDispatches)
{
    public bool LiveConnections => false;
    public bool ProductionGatewayEnabled => false;
}

[SupportedOSPlatform("windows")]
public static class WindowsFixture
{
    public static async Task<WorkerFixtureReport> RunWorkerAsync(FixtureSpec spec)
    {
        NativeMethods.RequireWindows();
        RuntimeProcessPolicy.AssertCurrent();
        using var own = new BundleLease(spec, spec.Worker);
        using var client = new BundleLease(spec, spec.Client);
        PeerProbe.RequireOwnImage(own, BoundaryLimits.SystemSid);
        FixtureStorage.VerifyExisting(spec);
        // Missing/corrupt storage is never silently created or truncated.
        using var journal = new FileOperationJournal(spec.PathOf("private/journal.jsonl"));
        using var audit = new FileAccountAudit(spec.PathOf("private/audit.jsonl"));
        var backend = new SyntheticBackend();
        var engine = new OperationEngine(journal, audit, backend, new SyntheticControlGate());
        BoundaryLimits.Check(!engine.BlocksControl, BoundaryError.StorageUnavailable);
        using var pipe = NativePipe.Server(spec.Generation, spec.ClientSid);
        var receipt = PeerProbe.OwnReceipt(spec);
        byte[] bytes = receipt.Encode();
        try { ProtectedFiles.CreateNew(spec.PathOf("ready.json"), bytes, spec.ClientSid); }
        finally { Array.Clear(bytes); }
        using var budget = new CancellationTokenSource(BoundaryLimits.WorkerMs);
        int completed = 0;
        try
        {
            for (; completed < spec.SessionLimit; completed++)
            {
                await pipe.ConnectAsync(budget.Token).ConfigureAwait(false);
                await FixtureConversation.ServerAsync(pipe.Stream, spec.Generation, spec.OperatorSid,
                    () => PeerProbe.ClientPeer(pipe, client, spec.ClientSid, own), engine, budget.Token).ConfigureAwait(false);
                pipe.Disconnect();
            }
            return new(completed, backend.Dispatches);
        }
        catch { pipe.Abort(); throw; }
    }

    public static async Task<FixtureOutcome> SubmitAsync(FixtureSpec spec, CreateAccountRequest request)
    {
        NativeMethods.RequireWindows();
        RuntimeProcessPolicy.AssertCurrent();
        BoundaryLimits.Check(AccountPolicy.Valid(request), BoundaryError.FrameInvalid);
        using var own = new BundleLease(spec, spec.Client);
        using var worker = new BundleLease(spec, spec.Worker);
        PeerProbe.RequireOwnImage(own, spec.ClientSid);
        var receipt = GenerationReceipt.Read(spec);
        using var pipe = NativePipe.Client(spec.Generation, spec.ClientSid);
        using var peer = PeerProbe.ServerPeer(pipe, worker, receipt);
        using var budget = new CancellationTokenSource(BoundaryLimits.WorkerMs);
        try
        {
            return await FixtureConversation.ClientAsync(pipe.Stream, spec.Generation, spec.OperatorSid, request, peer, budget.Token).ConfigureAwait(false);
        }
        finally { pipe.Abort(); }
    }
}
