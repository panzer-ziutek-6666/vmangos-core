using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using Microsoft.Win32.SafeHandles;

namespace Vmangos.Accounts.Windows;

[SupportedOSPlatform("windows")]
internal sealed class PeerProbe : IPeerLease
{
    private readonly SafeProcessHandle _process;
    private readonly NativePipe _pipe;
    private readonly BundleLease _bundle;
    private readonly bool _clientEnd;
    private readonly uint _pid;
    private readonly long _created;
    private readonly string _sid;

    private PeerProbe(NativePipe pipe, BundleLease bundle, bool clientEnd, string sid, GenerationReceipt? receipt)
    {
        _pipe = pipe; _bundle = bundle; _clientEnd = clientEnd; _sid = sid;
        _pid = ConnectedPid();
        BoundaryLimits.Check(_pid > 0 && (receipt is null || _pid == receipt.Pid), BoundaryError.PeerRejected);
        _process = NativeMethods.OpenProcess(NativeMethods.QueryProcess | NativeMethods.Synchronize, false, _pid);
        try
        {
            BoundaryLimits.Check(!_process.IsInvalid && NativeMethods.GetProcessId(_process) == _pid, BoundaryError.PeerRejected);
            _created = Creation(_process);
            BoundaryLimits.Check(receipt is null || _created == receipt.CreatedFileTime, BoundaryError.PeerRejected);
            Revalidate();
        }
        catch { _process.Dispose(); throw; }
    }
    public static PeerProbe ServerPeer(NativePipe pipe, BundleLease bundle, GenerationReceipt receipt) =>
        new(pipe, bundle, true, BoundaryLimits.SystemSid, receipt);

    public static PeerProbe ClientPeer(NativePipe pipe, BundleLease bundle, string expectedSid, BundleLease ownWorker)
    {
        // Impersonation/revert emergency-exit is permitted only in this fixed,
        // hash-checked SYSTEM fixture apphost, never in IIS or a generic host.
        RequireOwnImage(ownWorker, BoundaryLimits.SystemSid);
        string sid = PipeClientSid(pipe);
        BoundaryLimits.Check(sid == expectedSid && BoundaryLimits.IsPoolSid(sid), BoundaryError.PeerRejected);
        return new(pipe, bundle, false, expectedSid, null);
    }

    private uint ConnectedPid()
    {
        uint pid;
        bool ok = _clientEnd ? NativeMethods.GetNamedPipeServerProcessId(_pipe.Handle, out pid) : NativeMethods.GetNamedPipeClientProcessId(_pipe.Handle, out pid);
        BoundaryLimits.Check(ok && pid > 0, BoundaryError.PeerRejected); return pid;
    }
    public void Revalidate()
    {
        BoundaryLimits.Check(!_process.IsClosed && !_process.IsInvalid && NativeMethods.WaitForSingleObject(_process, 0) == NativeMethods.WaitTimeout &&
            NativeMethods.GetProcessId(_process) == _pid && ConnectedPid() == _pid && Creation(_process) == _created,
            BoundaryError.PeerRejected);
        BoundaryLimits.Check(Image(_process).Equals(_bundle.ImagePath, StringComparison.OrdinalIgnoreCase), BoundaryError.PeerRejected);
        BoundaryLimits.Check(NativeMethods.OpenHeldProcessToken(_process, NativeMethods.TokenQuery, out var token), BoundaryError.TokenUnavailable);
        using (token) BoundaryLimits.Check(UserSid(token) == _sid, BoundaryError.PeerRejected);
        _bundle.Revalidate();
    }

    public void Dispose() => _process.Dispose();

