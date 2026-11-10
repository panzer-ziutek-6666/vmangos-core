using System.Security.Cryptography;
using System.Text;
using Vmangos.Accounts.Windows;

namespace Vmangos.Accounts.Windows.Tests;

internal static class LocationModelTests
{
    internal static async Task Run(Func<string, Func<Task>, Task> test, Action<bool> check)
    {
        Task Sync(Action action) { action(); return Task.CompletedTask; }
        void Refuse(Action action)
        {
            bool refused = false;
            try { action(); } catch (BoundaryException) { refused = true; }
            check(refused);
        }
        FixtureSpec Parse(string root, string schema = "A139-FIXTURE-1", Guid? generation = null)
        {
            var node = ModelData.SpecNode(); node["schema"] = schema;
            if (generation.HasValue) node["generation"] = generation.Value.ToString("D");
            byte[] bytes = Encoding.UTF8.GetBytes(node.ToJsonString());
            return FixtureSpec.Parse(root, bytes, Convert.ToHexString(SHA256.HashData(bytes)));
        }
        string id = ModelData.Generation.ToString("N"), root = ModelData.Root;
        await test("location_accepts_exact_c_root_generation_and_current_schema", () => Sync(() =>
            check(FixtureSpec.IsRoot(root) && Parse(root).Root == root)));
        foreach (var item in new (string Label, string Root)[]
        {
            ("old_dev_root", @"C:\GRY\wow\dev\fixture-accounts-windows-A135-" + id),
            ("old_schema_prefix", @"C:\fixture-accounts-windows-A135-" + id),
            ("programdata", @"C:\ProgramData\VMANGOS\VMANGOS-Accounts-Fixture-A139-" + id),
            ("dev_parent", @"C:\GRY\wow\dev\VMANGOS-Accounts-Fixture-A139-" + id),
            ("nested_parent", @"C:\VMANGOS\VMANGOS-Accounts-Fixture-A139-" + id),
            ("other_drive", @"D:\VMANGOS-Accounts-Fixture-A139-" + id),
            ("relative", "VMANGOS-Accounts-Fixture-A139-" + id),
            ("drive_relative", "C:VMANGOS-Accounts-Fixture-A139-" + id),
            ("unc", @"\\server\share\VMANGOS-Accounts-Fixture-A139-" + id),
            ("device_path", @"\\?\C:\VMANGOS-Accounts-Fixture-A139-" + id),
            ("forward_slashes", root.Replace('\\', '/')),
            ("lower_drive", "c" + root[1..]),
            ("lower_prefix", root.Replace("VMANGOS", "vmangos", StringComparison.Ordinal)),
            ("upper_generation", @"C:\VMANGOS-Accounts-Fixture-A139-" + id.ToUpperInvariant()),
            ("dashed_generation", @"C:\VMANGOS-Accounts-Fixture-A139-" + ModelData.Generation.ToString("D")),
            ("short_generation", root[..^1]),
            ("long_generation", root + "0"),
            ("nonhex_generation", root[..^1] + "g"),
            ("trailing_separator", root + @"\"),
            ("child", root + @"\worker"),
            ("dot_segment", @"C:\.\VMANGOS-Accounts-Fixture-A139-" + id),
            ("parent_segment", @"C:\safe\..\VMANGOS-Accounts-Fixture-A139-" + id),
            ("alternate_stream", root + ":stream"),
            ("trailing_space", root + " "),
            ("trailing_dot", root + "."),
            ("newline", root + "\n"),
            ("nul", root + "\0"),
            ("empty", "")
        })
        {
            string candidate = item.Root;
            await test("location_rejects_" + item.Label, () => Sync(() =>
            {
                check(!FixtureSpec.IsRoot(candidate));
                Refuse(() => Parse(candidate));
            }));
        }
        foreach (string schema in new[] { "A135-FIXTURE-1", "A132-FIXTURE-1", "a139-fixture-1", "A139-FIXTURE-2" })
        {
            string candidate = schema;
            await test("location_rejects_schema_" + candidate, () => Sync(() => Refuse(() => Parse(root, candidate))));
        }
        await test("location_rejects_generation_root_mismatch", () => Sync(() =>
            Refuse(() => Parse(root, generation: Guid.Parse("ff223344-5566-7788-99aa-bbccddeeff00")))));
        await test("location_rejects_zero_generation", () => Sync(() =>
            Refuse(() => Parse(@"C:\VMANGOS-Accounts-Fixture-A139-" + new string('0', 32), generation: Guid.Empty))));
    }
}
