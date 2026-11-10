using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.AccessControl;

namespace Vmangos.Accounts.Windows;

public static class PipeAccessPolicy
{
    // ReadData | WriteData | ReadAttributes | ReadControl | Synchronize.
    // NO AppendData/CreatePipeInstance, WriteDacl, WriteOwner or generic rights.
    public const uint ClientMask = 0x00120083;
    public const uint CreateInstance = 4, FullControl = 0x001F01FF, ReadExecute = 0x001200A9;
    public static string PipeSddl(string clientSid)
    {
        BoundaryLimits.Check(BoundaryLimits.IsPoolSid(clientSid), BoundaryError.InvalidSpec);
        return "O:SYG:SYD:P(A;;FA;;;SY)(A;;0x00120083;;;" + clientSid + ")";
    }
    internal static string FileSddl(string? clientSid)
    {
        BoundaryLimits.Check(clientSid is null || BoundaryLimits.IsPoolSid(clientSid), BoundaryError.InvalidSpec);
        return "O:SYG:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)" + (clientSid is null ? "" : "(A;;0x001200A9;;;" + clientSid + ")");
    }

    [SupportedOSPlatform("windows")]
    internal static byte[] Bytes(string sddl)
    {
        var descriptor = new RawSecurityDescriptor(sddl);
        byte[] bytes = new byte[descriptor.BinaryLength]; descriptor.GetBinaryForm(bytes, 0); return bytes;
    }

    [SupportedOSPlatform("windows")]
    internal static RawSecurityDescriptor ReadDescriptor(SafeHandle handle)
    {
        _ = NativeMethods.GetKernelObjectSecurity(handle, 7, null, 0, out uint needed);
        BoundaryLimits.Check(needed is > 0 and <= 16384, BoundaryError.UntrustedAcl);
        byte[] buffer = new byte[needed];
        try
        {
            BoundaryLimits.Check(NativeMethods.GetKernelObjectSecurity(handle, 7, buffer, (uint)buffer.Length, out uint actual) &&
                actual <= buffer.Length, BoundaryError.UntrustedAcl);
            return new RawSecurityDescriptor(buffer, 0);
        }
        finally { Array.Clear(buffer); }
    }

    [SupportedOSPlatform("windows")]
    internal static void AssertPipe(SafeHandle handle, string clientSid)
    {
        var sd = ReadDescriptor(handle);
        BoundaryLimits.Check(sd.Owner?.Value == BoundaryLimits.SystemSid && sd.Group?.Value == BoundaryLimits.SystemSid &&
            (sd.ControlFlags & ControlFlags.DiscretionaryAclProtected) != 0 && sd.DiscretionaryAcl?.Count == 2, BoundaryError.UntrustedAcl);
        var expected = new Dictionary<string, uint>(StringComparer.Ordinal) { [BoundaryLimits.SystemSid] = FullControl, [clientSid] = ClientMask };
        AssertEntries(sd, expected, allowInheritance: false);
    }

    [SupportedOSPlatform("windows")]
    internal static void AssertFile(SafeHandle handle, string? clientSid, bool directory)
    {
        var sd = ReadDescriptor(handle);
        BoundaryLimits.Check(sd.Owner?.Value is BoundaryLimits.SystemSid or "S-1-5-32-544" &&
            (sd.ControlFlags & ControlFlags.DiscretionaryAclProtected) != 0, BoundaryError.UntrustedAcl);
        var expected = new Dictionary<string, uint>(StringComparer.Ordinal) { [BoundaryLimits.SystemSid] = FullControl, ["S-1-5-32-544"] = FullControl };
        if (clientSid is not null) expected.Add(clientSid, ReadExecute);
        AssertEntries(sd, expected, directory);
    }

    [SupportedOSPlatform("windows")]
    private static void AssertEntries(RawSecurityDescriptor sd, Dictionary<string, uint> expected, bool allowInheritance)
    {
        BoundaryLimits.Check(sd.DiscretionaryAcl is not null && sd.DiscretionaryAcl.Count == expected.Count, BoundaryError.UntrustedAcl);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (GenericAce entry in sd.DiscretionaryAcl!)
        {
            var ace = entry as CommonAce;
            BoundaryLimits.Check(ace is not null && !ace.IsCallback && ace.AceQualifier == AceQualifier.AccessAllowed,
                BoundaryError.UntrustedAcl);
            string sid = ace!.SecurityIdentifier.Value;
            BoundaryLimits.Check(expected.TryGetValue(sid, out uint mask) && (uint)ace.AccessMask == mask && seen.Add(sid) &&
                (ace.AceFlags == AceFlags.None || allowInheritance && ace.AceFlags == (AceFlags.ContainerInherit | AceFlags.ObjectInherit)),
                BoundaryError.UntrustedAcl);
        }
    }
}
