using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Vmangos.Accounts.Windows;

[SupportedOSPlatform("windows")]
internal static class LaunchNative
{
    [StructLayout(LayoutKind.Sequential)] internal struct Luid { public uint Low; public int High; public readonly ulong Value => ((ulong)(uint)High << 32) | Low; }
    [StructLayout(LayoutKind.Sequential)] internal struct Statistics
    { public Luid TokenId, AuthenticationId; public long Expiration; public int Type, Impersonation; public uint DynamicCharged, DynamicAvailable, Groups, Privileges; public Luid Modified; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] internal struct Startup
    {
        public int Size; public IntPtr Reserved, Desktop, Title; public uint X, Y, XSize, YSize, XChars, YChars, Fill, Flags;
        public ushort Show, ReservedBytes; public IntPtr ReservedPointer, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct StartupEx { public Startup Startup; public IntPtr Attributes; }
    [StructLayout(LayoutKind.Sequential)] internal struct ProcessInfo { public IntPtr Process, Thread; public uint Pid, Tid; }
    [StructLayout(LayoutKind.Sequential)] internal struct BasicLimit
    { public long ProcessTime, JobTime; public uint Flags; public UIntPtr Minimum, Maximum; public uint Processes; public UIntPtr Affinity; public uint Priority, Scheduling; }
    [StructLayout(LayoutKind.Sequential)] internal struct IoCounters { public ulong R1, R2, R3, R4, R5, R6; }
    [StructLayout(LayoutKind.Sequential)] internal struct ExtendedLimit
    { public BasicLimit Basic; public IoCounters Io; public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob; }
    [StructLayout(LayoutKind.Sequential)] internal struct Accounting
    { public long A, B, C, D; public uint E, Total, Active, Terminated; }

    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool DuplicateTokenEx(SafeAccessTokenHandle source, uint access, ref NativeMethods.SecurityAttributes attributes,
        int level, int type, out SafeAccessTokenHandle token);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CreateProcessAsUserW(SafeAccessTokenHandle token, string application, StringBuilder command,
        ref NativeMethods.SecurityAttributes processAttributes, ref NativeMethods.SecurityAttributes threadAttributes,
        [MarshalAs(UnmanagedType.Bool)] bool inherit, uint flags, IntPtr environment, string cwd, ref StartupEx startup, out ProcessInfo process);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern IntPtr CreateJobObjectW(IntPtr attributes, string? name);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimit value, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting value, uint size, IntPtr length);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool AssignProcessToJobObject(IntPtr job, SafeProcessHandle process);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool TerminateProcess(SafeProcessHandle process, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool GetExitCodeProcess(SafeProcessHandle process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool CreatePipe(out SafeFileHandle read, out SafeFileHandle write, ref NativeMethods.SecurityAttributes attributes, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool SetHandleInformation(SafeHandle handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref UIntPtr bytes);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, UIntPtr attribute, IntPtr value, UIntPtr bytes, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] internal static extern void DeleteProcThreadAttributeList(IntPtr list);

    internal static void Check(bool value) { if (!value) throw new BoundaryException(BoundaryError.PeerRejected); }
    internal static Statistics Stats(SafeAccessTokenHandle token)
    {
        int size = Marshal.SizeOf<Statistics>(); IntPtr p = Marshal.AllocHGlobal(size);
        try { Check(NativeMethods.GetTokenInformation(token, 10, p, (uint)size, out uint actual) && actual == size); return Marshal.PtrToStructure<Statistics>(p); }
        finally { Marshal.FreeHGlobal(p); }
    }
    internal static string Sid(SafeAccessTokenHandle token)
    {
        _ = NativeMethods.GetTokenInformation(token, 1, IntPtr.Zero, 0, out uint size); Check(size is >= 8 and <= 65536);
        IntPtr p = Marshal.AllocHGlobal((int)size);
        try
        {
            Check(NativeMethods.GetTokenInformation(token, 1, p, size, out uint actual) && actual <= size);
            Check(NativeMethods.ConvertSidToStringSidW(Marshal.ReadIntPtr(p), out IntPtr text));
            try { return Marshal.PtrToStringUni(text) ?? throw new BoundaryException(BoundaryError.TokenUnavailable); }
            finally { _ = NativeMethods.LocalFree(text); }
        }
        finally { Marshal.FreeHGlobal(p); }
    }
    internal static void NoThreadToken()
    {
        bool exists = NativeMethods.OpenThreadToken(NativeMethods.GetCurrentThread(), 8, true, out var token);
        int error = Marshal.GetLastPInvokeError(); token.Dispose(); Check(!exists && error == 1008);
    }
}
