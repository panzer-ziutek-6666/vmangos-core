using System.IO.Pipes;
using System.Runtime.Versioning;
using Microsoft.Win32.SafeHandles;

namespace Vmangos.Accounts.Windows;

[SupportedOSPlatform("windows")]
internal sealed class NativePipe : IDisposable
{
    private readonly PipeStream _stream;
    private bool _faulted;
    private readonly bool _server;
    public PipeStream Stream { get { BoundaryLimits.Check(!_faulted, BoundaryError.PipeUnavailable); return _stream; } }
    public SafePipeHandle Handle => _stream.SafePipeHandle;
    private NativePipe(PipeStream stream, bool server) { _stream = stream; _server = server; }

    public static NativePipe Server(Guid generation, string poolSid)
    {
        NativeMethods.RequireWindows();
        BoundaryLimits.Check(PeerProbe.CurrentSid() == BoundaryLimits.SystemSid, BoundaryError.PeerRejected);
        byte[] sd = PipeAccessPolicy.Bytes(PipeAccessPolicy.PipeSddl(poolSid));
        try
        {
            using var memory = new NativeMethods.DescriptorMemory(sd); var attributes = memory.Attributes;
            var handle = NativeMethods.CreateNamedPipeW(BoundaryLimits.PipeName(generation),
                3 | NativeMethods.FirstInstance | NativeMethods.Overlapped,
                NativeMethods.RejectRemote, 1, 4096, 4096, 2000, ref attributes);
            if (handle.IsInvalid) { handle.Dispose(); throw new BoundaryException(BoundaryError.PipeUnavailable); }
            try
            {
                PipeAccessPolicy.AssertPipe(handle, poolSid);
                return new(new NamedPipeServerStream(PipeDirection.InOut, true, false, handle), true);
            }
            catch { handle.Dispose(); throw; }
        }
        finally { Array.Clear(sd); }
    }

    public static NativePipe Client(Guid generation, string poolSid)
    {
        NativeMethods.RequireWindows();
        BoundaryLimits.Check(PeerProbe.CurrentSid() == poolSid && BoundaryLimits.IsPoolSid(poolSid), BoundaryError.PeerRejected);
        string name = BoundaryLimits.PipeName(generation);
        BoundaryLimits.Check(NativeMethods.WaitNamedPipeW(name, BoundaryLimits.ConnectMs), BoundaryError.PipeUnavailable);
        var handle = NativeMethods.CreateFileW(name, PipeAccessPolicy.ClientMask, 0, IntPtr.Zero, 3,
            NativeMethods.Overlapped | NativeMethods.SqosPresent | NativeMethods.SecurityIdentification, IntPtr.Zero);
        if (handle.IsInvalid) { handle.Dispose(); throw new BoundaryException(BoundaryError.PipeUnavailable); }
        try
        {
            PipeAccessPolicy.AssertPipe(handle, poolSid);
            return new(new NamedPipeClientStream(PipeDirection.InOut, true, true, handle), false);
        }
        catch { handle.Dispose(); throw; }
    }

    public async Task ConnectAsync(CancellationToken budget)
    {
        BoundaryLimits.Check(_server && !_faulted, BoundaryError.PipeUnavailable);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(budget);
        timeout.CancelAfter(BoundaryLimits.ConnectMs);
        try { await ((NamedPipeServerStream)_stream).WaitForConnectionAsync(timeout.Token).ConfigureAwait(false); }
        catch { Abort(); throw; }
    }

    public void Disconnect()
    {
        BoundaryLimits.Check(_server && !_faulted, BoundaryError.PipeUnavailable);
        // Retain the original FIRST_PIPE_INSTANCE handle across successful sessions.
        ((NamedPipeServerStream)_stream).Disconnect();
    }

    public void Abort()
    {
        if (_faulted) return;
        _faulted = true;
        try { if (!_stream.SafePipeHandle.IsClosed) _ = NativeMethods.CancelIoEx(_stream.SafePipeHandle, IntPtr.Zero); }
        finally { _stream.Dispose(); }
    }
    public void Dispose() => Abort();
}
