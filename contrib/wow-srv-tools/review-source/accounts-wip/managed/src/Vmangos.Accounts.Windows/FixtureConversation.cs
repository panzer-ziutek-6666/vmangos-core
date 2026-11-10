using Vmangos.Accounts.Core;

namespace Vmangos.Accounts.Windows;

internal static class FixtureConversation
{
    // MODEL seam is internal, never a public method for supplying PeerProof.
    internal static async Task ServerAsync(Stream stream, Guid generation, string operatorSid,
        Func<IPeerLease> probeAfterHello, OperationEngine engine, CancellationToken budget)
    {
        byte[]? hello = null, body = null;
        try
        {
            hello = await BoundedFrames.ReadTimedAsync(stream, BoundaryLimits.HandshakeBytes, budget).ConfigureAwait(false);
            Guid nonce = WireCodec.ReadHandshake(hello, generation, false);
            using var peer = probeAfterHello();
            peer.Revalidate();
            await BoundedFrames.WriteTimedAsync(stream, WireCodec.Handshake(generation, nonce, true), BoundaryLimits.HandshakeBytes, budget).ConfigureAwait(false);
            body = await BoundedFrames.ReadTimedAsync(stream, BoundaryLimits.FrameBytes, budget).ConfigureAwait(false);
            using var request = WireCodec.ReadRequest(body, generation, operatorSid);
            Array.Clear(body); body = null;
            peer.Revalidate();
            var result = await engine.ExecuteAsync(request, operatorSid, budget).ConfigureAwait(false);
            await BoundedFrames.WriteTimedAsync(stream, WireCodec.Response(result), BoundaryLimits.FrameBytes, budget).ConfigureAwait(false);
        }
        finally
        {
            if (hello is not null) Array.Clear(hello);
            if (body is not null) Array.Clear(body);
        }
    }

    internal static async Task<FixtureOutcome> ClientAsync(Stream stream, Guid generation, string operatorSid,
        CreateAccountRequest request, IPeerLease verifiedServer, CancellationToken budget)
    {
        bool mayHaveSent = false; byte[]? ack = null, reply = null;
        try
        {
            verifiedServer.Revalidate();
            Guid nonce = Guid.NewGuid();
            await BoundedFrames.WriteTimedAsync(stream, WireCodec.Handshake(generation, nonce, false), BoundaryLimits.HandshakeBytes, budget).ConfigureAwait(false);
            ack = await BoundedFrames.ReadTimedAsync(stream, BoundaryLimits.HandshakeBytes, budget).ConfigureAwait(false);
            _ = WireCodec.ReadHandshake(ack, generation, true, nonce);
            verifiedServer.Revalidate();
            byte[] frame = WireCodec.Request(request, operatorSid, generation);
            // Even a partial write can cross admission. Never claim no effect.
            mayHaveSent = true;
            await BoundedFrames.WriteTimedAsync(stream, frame, BoundaryLimits.FrameBytes, budget).ConfigureAwait(false);
            reply = await BoundedFrames.ReadTimedAsync(stream, BoundaryLimits.FrameBytes, budget).ConfigureAwait(false);
            return WireCodec.ReadResponse(reply, request.OperationId);
        }
        catch when (mayHaveSent) { return FixtureOutcome.Unknown(request.OperationId); }
        finally
        {
            if (ack is not null) Array.Clear(ack);
            if (reply is not null) Array.Clear(reply);
        }
    }
}
