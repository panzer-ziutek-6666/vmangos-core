using System.Buffers.Binary;

namespace Vmangos.Accounts.Windows;

public static class BoundedFrames
{
    private static void CheckCap(int cap) => BoundaryLimits.Check(cap is > 0 and <= BoundaryLimits.FrameBytes, BoundaryError.FrameInvalid);

    public static async Task<byte[]> ReadAsync(Stream stream, int cap, CancellationToken token)
    {
        CheckCap(cap);
        byte[] prefix = new byte[4];
        byte[]? body = null;
        try
        {
            // Cancellation is passed to the actual I/O, never just WaitAsync.
            await stream.ReadExactlyAsync(prefix, token).ConfigureAwait(false);
            int length = BinaryPrimitives.ReadInt32LittleEndian(prefix);
            BoundaryLimits.Check(length > 0 && length <= cap, BoundaryError.FrameInvalid);
            body = new byte[length];
            await stream.ReadExactlyAsync(body, token).ConfigureAwait(false);
            return body;
        }
        catch { if (body is not null) Array.Clear(body); throw; }
        finally { Array.Clear(prefix); }
    }

    public static async Task WriteAsync(Stream stream, ReadOnlyMemory<byte> body, int cap, CancellationToken token)
    {
        CheckCap(cap);
        BoundaryLimits.Check(body.Length > 0 && body.Length <= cap, BoundaryError.FrameInvalid);
        byte[] prefix = new byte[4];
        try
        {
            BinaryPrimitives.WriteInt32LittleEndian(prefix, body.Length);
            await stream.WriteAsync(prefix, token).ConfigureAwait(false);
            await stream.WriteAsync(body, token).ConfigureAwait(false);
            // No FlushFileBuffers: it can wait for an untrusted peer to drain.
        }
        finally { Array.Clear(prefix); }
    }

    internal static async Task<byte[]> ReadTimedAsync(Stream stream, int cap, CancellationToken budget)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(budget);
        deadline.CancelAfter(BoundaryLimits.IoMs);
        return await ReadAsync(stream, cap, deadline.Token).ConfigureAwait(false);
    }

    internal static async Task WriteTimedAsync(Stream stream, byte[] body, int cap, CancellationToken budget)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(budget);
        deadline.CancelAfter(BoundaryLimits.IoMs);
        try { await WriteAsync(stream, body, cap, deadline.Token).ConfigureAwait(false); }
        finally { Array.Clear(body); }
    }
}
