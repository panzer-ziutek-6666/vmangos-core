using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Runtime.Versioning;
using System.Security.AccessControl;

namespace Vmangos.Accounts.Windows;

public sealed record RuntimeProfile(IReadOnlyList<PayloadPin> Files)
{
    internal const string Root = @"C:\Program Files\dotnet";
    internal static readonly string[] Prefixes = ["host/fxr/10.0.12/", "shared/Microsoft.NETCore.App/10.0.12/"];
    internal static RuntimeProfile Parse(JsonElement value)
    {
        WireCodec.ExactFields(value, "root", "fxrVersion", "frameworkName", "frameworkVersion", "rollForward", "files");
        BoundaryLimits.Check(value.GetProperty("root").GetString() == Root && value.GetProperty("fxrVersion").GetString() == "10.0.12" &&
            value.GetProperty("frameworkName").GetString() == "Microsoft.NETCore.App" && value.GetProperty("frameworkVersion").GetString() == "10.0.12" &&
            value.GetProperty("rollForward").GetString() == "Disable", BoundaryError.InvalidSpec);
        var array = value.GetProperty("files");
        BoundaryLimits.Check(array.ValueKind == JsonValueKind.Array && array.GetArrayLength() is >= 4 and <= 2048, BoundaryError.InvalidSpec);
        var files = new List<PayloadPin>(); var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase); long total = 0;
        foreach (var item in array.EnumerateArray())
        {
            WireCodec.ExactFields(item, "path", "length", "sha256");
            string path = item.GetProperty("path").GetString() ?? "", hash = item.GetProperty("sha256").GetString() ?? "";
            int length = item.GetProperty("length").GetInt32();
            BoundaryLimits.Check(Prefixes.Any(p => path.StartsWith(p, StringComparison.Ordinal)) && path.Length < 220 &&
                path.Split('/').All(p => p.Length > 0 && p is not ("." or "..") && Regex.IsMatch(p, @"\A[A-Za-z0-9_.-]+\z", RegexOptions.CultureInvariant)) &&
                seen.Add(path) && length is > 0 and <= 134217728 && BoundaryLimits.IsHash(hash), BoundaryError.InvalidSpec);
            total += length; BoundaryLimits.Check(total <= 536870912, BoundaryError.InvalidSpec); files.Add(new(path, length, hash));
        }
        foreach (string required in new[] { "host/fxr/10.0.12/hostfxr.dll", "shared/Microsoft.NETCore.App/10.0.12/hostpolicy.dll",
            "shared/Microsoft.NETCore.App/10.0.12/coreclr.dll", "shared/Microsoft.NETCore.App/10.0.12/System.Private.CoreLib.dll" })
            BoundaryLimits.Check(seen.Contains(required), BoundaryError.InvalidSpec);
        return new(files.AsReadOnly());
    }
}

