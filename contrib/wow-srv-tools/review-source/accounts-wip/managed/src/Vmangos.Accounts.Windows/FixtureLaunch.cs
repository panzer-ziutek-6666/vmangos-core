using System.Diagnostics;
using System.Runtime.Versioning;
using Microsoft.Win32.SafeHandles;

namespace Vmangos.Accounts.Windows;

public sealed record LaunchReport(int OwnedChildren, int Sessions, int SyntheticDispatches, bool SourceTokensUnchanged, bool JobQuiescent)
{ public bool LiveConnections => false; public bool IisPipelineTested => false; }

[SupportedOSPlatform("windows")]
public static class FixtureLaunch
{
    public static LaunchReport Run(FixtureSpec spec)
    {
        RuntimeProcessPolicy.AssertCurrent(); LaunchNative.NoThreadToken();
        LaunchNative.Check(Environment.MachineName.Equals("WOW-SRV", StringComparison.OrdinalIgnoreCase) && PeerProbe.CurrentSid() == BoundaryLimits.SystemSid);
        using var anchors = new FixtureDirectoryLease(spec.Root);
        using var own = new BundleLease(spec, spec.Launcher); PeerProbe.RequireOwnImage(own, BoundaryLimits.SystemSid);
        using var runtime = new RuntimeLease(spec.Runtime);
        using var worker = new BundleLease(spec, spec.Worker); using var client = new BundleLease(spec, spec.Client);
        foreach (var profile in new[] { spec.Worker, spec.Client, spec.Launcher }) AssertConfig(spec, profile);
        ProtectedFiles.AssertDirectory(spec.PathOf("system-temp"), null);
        AssertClientTemp(spec);
        using var desktop = new PrivateClientDesktop(spec);
        using var pool = PoolSource.Capture(spec.ClientSid);
        LaunchNative.Check(NativeMethods.OpenProcessToken(NativeMethods.GetCurrentProcess(), 0x2000A, out var systemSource));
        using (systemSource)
        using (var initToken = new PrivatePrimaryToken(systemSource, BoundaryLimits.SystemSid, spec.ClientSid))
        using (var workerToken = new PrivatePrimaryToken(systemSource, BoundaryLimits.SystemSid, spec.ClientSid))
        using (var clientToken = new PrivatePrimaryToken(pool.Token, spec.ClientSid, spec.ClientSid))
        using (var job = new FixtureJob())
        {
            var timer = Stopwatch.StartNew();
            int Remaining() { int value = 300000 - (int)timer.ElapsedMilliseconds; LaunchNative.Check(value > 0); return value; }
            void CheckInputs() { runtime.Revalidate(); own.Revalidate(); worker.Revalidate(); client.Revalidate(); pool.Revalidate(); initToken.VerifySource(); workerToken.VerifySource(); clientToken.VerifySource(); _ = Remaining(); }
            CheckInputs();
            using (var init = new OwnedFixtureChild(spec, spec.Worker, initToken, job, "--initialize-fixture", false))
            {
                LaunchOrder.Start(init); LaunchNative.Check(init.WaitResult(Math.Min(30000, Remaining())) == "A135_STORAGE_INITIALIZED=True LIVE_CONNECTIONS=0");
            }
            CheckInputs();
            using var sender = new OwnedFixtureChild(spec, spec.Client, clientToken, job, "--fixture-client", true, desktop.Name);
            // Prepare the client before the worker's short connection deadline.
            try { sender.CreateSuspended(); sender.AssignJob(); sender.Verify(); }
            catch { sender.AbortOwned(); throw; }
            using var server = new OwnedFixtureChild(spec, spec.Worker, workerToken, job, "--fixture-worker", false);
            LaunchOrder.Start(server);
            var readyTimer = Stopwatch.StartNew();
            while (!File.Exists(spec.PathOf("ready.json")))
            { LaunchNative.Check(readyTimer.ElapsedMilliseconds < 5000); _ = Remaining(); Thread.Sleep(10); }
            var ready = GenerationReceipt.Read(spec);
            LaunchNative.Check(ready.Pid == server.Pid && ready.CreatedFileTime == server.Created);
            sender.Resume();
            LaunchNative.Check(sender.WaitResult(Math.Min(30000, Remaining())) == "A135_CLIENT_FIXED_SUCCESS_AND_DUPLICATE=True LIVE_CONNECTIONS=0");
            LaunchNative.Check(server.WaitResult(Math.Min(90000, Remaining())) == "A135_WORKER_SESSIONS=2 SYNTHETIC_DISPATCHES=1 LIVE_CONNECTIONS=0");
            CheckInputs(); LaunchNative.Check(job.Finish()); LaunchNative.NoThreadToken();
            return new(3, 2, 1, true, true);
        }
    }
    private static void AssertConfig(FixtureSpec spec, BundleProfile bundle)
    {
        var pin = bundle.Files.Single(p => p.RelativePath.EndsWith(".runtimeconfig.json", StringComparison.Ordinal));
        using var held = ProtectedFiles.OpenRead(spec.PathOf(pin.RelativePath), spec.ClientSid);
        BoundaryLimits.Check(held.Length <= 16384, BoundaryError.InvalidSpec);
        using var doc = System.Text.Json.JsonDocument.Parse(held); var opt = doc.RootElement.GetProperty("runtimeOptions");
        BoundaryLimits.Check(opt.GetProperty("tfm").GetString() == "net10.0" && opt.GetProperty("rollForward").GetString() == "Disable" &&
            opt.GetProperty("framework").GetProperty("name").GetString() == "Microsoft.NETCore.App" && opt.GetProperty("framework").GetProperty("version").GetString() == "10.0.12", BoundaryError.InvalidSpec);
    }
    private static void AssertClientTemp(FixtureSpec spec)
    {
        string path = spec.PathOf("client-temp");
        BoundaryLimits.Check(Directory.Exists(path) && (File.GetAttributes(path) & FileAttributes.ReparsePoint) == 0, BoundaryError.InvalidPath);
        var sd = new System.Security.AccessControl.DirectorySecurity(path, System.Security.AccessControl.AccessControlSections.All & ~System.Security.AccessControl.AccessControlSections.Audit);
        var raw = new System.Security.AccessControl.RawSecurityDescriptor(sd.GetSecurityDescriptorBinaryForm(), 0);
        BoundaryLimits.Check(raw.Owner?.Value == BoundaryLimits.SystemSid && (raw.ControlFlags & System.Security.AccessControl.ControlFlags.DiscretionaryAclProtected) != 0 && raw.DiscretionaryAcl?.Count == 3, BoundaryError.UntrustedAcl);
        var expected = new Dictionary<string, uint> { [BoundaryLimits.SystemSid] = 0x1F01FF, ["S-1-5-32-544"] = 0x1F01FF, [spec.ClientSid] = 0x1301BF };
        foreach (System.Security.AccessControl.GenericAce entry in raw.DiscretionaryAcl!)
        {
            BoundaryLimits.Check(entry is System.Security.AccessControl.CommonAce ace && !ace.IsCallback && ace.AceQualifier == System.Security.AccessControl.AceQualifier.AccessAllowed &&
                ace.AceFlags == (System.Security.AccessControl.AceFlags.ContainerInherit | System.Security.AccessControl.AceFlags.ObjectInherit) && expected.Remove(ace.SecurityIdentifier.Value, out uint mask) && (uint)ace.AccessMask == mask, BoundaryError.UntrustedAcl);
        }
        BoundaryLimits.Check(expected.Count == 0, BoundaryError.UntrustedAcl);
    }
}

