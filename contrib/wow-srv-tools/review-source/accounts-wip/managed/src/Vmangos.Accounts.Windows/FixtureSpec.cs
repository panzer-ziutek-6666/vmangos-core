using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Vmangos.Accounts.Core;

namespace Vmangos.Accounts.Windows;

public sealed record PayloadPin(string RelativePath, int Length, string Sha256);
public sealed class BundleProfile
{
    public string Image { get; }
    public IReadOnlyList<PayloadPin> Files { get; }
    internal BundleProfile(string image, PayloadPin[] files) { Image = image; Files = Array.AsReadOnly(files); }
}

public sealed class FixtureSpec
{
    public string Root { get; }
    public string Sha256 { get; }
    public Guid Generation { get; }
    public string ClientSid { get; }
    public string OperatorSid { get; }
    public int SessionLimit { get; }
    public BundleProfile Worker { get; }
    public BundleProfile Client { get; }
    public BundleProfile Launcher { get; }
    public RuntimeProfile Runtime { get; }
    internal string PathOf(string relative) => Root + "\\" + relative.Replace('/', '\\');

    private FixtureSpec(string root, string sha, Guid generation, string clientSid, string operatorSid, int limit,
        BundleProfile worker, BundleProfile client, BundleProfile launcher, RuntimeProfile runtime)
    { Root = root; Sha256 = sha; Generation = generation; ClientSid = clientSid; OperatorSid = operatorSid; SessionLimit = limit; Worker = worker; Client = client; Launcher = launcher; Runtime = runtime; }

    [SupportedOSPlatform("windows")]
    public static FixtureSpec Load(string root, string expectedSha256)
    {
        NativeMethods.RequireWindows();
        BoundaryLimits.Check(BoundaryLimits.IsHash(expectedSha256) && IsRoot(root), BoundaryError.InvalidSpec);
        // Parse a hash-authenticated spec first. Then require its exact protected
        // ACL, whose read-only pool SID comes from those authenticated bytes.
        byte[] bytes = ProtectedFiles.ReadSmall(root + "\\run-spec.json", BoundaryLimits.SpecBytes);
        try
        {
            var spec = Parse(root, bytes, expectedSha256);
            using var held = ProtectedFiles.OpenRead(spec.PathOf("run-spec.json"), spec.ClientSid);
            BoundaryLimits.Check(held.Length == bytes.Length && Convert.ToHexString(SHA256.HashData(held)) == expectedSha256,
                BoundaryError.PayloadChanged);
            ProtectedFiles.AssertDirectory(root, spec.ClientSid);
            return spec;
        }
        finally { Array.Clear(bytes); }
    }

    internal static bool IsRoot(string root) => root.Length < 160 && Regex.IsMatch(root,
        @"\AC:\\VMANGOS-Accounts-Fixture-A139-[0-9a-f]{32}\z", RegexOptions.CultureInvariant);

