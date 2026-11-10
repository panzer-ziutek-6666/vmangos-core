using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.AccessControl;

namespace Vmangos.Accounts.Windows;

internal static class ClientDesktopPolicy
{
    internal const uint StationFull = 0x000F037F, DesktopFull = 0x000F01FF;
    internal static string Station(Guid generation)
    { BoundaryLimits.Check(generation != Guid.Empty, BoundaryError.InvalidSpec); return "A135-Client-" + generation.ToString("N"); }
    internal static string Sddl(uint mask, string sid)
    {
        BoundaryLimits.Check(sid == BoundaryLimits.TargetPoolSid && mask is StationFull or DesktopFull, BoundaryError.InvalidSpec);
        return $"D:P(A;;0x{mask:X8};;;SY)(A;;0x{mask:X8};;;BA)(A;;0x{mask:X8};;;{sid})";
    }
}

// Only the unprivileged client uses this desktop. No SYSTEM child is placed on
// a desktop whose hook/window rights belong to the pool.
[SupportedOSPlatform("windows")]
internal sealed class PrivateClientDesktop : IDisposable
{
    private IntPtr _station, _desktop;
    internal string Name { get; }
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr GetProcessWindowStation();
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr GetThreadDesktop(uint id);
    [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetProcessWindowStation(IntPtr station);
    [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetThreadDesktop(IntPtr desktop);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateWindowStationW(string name, uint flags, uint access, ref NativeMethods.SecurityAttributes attributes);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateDesktopW(string name, IntPtr device, IntPtr mode, uint flags, uint access, ref NativeMethods.SecurityAttributes attributes);
    [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseWindowStation(IntPtr station);
    [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetUserObjectSecurity(IntPtr handle, ref uint information, byte[]? descriptor, uint length, out uint needed);
    [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetUserObjectSecurity(IntPtr handle, ref uint information, byte[] descriptor);
    internal PrivateClientDesktop(FixtureSpec spec)
    {
        string stationName = ClientDesktopPolicy.Station(spec.Generation); Name = stationName + "\\Fixture";
        IntPtr previousStation = GetProcessWindowStation(), previousDesktop = GetThreadDesktop(GetCurrentThreadId());
        LaunchNative.Check(previousStation != IntPtr.Zero && previousDesktop != IntPtr.Zero);
        byte[] stationSd = PipeAccessPolicy.Bytes(ClientDesktopPolicy.Sddl(ClientDesktopPolicy.StationFull, spec.ClientSid));
        byte[] desktopSd = PipeAccessPolicy.Bytes(ClientDesktopPolicy.Sddl(ClientDesktopPolicy.DesktopFull, spec.ClientSid));
        try
        {
            byte[] privateSd = PipeAccessPolicy.Bytes("D:P(A;;GA;;;SY)(A;;GA;;;BA)");
            using var sm = new NativeMethods.DescriptorMemory(privateSd); Array.Clear(privateSd); var sa = sm.Attributes;
            _station = CreateWindowStationW(stationName, 1, ClientDesktopPolicy.StationFull, ref sa); LaunchNative.Check(_station != IntPtr.Zero);
            try
            {
                LaunchNative.Check(SetProcessWindowStation(_station));
                using var dm = new NativeMethods.DescriptorMemory(PipeAccessPolicy.Bytes("D:P(A;;GA;;;SY)(A;;GA;;;BA)")); var da = dm.Attributes;
                _desktop = CreateDesktopW("Fixture", IntPtr.Zero, IntPtr.Zero, 0, ClientDesktopPolicy.DesktopFull, ref da);
                LaunchNative.Check(_desktop != IntPtr.Zero);
            }
            finally
            {
                // Synchronous native scope; a failed restore terminates only the
                // own verified SYSTEM fixture launcher, never IIS/collector.
                bool process = SetProcessWindowStation(previousStation), thread = SetThreadDesktop(previousDesktop);
                if (!thread || !process || GetProcessWindowStation() != previousStation || GetThreadDesktop(GetCurrentThreadId()) != previousDesktop) Environment.Exit(77);
            }
            // Grant pool access only after the SYSTEM launcher has restored its
            // own station/thread desktop. No untrusted access during setup.
            uint information = 4;
            LaunchNative.Check(SetUserObjectSecurity(_station, ref information, stationSd));
            LaunchNative.Check(SetUserObjectSecurity(_desktop, ref information, desktopSd));
            Assert(_station, ClientDesktopPolicy.StationFull, spec.ClientSid); Assert(_desktop, ClientDesktopPolicy.DesktopFull, spec.ClientSid);
        }
        catch { Dispose(); throw; }
        finally { Array.Clear(stationSd); Array.Clear(desktopSd); }
    }
    private static void Assert(IntPtr handle, uint mask, string sid)
    {
        uint info = 7; _ = GetUserObjectSecurity(handle, ref info, null, 0, out uint needed); LaunchNative.Check(needed is > 0 and <= 16384);
        byte[] bytes = new byte[needed];
        try
        {
            LaunchNative.Check(GetUserObjectSecurity(handle, ref info, bytes, needed, out uint actual) && actual <= needed);
            var sd = new RawSecurityDescriptor(bytes, 0);
            LaunchNative.Check(sd.Owner?.Value == BoundaryLimits.SystemSid && (sd.ControlFlags & ControlFlags.DiscretionaryAclProtected) != 0 && sd.DiscretionaryAcl?.Count == 3);
            var expected = new HashSet<string>(StringComparer.Ordinal) { BoundaryLimits.SystemSid, "S-1-5-32-544", sid };
            foreach (GenericAce entry in sd.DiscretionaryAcl!)
            {
                LaunchNative.Check(entry is CommonAce ace && !ace.IsCallback && ace.AceFlags == AceFlags.None && ace.AceQualifier == AceQualifier.AccessAllowed &&
                    (uint)ace.AccessMask == mask && expected.Remove(ace.SecurityIdentifier.Value));
            }
            LaunchNative.Check(expected.Count == 0);
        }
        finally { Array.Clear(bytes); }
    }
    public void Dispose()
    {
        bool good = true;
        if (_desktop != IntPtr.Zero) { good = CloseDesktop(_desktop); _desktop = IntPtr.Zero; }
        if (_station != IntPtr.Zero) { good = CloseWindowStation(_station) && good; _station = IntPtr.Zero; }
        LaunchNative.Check(good);
    }
}