[SupportedOSPlatform("windows")]
internal sealed class RuntimeLease : IDisposable
{
    private readonly RuntimeProfile _profile;
    private readonly List<(PayloadPin Pin, FileStream Held)> _files = [];
    internal RuntimeLease(RuntimeProfile profile)
    {
        _profile = profile;
        try
        {
            Inventory();
            foreach (var pin in profile.Files)
            {
                var held = ProtectedFiles.OpenRead(PathOf(pin.RelativePath), null, requireAcl: false);
                _files.Add((pin, held));
            }
            Revalidate();
        }
        catch { Dispose(); throw; }
    }
    private static string PathOf(string relative) => RuntimeProfile.Root + "\\" + relative.Replace('/', '\\');
    private void Inventory()
    {
        using var root = Microsoft.Win32.RegistryKey.OpenBaseKey(Microsoft.Win32.RegistryHive.LocalMachine, Microsoft.Win32.RegistryView.Registry32);
        using var key = root.OpenSubKey(@"SOFTWARE\dotnet\Setup\InstalledVersions\x64", false);
        object? value = key?.GetValue("InstallLocation", null, Microsoft.Win32.RegistryValueOptions.DoNotExpandEnvironmentNames);
        BoundaryLimits.Check(key is not null && key.GetValueKind("InstallLocation") == Microsoft.Win32.RegistryValueKind.String &&
            (value is string v && (v.Equals(RuntimeProfile.Root, StringComparison.OrdinalIgnoreCase) || v.Equals(RuntimeProfile.Root + "\\", StringComparison.OrdinalIgnoreCase))), BoundaryError.InvalidSpec);
        foreach (string baseDir in new[] { @"host\fxr", @"shared\Microsoft.NETCore.App" })
        {
            string parent = PathOf(baseDir); AssertRuntimePath(parent);
            string[] versions = Directory.GetDirectories(parent);
            BoundaryLimits.Check(versions.Length == 1 && Path.GetFileName(versions[0]) == "10.0.12", BoundaryError.InvalidSpec);
        }
        var found = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (string prefix in RuntimeProfile.Prefixes)
        {
            var pending = new Stack<string>(); pending.Push(PathOf(prefix.TrimEnd('/'))); int entries = 0;
            while (pending.TryPop(out string? directory))
            {
                AssertRuntimePath(directory);
                foreach (string item in Directory.EnumerateFileSystemEntries(directory))
                {
                    BoundaryLimits.Check(++entries <= 4096 && (File.GetAttributes(item) & FileAttributes.ReparsePoint) == 0, BoundaryError.InvalidPath);
                    if (Directory.Exists(item)) pending.Push(item);
                    else { BoundaryLimits.Check(found.Add(Path.GetRelativePath(RuntimeProfile.Root, item).Replace('\\', '/')) && found.Count <= 2048, BoundaryError.InvalidSpec); }
                }
            }
        }
        BoundaryLimits.Check(found.SetEquals(_profile.Files.Select(p => p.RelativePath)), BoundaryError.PayloadChanged);
    }
    private static void AssertRuntimePath(string path)
    {
        DirectoryInfo? current = new(path);
        while (current is not null)
        {
            BoundaryLimits.Check(current.Exists && (current.Attributes & FileAttributes.ReparsePoint) == 0, BoundaryError.InvalidPath);
            var acl = current.GetAccessControl(); AssertRuntimeDescriptor(acl.GetSecurityDescriptorBinaryForm(), current.FullName.Length >= RuntimeProfile.Root.Length);
            current = current.Parent;
        }
    }
    internal static void AssertRuntimeDescriptor(byte[] bytes, bool runtimeObject = true)
    {
        var sd = new RawSecurityDescriptor(bytes, 0);
        string[] writers = ["S-1-5-18", "S-1-5-32-544", "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464"];
        BoundaryLimits.Check(sd.Owner is not null && writers.Contains(sd.Owner.Value) && sd.DiscretionaryAcl is not null && sd.DiscretionaryAcl.Count <= 64, BoundaryError.UntrustedAcl);
        foreach (GenericAce entry in sd.DiscretionaryAcl!)
        {
            BoundaryLimits.Check(entry is CommonAce c && !c.IsCallback, BoundaryError.UntrustedAcl);
            var ace = (CommonAce)entry;
            // Inherit-only ACEs do not grant access to this object.
            if (ace.AceQualifier == AceQualifier.AccessAllowed && (ace.AceFlags & AceFlags.InheritOnly) == 0 &&
                ((uint)ace.AccessMask & (runtimeObject ? 0x500D0156U : 0x500D0152U)) != 0)
                BoundaryLimits.Check(writers.Contains(ace.SecurityIdentifier.Value), BoundaryError.UntrustedAcl);
        }
    }
    internal void Revalidate()
    {
        Inventory();
        foreach (var pair in _files)
        {
            BoundaryLimits.Check(pair.Held.Length == pair.Pin.Length, BoundaryError.PayloadChanged);
            pair.Held.Position = 0; BoundaryLimits.Check(Convert.ToHexString(SHA256.HashData(pair.Held)) == pair.Pin.Sha256, BoundaryError.PayloadChanged);
            AssertRuntimeDescriptor(PipeAccessPolicy.ReadDescriptor(pair.Held.SafeFileHandle).GetBinaryFormBytes());
        }
    }
    public void Dispose() { foreach (var pair in _files) pair.Held.Dispose(); _files.Clear(); }
}

[SupportedOSPlatform("windows")]
internal static class DescriptorExtensions
{
    internal static byte[] GetBinaryFormBytes(this RawSecurityDescriptor value)
    { byte[] bytes = new byte[value.BinaryLength]; value.GetBinaryForm(bytes, 0); return bytes; }
}
