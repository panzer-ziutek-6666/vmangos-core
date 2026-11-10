using System.Runtime.Versioning;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;

namespace Vmangos.Accounts.Windows;

[SupportedOSPlatform("windows")]
internal static class ProtectedFiles
{
    private static void RegularAncestors(string path)
    {
        NativeMethods.RequireWindows();
        BoundaryLimits.Check(Path.IsPathFullyQualified(path) && path.StartsWith(@"C:\", StringComparison.Ordinal) && path.Length < 240 &&
            path.IndexOf(':', 2) < 0 && Path.GetFullPath(path) == path, BoundaryError.InvalidPath);
        for (var parent = new FileInfo(path).Directory; parent is not null; parent = parent.Parent)
            BoundaryLimits.Check(parent.Exists && (parent.Attributes & FileAttributes.ReparsePoint) == 0, BoundaryError.InvalidPath);
        BoundaryLimits.Check(File.Exists(path) && (File.GetAttributes(path) & (FileAttributes.ReparsePoint | FileAttributes.Directory)) == 0,
            BoundaryError.InvalidPath);
    }

    internal static string FinalPath(SafeFileHandle file)
    {
        char[] chars = new char[32768]; uint n = NativeMethods.GetFinalPathNameByHandleW(file, chars, (uint)chars.Length, 0);
        BoundaryLimits.Check(n is > 0 and < 32768, BoundaryError.InvalidPath);
        string result = new(chars, 0, (int)n);
        return result.StartsWith(@"\\?\", StringComparison.Ordinal) ? result[4..] : result;
    }

    internal static FileStream OpenRead(string path, string? clientSid, bool requireAcl = true)
    {
        RegularAncestors(path);
        var handle = NativeMethods.OpenFile(path, 0x00020081, 1, IntPtr.Zero, 3, NativeMethods.OpenReparse, IntPtr.Zero);
        if (handle.IsInvalid) { handle.Dispose(); throw new BoundaryException(BoundaryError.InvalidPath); }
        try
        {
            BoundaryLimits.Check(FinalPath(handle).Equals(path, StringComparison.OrdinalIgnoreCase) &&
                (File.GetAttributes(path) & FileAttributes.ReparsePoint) == 0, BoundaryError.InvalidPath);
            if (requireAcl) PipeAccessPolicy.AssertFile(handle, clientSid, false);
            return new FileStream(handle, FileAccess.Read);
        }
        catch { handle.Dispose(); throw; }
    }

    internal static byte[] ReadSmall(string path, int cap)
    {
        BoundaryLimits.Check(cap is > 0 and <= BoundaryLimits.SpecBytes, BoundaryError.InvalidSpec);
        using var stream = OpenRead(path, null, requireAcl: false);
        BoundaryLimits.Check(stream.Length > 0 && stream.Length <= cap, BoundaryError.InvalidSpec);
        byte[] result = new byte[(int)stream.Length];
        try { stream.ReadExactly(result); return result; }
        catch { Array.Clear(result); throw; }
    }

    internal static void AssertDirectory(string path, string? clientSid)
    {
        BoundaryLimits.Check(Directory.Exists(path) && (File.GetAttributes(path) & FileAttributes.ReparsePoint) == 0, BoundaryError.InvalidPath);
        using var handle = NativeMethods.OpenFile(path, NativeMethods.ReadControl, 1 | 2, IntPtr.Zero, 3,
            NativeMethods.BackupSemantics | NativeMethods.OpenReparse, IntPtr.Zero);
        BoundaryLimits.Check(!handle.IsInvalid && FinalPath(handle).Equals(path, StringComparison.OrdinalIgnoreCase), BoundaryError.InvalidPath);
        PipeAccessPolicy.AssertFile(handle, clientSid, true);
    }

    internal static void CreateNew(string path, byte[] data, string? clientSid)
    {
        BoundaryLimits.Check(PeerProbe.CurrentSid() == BoundaryLimits.SystemSid && Path.IsPathFullyQualified(path) &&
            path.Length < 240 && data.Length <= BoundaryLimits.SpecBytes, BoundaryError.InvalidPath);
        string parent = Path.GetDirectoryName(path)!;
        AssertDirectory(parent, clientSid);
        byte[] sd = PipeAccessPolicy.Bytes(PipeAccessPolicy.FileSddl(clientSid));
        try
        {
            using var memory = new NativeMethods.DescriptorMemory(sd); var attributes = memory.Attributes;
            using var handle = NativeMethods.NewFile(path, 0x40000000 | NativeMethods.ReadControl, 1, ref attributes, 1, 0x80000000, IntPtr.Zero);
            BoundaryLimits.Check(!handle.IsInvalid && FinalPath(handle).Equals(path, StringComparison.OrdinalIgnoreCase), BoundaryError.InvalidPath);
            PipeAccessPolicy.AssertFile(handle, clientSid, false);
            using var stream = new FileStream(handle, FileAccess.Write);
            stream.Write(data); stream.Flush(true);
        }
        finally { Array.Clear(sd); }
    }
}

[SupportedOSPlatform("windows")]
internal sealed class BundleLease : IDisposable
{
    private readonly List<(PayloadPin Pin, FileStream Stream)> _files = [];
    private readonly FixtureSpec _spec;
    public string ImagePath { get; }
    public BundleLease(FixtureSpec spec, BundleProfile profile)
    {
        _spec = spec; ImagePath = spec.PathOf(profile.Image);
        try
        {
            foreach (var pin in profile.Files)
            {
                var stream = ProtectedFiles.OpenRead(spec.PathOf(pin.RelativePath), spec.ClientSid);
                _files.Add((pin, stream));
            }
            Revalidate();
        }
        catch { Dispose(); throw; }
    }
    public void Revalidate()
    {
        BoundaryLimits.Check(_files.Count >= 6, BoundaryError.PayloadChanged);
        foreach (var pair in _files)
        {
            BoundaryLimits.Check(pair.Stream.Length == pair.Pin.Length &&
                ProtectedFiles.FinalPath(pair.Stream.SafeFileHandle).Equals(_spec.PathOf(pair.Pin.RelativePath), StringComparison.OrdinalIgnoreCase), BoundaryError.PayloadChanged);
            pair.Stream.Position = 0;
            BoundaryLimits.Check(Convert.ToHexString(SHA256.HashData(pair.Stream)) == pair.Pin.Sha256, BoundaryError.PayloadChanged);
            PipeAccessPolicy.AssertFile(pair.Stream.SafeFileHandle, _spec.ClientSid, false);
        }
    }
    public void Dispose() { foreach (var pair in _files) pair.Stream.Dispose(); _files.Clear(); }
}
