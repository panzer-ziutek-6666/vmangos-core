using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.AccessControl;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;

namespace Vmangos.Accounts.Windows;

[SupportedOSPlatform("windows")]
internal sealed class PrivatePrimaryToken : IDisposable
{
    internal SafeAccessTokenHandle Handle { get; }
    internal ulong Id { get; }
    internal string Sid { get; }
    private readonly SafeAccessTokenHandle _source;
    private readonly byte[] _sourceDescriptor;
    private readonly ulong _sourceId;
    private readonly byte[] _sourceDefault;
    private readonly string _sourceState;
    internal PrivatePrimaryToken(SafeAccessTokenHandle source, string expectedSid, string poolSid)
    {
        _source = source; Sid = expectedSid;
        var stats = LaunchNative.Stats(source); _sourceId = stats.TokenId.Value;
        LaunchNative.Check(stats.Type == 1 && LaunchNative.Sid(source) == expectedSid);
        _sourceDescriptor = Descriptor(source); _sourceDefault = DefaultDacl(source); _sourceState = TokenState(source);
        byte[] bytes = PipeAccessPolicy.Bytes(ProcessAccessPolicy.TokenDacl(poolSid));
        try
        {
            using var memory = new NativeMethods.DescriptorMemory(bytes); var a = memory.Attributes;
            LaunchNative.Check(LaunchNative.DuplicateTokenEx(source, 0x0002000B, ref a, 2, 1, out var copy));
            Handle = copy;
            try
            {
                var copied = LaunchNative.Stats(copy); Id = copied.TokenId.Value;
                LaunchNative.Check(copied.Type == 1 && Id != _sourceId && copied.AuthenticationId.Value == stats.AuthenticationId.Value && LaunchNative.Sid(copy) == expectedSid);
                AssertNewDescriptor(copy, false, expectedSid == BoundaryLimits.SystemSid, poolSid);
                LaunchNative.Check(DefaultDacl(copy).AsSpan().SequenceEqual(_sourceDefault));
                VerifySource();
            }
            catch { Handle.Dispose(); throw; }
        }
        finally { Array.Clear(bytes); }
    }
    internal static byte[] Descriptor(SafeHandle handle) => PipeAccessPolicy.ReadDescriptor(handle).GetBinaryFormBytes();
    private static byte[] DefaultDacl(SafeAccessTokenHandle token)
    {
        _ = NativeMethods.GetTokenInformation(token, 6, IntPtr.Zero, 0, out uint size); LaunchNative.Check(size is >= 8 and <= 65536);
        IntPtr p = Marshal.AllocHGlobal((int)size);
        try
        {
            LaunchNative.Check(NativeMethods.GetTokenInformation(token, 6, p, size, out uint actual) && actual <= size);
            IntPtr acl = Marshal.ReadIntPtr(p);
            if (acl == IntPtr.Zero) return [];
            int length = (ushort)Marshal.ReadInt16(acl, 2); LaunchNative.Check(length is >= 8 and <= 65536);
            byte[] result = new byte[length]; Marshal.Copy(acl, result, 0, length); return result;
        }
        finally { Marshal.FreeHGlobal(p); }
    }
    private static string TokenState(SafeAccessTokenHandle token)
    {
        string Read(int kind)
        {
            _ = NativeMethods.GetTokenInformation(token, kind, IntPtr.Zero, 0, out uint size); LaunchNative.Check(size is > 0 and <= 65536);
            IntPtr pointer = Marshal.AllocHGlobal((int)size);
            try
            {
                LaunchNative.Check(NativeMethods.GetTokenInformation(token, kind, pointer, size, out uint actual) && actual <= size);
                if (kind == 2)
                {
                    uint count = (uint)Marshal.ReadInt32(pointer); LaunchNative.Check(count <= 1024 && 8L + count * 16L <= actual);
                    var groups = new List<string>();
                    for (int i = 0; i < count; i++)
                    {
                        IntPtr entry = IntPtr.Add(pointer, 8 + i * 16);
                        LaunchNative.Check(NativeMethods.ConvertSidToStringSidW(Marshal.ReadIntPtr(entry), out IntPtr text));
                        try { groups.Add(Marshal.PtrToStringUni(text) + ":" + ((uint)Marshal.ReadInt32(entry, 8)).ToString("X8")); }
                        finally { _ = NativeMethods.LocalFree(text); }
                    }
                    groups.Sort(StringComparer.Ordinal); return string.Join('|', groups);
                }
                byte[] bytes = new byte[actual];
                try { Marshal.Copy(pointer, bytes, 0, bytes.Length); return Convert.ToHexString(SHA256.HashData(bytes)); }
                finally { Array.Clear(bytes); }
            }
            finally { Marshal.FreeHGlobal(pointer); }
        }
        return Read(2) + "/" + Read(3) + "/" + Read(12);
    }
    internal void VerifySource()
    {
        LaunchNative.Check(LaunchNative.Stats(_source).TokenId.Value == _sourceId && LaunchNative.Sid(_source) == Sid &&
            Descriptor(_source).AsSpan().SequenceEqual(_sourceDescriptor) && DefaultDacl(_source).AsSpan().SequenceEqual(_sourceDefault) && TokenState(_source) == _sourceState);
    }
    internal static void AssertNewDescriptor(SafeHandle handle, bool process, bool systemOwner, string poolSid)
    {
        var sd = PipeAccessPolicy.ReadDescriptor(handle);
        LaunchNative.Check(sd.Owner is not null && (!systemOwner || sd.Owner.Value == BoundaryLimits.SystemSid) &&
            (sd.ControlFlags & ControlFlags.DiscretionaryAclProtected) != 0 && sd.DiscretionaryAcl?.Count == 3);
        var expected = new Dictionary<string, uint> { [BoundaryLimits.SystemSid] = process ? ProcessAccessPolicy.ProcessFull : ProcessAccessPolicy.TokenFull,
            ["S-1-5-32-544"] = process ? ProcessAccessPolicy.ProcessFull : ProcessAccessPolicy.TokenFull,
            [poolSid] = process ? ProcessAccessPolicy.ProcessRead : ProcessAccessPolicy.TokenRead };
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (GenericAce entry in sd.DiscretionaryAcl!)
        {
            LaunchNative.Check(entry is CommonAce a && !a.IsCallback && a.AceQualifier == AceQualifier.AccessAllowed && a.AceFlags == AceFlags.None);
            var ace = (CommonAce)entry; LaunchNative.Check(expected.TryGetValue(ace.SecurityIdentifier.Value, out uint mask) && (uint)ace.AccessMask == mask && seen.Add(ace.SecurityIdentifier.Value));
        }
    }
    public void Dispose() { try { VerifySource(); } finally { Handle.Dispose(); Array.Clear(_sourceDescriptor); Array.Clear(_sourceDefault); } }
}