    internal static FixtureSpec Parse(string root, ReadOnlyMemory<byte> bytes, string expectedSha256)
    {
        try
        {
            BoundaryLimits.Check(IsRoot(root) && BoundaryLimits.IsHash(expectedSha256) && bytes.Length is > 0 and <= BoundaryLimits.SpecBytes &&
                Convert.ToHexString(SHA256.HashData(bytes.Span)) == expectedSha256, BoundaryError.InvalidSpec);
            using var doc = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 5 }); var top = doc.RootElement;
            WireCodec.ExactFields(top, "schema", "generation", "clientSid", "operatorSid", "sessionLimit", "worker", "client", "launcher", "runtime", "processAccessPolicy", "limits");
            BoundaryLimits.Check(top.GetProperty("schema").GetString() == "A139-FIXTURE-1" &&
                Guid.TryParseExact(top.GetProperty("generation").GetString(), "D", out Guid generation) && generation != Guid.Empty,
                BoundaryError.InvalidSpec);
            generation = Guid.ParseExact(top.GetProperty("generation").GetString()!, "D");
            BoundaryLimits.Check(root.EndsWith(generation.ToString("N"), StringComparison.Ordinal), BoundaryError.InvalidSpec);
            string sid = top.GetProperty("clientSid").GetString() ?? "", op = top.GetProperty("operatorSid").GetString() ?? "";
            int limit = top.GetProperty("sessionLimit").GetInt32();
            BoundaryLimits.Check(top.GetProperty("processAccessPolicy").GetString() == ProcessAccessPolicy.Id, BoundaryError.InvalidSpec);
            ProcessAccessPolicy.AssertLimits(top.GetProperty("limits"));
            var runtime = RuntimeProfile.Parse(top.GetProperty("runtime"));
            BoundaryLimits.Check(BoundaryLimits.IsPoolSid(sid) && AccountPolicy.ValidSid(op) &&
                op.StartsWith("S-1-5-21-", StringComparison.Ordinal) && limit == 2 && sid == BoundaryLimits.TargetPoolSid, BoundaryError.InvalidSpec);
            var worker = Bundle(top.GetProperty("worker"), "worker", "Vmangos.Accounts.Worker");
            var client = Bundle(top.GetProperty("client"), "client", "Vmangos.Accounts.Windows.Tests");
            var launcher = Bundle(top.GetProperty("launcher"), "launcher", "Vmangos.Accounts.FixtureLauncher");
            foreach (string name in new[] { "Vmangos.Accounts.Core.dll", "Vmangos.Accounts.Windows.dll" })
            {
                var w = worker.Files.Single(f => f.RelativePath.EndsWith("/" + name, StringComparison.Ordinal));
                var c = client.Files.Single(f => f.RelativePath.EndsWith("/" + name, StringComparison.Ordinal));
                var l = launcher.Files.Single(f => f.RelativePath.EndsWith("/" + name, StringComparison.Ordinal));
                BoundaryLimits.Check(w.Sha256 == c.Sha256 && w.Length == c.Length && w.Sha256 == l.Sha256 && w.Length == l.Length, BoundaryError.InvalidSpec);
            }
            return new(root, expectedSha256, generation, sid, op, limit, worker, client, launcher, runtime);
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException or ArgumentException or FormatException or OverflowException)
        { throw new BoundaryException(BoundaryError.InvalidSpec); }
    }

    private static BundleProfile Bundle(JsonElement value, string directory, string app)
    {
        WireCodec.ExactFields(value, "image", "files");
        string image = value.GetProperty("image").GetString() ?? "";
        BoundaryLimits.Check(image == directory + "/" + app + ".exe", BoundaryError.InvalidSpec);
        var array = value.GetProperty("files");
        BoundaryLimits.Check(array.ValueKind == JsonValueKind.Array && array.GetArrayLength() is >= 6 and <= 12, BoundaryError.InvalidSpec);
        var required = new HashSet<string>(StringComparer.Ordinal)
        { app + ".exe", app + ".dll", app + ".deps.json", app + ".runtimeconfig.json", "Vmangos.Accounts.Core.dll", "Vmangos.Accounts.Windows.dll" };
        var allowed = new HashSet<string>(required, StringComparer.Ordinal) { app + ".pdb", "Vmangos.Accounts.Core.pdb", "Vmangos.Accounts.Windows.pdb" };
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase); var pins = new List<PayloadPin>(); long total = 0;
        foreach (var item in array.EnumerateArray())
        {
            WireCodec.ExactFields(item, "path", "length", "sha256");
            string path = item.GetProperty("path").GetString() ?? "", hash = item.GetProperty("sha256").GetString() ?? "";
            int length = item.GetProperty("length").GetInt32();
            string basename = path.StartsWith(directory + "/", StringComparison.Ordinal) ? path[(directory.Length + 1)..] : "";
            BoundaryLimits.Check(allowed.Contains(basename) && seen.Add(basename) && length is > 0 and <= 8388608 &&
                BoundaryLimits.IsHash(hash), BoundaryError.InvalidSpec);
            total += length; BoundaryLimits.Check(total <= 16777216, BoundaryError.InvalidSpec);
            pins.Add(new(path, length, hash));
        }
        BoundaryLimits.Check(required.All(seen.Contains), BoundaryError.InvalidSpec);
        return new(image, pins.ToArray());
    }
}