[SupportedOSPlatform("windows")]
internal sealed class PoolSource : IDisposable
{
    internal SafeAccessTokenHandle Token { get; }
    private readonly SafeProcessHandle _process; private readonly uint _pid; private readonly long _created;
    private readonly byte[] _descriptor;
    private PoolSource(SafeProcessHandle process, SafeAccessTokenHandle token)
    { _process = process; Token = token; _pid = NativeMethods.GetProcessId(process); _created = PeerProbe.Creation(process); _descriptor = PrivatePrimaryToken.Descriptor(process); }
    internal static PoolSource Capture(string sid)
    {
        PoolSource? result = null;
        try
        {
            var processes = Process.GetProcessesByName("w3wp");
            try
            {
                LaunchNative.Check(processes.Length <= 16);
                foreach (var candidate in processes)
                {
                    var process = NativeMethods.OpenProcess(0x121000, false, (uint)candidate.Id); SafeAccessTokenHandle? token = null; bool keep = false;
                    try
                    {
                        LaunchNative.Check(!process.IsInvalid && OwnedFixtureChild.Image(process).Equals(@"C:\Windows\System32\inetsrv\w3wp.exe", StringComparison.OrdinalIgnoreCase));
                        LaunchNative.Check(NativeMethods.OpenHeldProcessToken(process, 0x2000A, out token));
                        if (LaunchNative.Sid(token) != sid) continue;
                        LaunchNative.Check(result is null && LaunchNative.Stats(token).Type == 1);
                        result = new(process, token); keep = true;
                    }
                    finally { if (!keep) { token?.Dispose(); process.Dispose(); } }
                }
            }
            finally { foreach (var p in processes) p.Dispose(); }
            LaunchNative.Check(result is not null); result!.Revalidate(); return result;
        }
        catch { result?.Dispose(); throw; }
    }
    internal void Revalidate()
    {
        LaunchNative.Check(NativeMethods.WaitForSingleObject(_process, 0) == 258 && NativeMethods.GetProcessId(_process) == _pid && PeerProbe.Creation(_process) == _created &&
            OwnedFixtureChild.Image(_process).Equals(@"C:\Windows\System32\inetsrv\w3wp.exe", StringComparison.OrdinalIgnoreCase) && LaunchNative.Sid(Token) == BoundaryLimits.TargetPoolSid &&
            PrivatePrimaryToken.Descriptor(_process).AsSpan().SequenceEqual(_descriptor));
    }
    public void Dispose() { Token.Dispose(); _process.Dispose(); Array.Clear(_descriptor); }
}
