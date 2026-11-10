using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using Microsoft.Win32.SafeHandles;

namespace Vmangos.Accounts.Windows;

[SupportedOSPlatform("windows")]
internal static partial class NativeMethods
{
    internal const uint FirstInstance = 0x00080000, Overlapped = 0x40000000, RejectRemote = 8;
    internal const uint QueryProcess = 0x1000, Synchronize = 0x100000, TokenQuery = 8;
    internal const uint ReadControl = 0x20000, BackupSemantics = 0x02000000, OpenReparse = 0x00200000;
    internal const uint SqosPresent = 0x00100000, SecurityIdentification = 0x00010000;
    internal const uint WaitObject0 = 0, WaitTimeout = 258;

    [StructLayout(LayoutKind.Sequential)] internal struct SecurityAttributes
    { public int Length; public IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] public bool Inherit; }
    [StructLayout(LayoutKind.Sequential)] internal struct FileTime { public uint Low, High; public readonly long Value => ((long)High << 32) | Low; }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern SafePipeHandle CreateNamedPipeW(string name, uint openMode, uint pipeMode,
        uint maxInstances, uint outBuffer, uint inBuffer, uint defaultTimeout, ref SecurityAttributes attributes);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern SafePipeHandle CreateFileW(string name, uint desiredAccess, uint share, IntPtr attributes,
        uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CreateFileW")]
    internal static extern SafeFileHandle OpenFile(string name, uint desiredAccess, uint share, IntPtr attributes,
        uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CreateFileW")]
    internal static extern SafeFileHandle NewFile(string name, uint desiredAccess, uint share, ref SecurityAttributes attributes,
        uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool WaitNamedPipeW(string name, uint timeout);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint pid);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool GetNamedPipeServerProcessId(SafePipeHandle pipe, out uint pid);
    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern SafeProcessHandle OpenProcess(uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint GetProcessId(SafeProcessHandle process);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool GetProcessTimes(SafeProcessHandle process,
        out FileTime created, out FileTime exited, out FileTime kernel, out FileTime user);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool QueryFullProcessImageNameW(SafeProcessHandle process,
        uint flags, [Out] char[] name, ref uint size);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint WaitForSingleObject(SafeProcessHandle handle, uint timeout);
    [DllImport("kernel32.dll")] internal static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] internal static extern IntPtr GetCurrentThread();
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool CancelIoEx(SafePipeHandle pipe, IntPtr overlapped);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern uint GetFinalPathNameByHandleW(SafeFileHandle file, [Out] char[] path, uint cap, uint flags);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool OpenProcessToken(IntPtr process, uint desired, out SafeAccessTokenHandle token);
    [DllImport("advapi32.dll", SetLastError = true, EntryPoint = "OpenProcessToken")]
    [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool OpenHeldProcessToken(SafeProcessHandle process, uint desired, out SafeAccessTokenHandle token);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool OpenThreadToken(IntPtr thread, uint desired,
        [MarshalAs(UnmanagedType.Bool)] bool asSelf, out SafeAccessTokenHandle token);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool GetTokenInformation(SafeAccessTokenHandle token,
        int information, IntPtr buffer, uint length, out uint needed);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool ImpersonateNamedPipeClient(SafePipeHandle pipe);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool RevertToSelf();
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool ConvertSidToStringSidW(IntPtr sid, out IntPtr text);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool GetKernelObjectSecurity(SafeHandle handle,
        uint information, [Out] byte[]? descriptor, uint length, out uint needed);
    [DllImport("kernel32.dll")] internal static extern IntPtr LocalFree(IntPtr memory);

    internal static void RequireWindows()
    { if (!OperatingSystem.IsWindows()) throw new BoundaryException(BoundaryError.WindowsRequired); }

    internal sealed class DescriptorMemory : IDisposable
    {
        private IntPtr _pointer;
        public SecurityAttributes Attributes { get; }
        public DescriptorMemory(byte[] bytes)
        {
            _pointer = Marshal.AllocHGlobal(bytes.Length);
            Marshal.Copy(bytes, 0, _pointer, bytes.Length);
            Attributes = new() { Length = Marshal.SizeOf<SecurityAttributes>(), Descriptor = _pointer, Inherit = false };
        }
        public void Dispose() { if (_pointer != IntPtr.Zero) { Marshal.FreeHGlobal(_pointer); _pointer = IntPtr.Zero; } }
    }
}
