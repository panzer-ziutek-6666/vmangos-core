using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;

[assembly: InternalsVisibleTo("Vmangos.Accounts.Windows.Tests")]

namespace Vmangos.Accounts.Windows;

public enum BoundaryError
{
    WindowsRequired, InvalidSpec, InvalidPath, UntrustedAcl, PayloadChanged,
    InvalidReceipt, PipeUnavailable, PeerRejected, TokenUnavailable,
    ImpersonationFailed, FrameInvalid, HandshakeInvalid, OperatorRejected,
    Timeout, TransportUncertain, StorageUnavailable, Unexpected
}

public sealed class BoundaryException : IOException
{
    public BoundaryError Code { get; }
    public BoundaryException(BoundaryError code) : base("A135_" + code.ToString().ToUpperInvariant()) => Code = code;
}

public static class BoundaryLimits
{
    public const int HandshakeBytes = 512, FrameBytes = 4096, SpecBytes = 262144;
    public const int ConnectMs = 3000, IoMs = 2000, WorkerMs = 90000, MaxSessions = 16;
    public const string SystemSid = "S-1-5-18";
    public const string TargetPoolSid = "S-1-5-82-2192834305-681035450-1731772730-1791053079-2169464979";
    public static string PipeName(Guid generation)
    {
        Check(generation != Guid.Empty, BoundaryError.InvalidSpec);
        return @"\\.\pipe\VMANGOS-Accounts-A135-" + generation.ToString("N");
    }
    internal static bool IsPoolSid(string value) => value.Length <= 184 && Regex.IsMatch(value,
        @"\AS-1-5-82-(?:[0-9]{1,10}-){4}[0-9]{1,10}\z", RegexOptions.CultureInvariant) &&
        value.Split('-').Skip(4).All(p => uint.TryParse(p, out _));
    internal static bool IsHash(string value) => value.Length == 64 && value.All(c => c is >= '0' and <= '9' or >= 'A' and <= 'F');
    internal static void Check(bool condition, BoundaryError code)
    { if (!condition) throw new BoundaryException(code); }
}

// No constructor accepts peer evidence from a wire DTO. Real leases are made
// only by the native pipe probe; the internal interface permits model tests.
internal interface IPeerLease : IDisposable
{
    void Revalidate();
}

public sealed record FixtureOutcome(Guid OperationId, string State, string ErrorCode, int DispatchAttempts)
{
    public bool Synthetic => true;
    public static FixtureOutcome Unknown(Guid id) => new(id, "unknown", "TransportUncertain", 1);
}