[SupportedOSPlatform("windows")]
internal sealed class FixtureJob : IDisposable
{
    internal IntPtr Handle { get; private set; }
    internal FixtureJob()
    {
        Handle = LaunchNative.CreateJobObjectW(IntPtr.Zero, null); LaunchNative.Check(Handle != IntPtr.Zero);
        var limits = new LaunchNative.ExtendedLimit { Basic = new LaunchNative.BasicLimit { Flags = 0x2000 | 8, Processes = 3 } };
        if (!LaunchNative.SetInformationJobObject(Handle, 9, ref limits, (uint)Marshal.SizeOf<LaunchNative.ExtendedLimit>()))
        { _ = LaunchNative.CloseHandle(Handle); Handle = IntPtr.Zero; throw new BoundaryException(BoundaryError.PeerRejected); }
    }
    internal uint Active()
    { LaunchNative.Check(LaunchNative.QueryInformationJobObject(Handle, 1, out var a, (uint)Marshal.SizeOf<LaunchNative.Accounting>(), IntPtr.Zero)); return a.Active; }
    internal bool Finish()
    {
        for (int i = 0; i < 80; i++) { if (Active() == 0) return true; Thread.Sleep(25); }
        return false;
    }
    public void Dispose()
    {
        if (Handle == IntPtr.Zero) return;
        bool clean = Finish();
        if (!clean) _ = LaunchNative.TerminateJobObject(Handle, 75);
        bool closed = LaunchNative.CloseHandle(Handle); Handle = IntPtr.Zero;
        LaunchNative.Check(clean && closed);
    }
}