    private static string Image(SafeProcessHandle process)
    {
        char[] chars = new char[32768]; uint length = (uint)chars.Length;
        BoundaryLimits.Check(NativeMethods.QueryFullProcessImageNameW(process, 0, chars, ref length) && length is > 0 and < 32768, BoundaryError.PeerRejected);
        return new(chars, 0, (int)length);
    }
    internal static long Creation(SafeProcessHandle process)
    {
        BoundaryLimits.Check(NativeMethods.GetProcessTimes(process, out var created, out _, out _, out _) && created.Value > 0, BoundaryError.PeerRejected);
        return created.Value;
    }
    internal static GenerationReceipt OwnReceipt(FixtureSpec spec)
    {
        using var process = NativeMethods.OpenProcess(NativeMethods.QueryProcess | NativeMethods.Synchronize, false, (uint)Environment.ProcessId);
        BoundaryLimits.Check(!process.IsInvalid, BoundaryError.PeerRejected);
        var receipt = new GenerationReceipt(spec.Generation, Environment.ProcessId, Creation(process), spec.Sha256);
        receipt.Validate(spec); return receipt;
    }
    internal static void RequireOwnImage(BundleLease bundle, string sid)
    {
        using var process = NativeMethods.OpenProcess(NativeMethods.QueryProcess, false, (uint)Environment.ProcessId);
        BoundaryLimits.Check(!process.IsInvalid && CurrentSid() == sid &&
            Image(process).Equals(bundle.ImagePath, StringComparison.OrdinalIgnoreCase), BoundaryError.PeerRejected);
        bundle.Revalidate();
    }
    internal static string CurrentSid()
    {
        NativeMethods.RequireWindows();
        BoundaryLimits.Check(NativeMethods.OpenProcessToken(NativeMethods.GetCurrentProcess(), NativeMethods.TokenQuery, out var token), BoundaryError.TokenUnavailable);
        using (token) return UserSid(token);
    }
    private static string UserSid(SafeAccessTokenHandle token)
    {
        _ = NativeMethods.GetTokenInformation(token, 1, IntPtr.Zero, 0, out uint needed);
        BoundaryLimits.Check(needed is >= 8 and <= 65536, BoundaryError.TokenUnavailable);
        IntPtr buffer = Marshal.AllocHGlobal((int)needed);
        try
        {
            BoundaryLimits.Check(NativeMethods.GetTokenInformation(token, 1, buffer, needed, out uint actual) && actual <= needed, BoundaryError.TokenUnavailable);
            BoundaryLimits.Check(NativeMethods.ConvertSidToStringSidW(Marshal.ReadIntPtr(buffer), out IntPtr text), BoundaryError.TokenUnavailable);
            try { return Marshal.PtrToStringUni(text) ?? throw new BoundaryException(BoundaryError.TokenUnavailable); }
            finally { _ = NativeMethods.LocalFree(text); }
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }
    private static int ImpersonationLevel(SafeAccessTokenHandle token)
    {
        IntPtr buffer = Marshal.AllocHGlobal(4);
        try
        {
            BoundaryLimits.Check(NativeMethods.GetTokenInformation(token, 9, buffer, 4, out uint needed) && needed == 4, BoundaryError.TokenUnavailable);
            return Marshal.ReadInt32(buffer);
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }
    private static string PipeClientSid(NativePipe pipe)
    {
        bool existing = NativeMethods.OpenThreadToken(NativeMethods.GetCurrentThread(), NativeMethods.TokenQuery, true, out var previous);
        int error = Marshal.GetLastPInvokeError(); previous.Dispose();
        BoundaryLimits.Check(!existing && error == 1008, BoundaryError.ImpersonationFailed);
        BoundaryLimits.Check(NativeMethods.ImpersonateNamedPipeClient(pipe.Handle), BoundaryError.ImpersonationFailed);
        try
        {
            BoundaryLimits.Check(NativeMethods.OpenThreadToken(NativeMethods.GetCurrentThread(), NativeMethods.TokenQuery, true, out var token), BoundaryError.TokenUnavailable);
            using (token)
            {
                BoundaryLimits.Check(ImpersonationLevel(token) == 1, BoundaryError.PeerRejected);
                return UserSid(token);
            }
        }
        finally
        {
            // No await, raw exception, FailFast or continuation under a bad token.
            // This method is reachable only after the fixed own-worker guard.
            if (!NativeMethods.RevertToSelf()) Environment.Exit(74);
            try { LaunchNative.NoThreadToken(); } catch { Environment.Exit(74); }
        }
    }
}
