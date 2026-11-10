using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Vmangos.Accounts.Windows;

[SupportedOSPlatform("windows")]
internal sealed class OwnedFixtureChild : ILaunchSteps, IDisposable
{
    private readonly FixtureSpec _spec;
    private readonly BundleProfile _bundle;
    private readonly PrivatePrimaryToken _token;
    private readonly FixtureJob _job;
    private readonly string _mode;
    private readonly bool _client;
    private readonly string? _desktop;
    private SafeProcessHandle? _process;
    private IntPtr _thread;
    private FileStream? _stdout, _stderr;
    private Task<byte[]>? _outTask, _errTask;
    private bool _resumed, _finished, _abortFailed, _assigned, _verified;
    internal uint Pid { get; private set; }
    internal long Created { get; private set; }
    internal OwnedFixtureChild(FixtureSpec spec, BundleProfile bundle, PrivatePrimaryToken token, FixtureJob job, string mode, bool client, string? desktop = null)
    {
        LaunchNative.Check((!client && mode is "--initialize-fixture" or "--fixture-worker" && ReferenceEquals(bundle, spec.Worker)) ||
            (client && mode == "--fixture-client" && ReferenceEquals(bundle, spec.Client)));
        _spec = spec; _bundle = bundle; _token = token; _job = job; _mode = mode; _client = client; _desktop = desktop;
        LaunchNative.Check(client ? desktop == ClientDesktopPolicy.Station(spec.Generation) + "\\Fixture" : desktop is null);
    }
    private static async Task<byte[]> Capture(FileStream stream)
    {
        using var memory = new MemoryStream(); byte[] buffer = new byte[4096];
        try
        {
            while (true)
            {
                int read = await stream.ReadAsync(buffer).ConfigureAwait(false); if (read == 0) break;
                BoundaryLimits.Check(memory.Length + read <= 65536, BoundaryError.FrameInvalid); memory.Write(buffer, 0, read);
            }
            return memory.ToArray();
        }
        finally { Array.Clear(buffer); if (memory.TryGetBuffer(out var bytes)) Array.Clear(bytes.Array!); }
    }
    public void CreateSuspended()
    {
        SafeFileHandle? outRead = null, outWrite = null, errRead = null, errWrite = null;
        IntPtr list = IntPtr.Zero, handles = IntPtr.Zero, env = IntPtr.Zero, desktop = IntPtr.Zero; bool initialized = false;
        byte[] descriptor = PipeAccessPolicy.Bytes("D:P(A;;GA;;;SY)(A;;GA;;;BA)");
        try
        {
            using var memory = new NativeMethods.DescriptorMemory(descriptor); var pipeAttr = memory.Attributes; pipeAttr.Inherit = true;
            LaunchNative.Check(LaunchNative.CreatePipe(out outRead, out outWrite, ref pipeAttr, 4096));
            LaunchNative.Check(LaunchNative.CreatePipe(out errRead, out errWrite, ref pipeAttr, 4096));
            LaunchNative.Check(LaunchNative.SetHandleInformation(outRead, 1, 0) && LaunchNative.SetHandleInformation(errRead, 1, 0));
            // A read end with no input writer is a valid EOF stdin, not a console.
            LaunchNative.Check(LaunchNative.CreatePipe(out var inputRead, out var inputWrite, ref pipeAttr, 0));
            using (inputRead) using (inputWrite)
            {
                inputWrite.Dispose();
                UIntPtr size = UIntPtr.Zero; _ = LaunchNative.InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
                LaunchNative.Check(size.ToUInt64() is > 0 and <= 65536); list = Marshal.AllocHGlobal((int)size.ToUInt64());
                LaunchNative.Check(LaunchNative.InitializeProcThreadAttributeList(list, 1, 0, ref size)); initialized = true;
                handles = Marshal.AllocHGlobal(3 * IntPtr.Size);
                Marshal.WriteIntPtr(handles, inputRead.DangerousGetHandle()); Marshal.WriteIntPtr(handles, IntPtr.Size, outWrite.DangerousGetHandle());
                Marshal.WriteIntPtr(handles, 2 * IntPtr.Size, errWrite.DangerousGetHandle());
                LaunchNative.Check(LaunchNative.UpdateProcThreadAttribute(list, 0, (UIntPtr)0x20002, handles, (UIntPtr)(3 * IntPtr.Size), IntPtr.Zero, IntPtr.Zero));
                if (_desktop is not null) desktop = Marshal.StringToHGlobalUni(_desktop);
                string image = _spec.PathOf(_bundle.Image);
                string command = $"\"{image}\" {_mode} \"{_spec.Root}\" {_spec.Sha256}";
                env = Marshal.StringToHGlobalUni(string.Join('\0', ProcessAccessPolicy.EnvironmentFor(_spec, _client)) + "\0\0");
                byte[] processSd = PipeAccessPolicy.Bytes(ProcessAccessPolicy.ProcessDacl(_spec.ClientSid));
                try
                {
                    using var pm = new NativeMethods.DescriptorMemory(processSd); var processAttr = pm.Attributes;
                    var threadAttr = memory.Attributes;
                    var startup = new LaunchNative.StartupEx { Startup = new LaunchNative.Startup { Size = Marshal.SizeOf<LaunchNative.StartupEx>(), Flags = 0x100, Desktop = desktop,
                        Input = inputRead.DangerousGetHandle(), Output = outWrite.DangerousGetHandle(), Error = errWrite.DangerousGetHandle() }, Attributes = list };
                    LaunchNative.Check(LaunchNative.CreateProcessAsUserW(_token.Handle, image, new StringBuilder(command), ref processAttr, ref threadAttr,
                        true, 0x4 | 0x400 | 0x80000 | 0x08000000, env, Path.GetDirectoryName(image)!, ref startup, out var info));
                    _process = new SafeProcessHandle(info.Process, true); _thread = info.Thread; Pid = info.Pid;
                }
                finally { Array.Clear(processSd); }
            }
            outWrite.Dispose(); errWrite.Dispose();
            _stdout = new FileStream(outRead, FileAccess.Read); outRead = null;
            _stderr = new FileStream(errRead, FileAccess.Read); errRead = null;
            _outTask = Task.Run(() => Capture(_stdout)); _errTask = Task.Run(() => Capture(_stderr));
        }
        finally
        {
            if (initialized) LaunchNative.DeleteProcThreadAttributeList(list);
            if (list != IntPtr.Zero) Marshal.FreeHGlobal(list); if (handles != IntPtr.Zero) Marshal.FreeHGlobal(handles);
            if (env != IntPtr.Zero) Marshal.FreeHGlobal(env); if (desktop != IntPtr.Zero) Marshal.FreeHGlobal(desktop);
            outRead?.Dispose(); outWrite?.Dispose(); errRead?.Dispose(); errWrite?.Dispose(); Array.Clear(descriptor);
        }
    }
    public void AssignJob() { LaunchNative.Check(!_assigned && _process is not null && LaunchNative.AssignProcessToJobObject(_job.Handle, _process)); _assigned = true; }
    public void Verify()
    {
        LaunchNative.Check(_assigned && !_verified && _process is not null && !_process.IsInvalid && NativeMethods.GetProcessId(_process) == Pid &&
            NativeMethods.WaitForSingleObject(_process, 0) == NativeMethods.WaitTimeout);
        Created = PeerProbe.Creation(_process!);
        LaunchNative.Check(Image(_process!).Equals(_spec.PathOf(_bundle.Image), StringComparison.OrdinalIgnoreCase));
        PrivatePrimaryToken.AssertNewDescriptor(_process!, true, !_client, _spec.ClientSid);
        LaunchNative.Check(NativeMethods.OpenHeldProcessToken(_process!, 0x20008, out var token));
        using (token)
        {
            var stats = LaunchNative.Stats(token);
            LaunchNative.Check(stats.Type == 1 && stats.TokenId.Value == _token.Id && LaunchNative.Sid(token) == _token.Sid);
            PrivatePrimaryToken.AssertNewDescriptor(token, false, !_client, _spec.ClientSid);
        }
        _token.VerifySource(); _verified = true;
    }
    internal static string Image(SafeProcessHandle process)
    {
        char[] buffer = new char[32768]; uint count = (uint)buffer.Length;
        LaunchNative.Check(NativeMethods.QueryFullProcessImageNameW(process, 0, buffer, ref count) && count is > 0 and < 32768);
        return new(buffer, 0, (int)count);
    }
    public void Resume()
    {
        LaunchNative.Check(_verified && !_resumed && _thread != IntPtr.Zero && LaunchNative.ResumeThread(_thread) == 1); _resumed = true;
        LaunchNative.Check(LaunchNative.CloseHandle(_thread)); _thread = IntPtr.Zero;
    }
    internal string WaitResult(int milliseconds)
    {
        LaunchNative.Check(_resumed && _process is not null && NativeMethods.WaitForSingleObject(_process, (uint)milliseconds) == 0);
        LaunchNative.Check(LaunchNative.GetExitCodeProcess(_process!, out uint code) && code == 0);
        byte[] output = _outTask!.WaitAsync(TimeSpan.FromSeconds(2)).GetAwaiter().GetResult();
        byte[] errors = _errTask!.WaitAsync(TimeSpan.FromSeconds(2)).GetAwaiter().GetResult();
        try { LaunchNative.Check(errors.Length == 0); string value = new UTF8Encoding(false, true).GetString(output).TrimEnd('\r', '\n'); _finished = true; return value; }
        finally { Array.Clear(output); Array.Clear(errors); if (_finished) { _process?.Dispose(); _process = null; _stdout?.Dispose(); _stderr?.Dispose(); } }
    }
    public void AbortOwned()
    {
        if (_process is null || _process.IsInvalid || _finished) return;
        if (NativeMethods.WaitForSingleObject(_process, 0) == NativeMethods.WaitTimeout)
            _abortFailed = !LaunchNative.TerminateProcess(_process, 75) || NativeMethods.WaitForSingleObject(_process, 5000) != 0;
    }
    public void Dispose()
    {
        AbortOwned();
        if (_thread != IntPtr.Zero) { if (!LaunchNative.CloseHandle(_thread)) _abortFailed = true; _thread = IntPtr.Zero; }
        _process?.Dispose(); _stdout?.Dispose(); _stderr?.Dispose();
        LaunchNative.Check(!_abortFailed && (_finished || !_resumed));
    }
}
