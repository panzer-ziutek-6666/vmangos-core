using System.Text.Json.Nodes;
using Vmangos.Accounts.Windows;

namespace Vmangos.Accounts.Windows.Tests;

internal static class LauncherModelTests
{
    internal static async Task Run(Func<string, Func<Task>, Task> test, Action<bool> check)
    {
        Task Sync(Action action) { action(); return Task.CompletedTask; }
        void Refuse(Action action)
        {
            bool refused = false; try { action(); } catch (BoundaryException) { refused = true; } check(refused);
        }
        await test("launch_minimum_process_mask_has_no_memory_control_duplicate_or_dacl", () => Sync(() =>
            check(ProcessAccessPolicy.ProcessRead == 0x101000 && (ProcessAccessPolicy.ProcessRead & 0xF00F0BFB) == 0)));
        await test("launch_token_query_has_no_assign_duplicate_impersonate_adjust_or_dacl", () => Sync(() => check(ProcessAccessPolicy.TokenRead == 8)));
        await test("launch_dacl_has_only_fixed_pool_query_ace", () => Sync(() =>
            check(ProcessAccessPolicy.TokenDacl(BoundaryLimits.TargetPoolSid).EndsWith("(A;;0x00000008;;;" + BoundaryLimits.TargetPoolSid + ")", StringComparison.Ordinal) &&
                !ProcessAccessPolicy.TokenDacl(BoundaryLimits.TargetPoolSid).Contains("O:"))));
        foreach (string sid in new[] { "S-1-1-0", "S-1-5-18", "S-1-5-82-1-2-3-4-5", BoundaryLimits.TargetPoolSid + ")(A;;GA;;;WD)" })
            await test("launch_rejects_sid_" + Array.IndexOf(new[] { "S-1-1-0", "S-1-5-18", "S-1-5-82-1-2-3-4-5", BoundaryLimits.TargetPoolSid + ")(A;;GA;;;WD)" }, sid),
                () => Sync(() => Refuse(() => ProcessAccessPolicy.ProcessDacl(sid))));
        for (int fail = 0; fail <= 4; fail++)
        {
            int at = fail;
            await test("launch_order_failure_" + fail, () => Sync(() =>
            {
                var steps = new FakeLaunch(at);
                if (at == 0) { LaunchOrder.Start(steps); check(string.Join(',', steps.Events) == "create,job,verify,resume"); }
                else { Refuse(() => LaunchOrder.Start(steps)); check(steps.Events[^1] == "abort" && (at == 4 || !steps.Events.Contains("resume"))); }
            }));
        }
        foreach (string kind in new[] { "old_schema", "policy", "launcher_hash", "runtime_root", "runtime_version", "runtime_roll", "missing_runtime_file", "duplicate_runtime_file",
            "traversal", "runtime_unknown", "runtime_hash", "runtime_size", "runtime_cap", "session", "limit_time", "limit_process", "limit_capture", "unknown_limit", "unknown_spec" })
            await test("launch_spec_rejects_" + kind, () => Sync(() =>
            {
                var node = ModelData.SpecNode(); var runtime = node["runtime"]!; var files = runtime["files"]!.AsArray();
                switch (kind)
                {
                    case "old_schema": node["schema"] = "A132-FIXTURE-1"; break;
                    case "policy": node["processAccessPolicy"] = "bypass"; break;
                    case "launcher_hash": node["launcher"]!["files"]![4]!["sha256"] = new string('B', 64); break;
                    case "runtime_root": runtime["root"] = @"D:\dotnet"; break;
                    case "runtime_version": runtime["frameworkVersion"] = "10.0.0"; break;
                    case "runtime_roll": runtime["rollForward"] = "LatestMajor"; break;
                    case "missing_runtime_file": files.RemoveAt(0); break;
                    case "duplicate_runtime_file": files.Add(files[0]!.DeepClone()); break;
                    case "traversal": files[0]!["path"] = "host/fxr/10.0.12/../hostfxr.dll"; break;
                    case "runtime_unknown": runtime["extra"] = true; break;
                    case "runtime_hash": files[0]!["sha256"] = "wrong"; break;
                    case "runtime_size": files[0]!["length"] = 0; break;
                    case "runtime_cap": files[0]!["length"] = 134217729; break;
                    case "session": node["sessionLimit"] = 3; break;
                    case "limit_time": node["limits"]!["stageSeconds"] = 301; break;
                    case "limit_process": node["limits"]!["ownedProcesses"] = 4; break;
                    case "limit_capture": node["limits"]!["captureBytes"] = 65537; break;
                    case "unknown_limit": node["limits"]!["anything"] = true; break;
                    case "unknown_spec": node["PeerProof"] = "trusted"; break;
                }
                Refuse(() => ModelData.Spec(node));
            }));
        await test("client_desktop_has_generation_and_no_system_child_name", () => Sync(() => check(ClientDesktopPolicy.Station(ModelData.Generation) == "A135-Client-" + ModelData.Generation.ToString("N"))));
        await test("client_desktop_rejects_empty_generation", () => Sync(() => Refuse(() => ClientDesktopPolicy.Station(Guid.Empty))));
        await test("client_desktop_rejects_foreign_sid", () => Sync(() => Refuse(() => ClientDesktopPolicy.Sddl(ClientDesktopPolicy.StationFull, "S-1-1-0"))));
        await test("client_desktop_rejects_arbitrary_rights", () => Sync(() => Refuse(() => ClientDesktopPolicy.Sddl(uint.MaxValue, BoundaryLimits.TargetPoolSid))));
        await test("launch_spec_accepts_three_bundles_and_runtime", () => Sync(() => check(ModelData.Spec().Launcher.Files.Count == 6 && ModelData.Spec().Runtime.Files.Count == 4)));
        await test("launch_environment_excludes_inherited_hooks_and_has_private_temp", () => Sync(() =>
        {
            string[] env = ProcessAccessPolicy.EnvironmentFor(ModelData.Spec(), true);
            check(env.Length == 7 && env.All(e => !e.StartsWith("DOTNET_ROOT=", StringComparison.Ordinal) && !e.Contains("STARTUP_HOOKS")) &&
                env.Contains("TEMP=" + ModelData.Root + "\\client-temp") && env.Contains("DOTNET_EnableDiagnostics=0"));
        }));
    }
    private sealed class FakeLaunch(int fail) : ILaunchSteps
    {
        internal List<string> Events { get; } = [];
        private void Step(int index, string name) { Events.Add(name); if (index == fail) throw new BoundaryException(BoundaryError.PeerRejected); }
        public void CreateSuspended() => Step(1, "create"); public void AssignJob() => Step(2, "job");
        public void Verify() => Step(3, "verify"); public void Resume() => Step(4, "resume"); public void AbortOwned() => Events.Add("abort");
    }
}
