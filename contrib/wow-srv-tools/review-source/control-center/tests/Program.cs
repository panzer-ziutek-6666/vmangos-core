using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Configuration;
using Vmangos.AdminPanel.Services;
using Vmangos.AdminPanel.Telemetry;

namespace PanelManifestTests;
internal static class Program
{
    static readonly List<object> Results = new();
    static int Failed;
    static readonly DateTimeOffset Now = DateTimeOffset.UtcNow;
    static readonly DateTimeOffset Created = Now.AddHours(-1);
    static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
    static void Need(bool value, string message) { if (!value) throw new Exception(message); }
    static void Check(string name, Action body)
    {
        try { body(); Results.Add(new { name, result = "PASS" }); Console.WriteLine("PASS " + name); }
        catch (Exception e) { Failed++; Results.Add(new { name, result = "FAIL", error = e.ToString() }); Console.WriteLine("FAIL " + name + " " + e); }
    }
    static void Reject(Action body)
    {
        try { body(); }
        catch (FormatException) { return; }
        catch (JsonException) { return; }
        throw new Exception("Expected format/schema rejection was missing");
    }
    static TelemetryDocument Frame(string revision, int age = 0)
    {
        var at = Now.AddSeconds(-age);
        return new TelemetryDocument {
            SchemaVersion = 1, CollectedAtUtc = at,
            World = new WorldGeneration { ProcessId = 9123, CreatedUtc = Created },
            Server = new Sample<ServerCounters> { Status = "ok", ObservedAtUtc = at,
                Data = new ServerCounters { CoreRevision = revision, UptimeDisplay = "one hour" } },
            LegacyBots = new Sample<LegacyCounters> { Status = "ok", ObservedAtUtc = at, Data = new LegacyCounters() },
            AiBots = new Sample<AiCounters> { Status = "ok", ObservedAtUtc = at, Data = new AiCounters {
                Prefix = "bot", PrefixOrigin = "RuntimeConfigFile", InventoryObservedAtUtc = at } }
        };
    }
    static TelemetryView Evaluate(TelemetryDocument doc) => TelemetryRules.Evaluate(doc, Now, doc.World.ProcessId, doc.World.CreatedUtc);
    static void Hidden(TelemetryView v) => Need(v.Server.Data == null && v.LegacyBots.Data == null && v.AiBots.Data == null, "Invalid view leaked counters");
    static MethodInfo Private(string name) => typeof(TelemetryReader).GetMethod(name, BindingFlags.NonPublic | BindingFlags.Static) ?? throw new Exception("Missing actual reader method");
    static void Call(MethodInfo method, params object[] args)
    {
        try { method.Invoke(null, args); }
        catch (TargetInvocationException e) when (e.InnerException != null) { System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(e.InnerException).Throw(); }
    }
    // These are the actual, unmodified private parser functions/options from the
    // published DLL. Reflection only exposes them to the harness, no source copy.
    static TelemetryDocument Parse(string text)
    {
        using var json = JsonDocument.Parse(text, new JsonDocumentOptions { MaxDepth = 12 });
        Call(Private("RejectDuplicateKeys"), json.RootElement);
        Call(Private("RequireCompleteShape"), json.RootElement, typeof(TelemetryDocument));
        var options = (JsonSerializerOptions)(typeof(TelemetryReader).GetField("JsonOptions", BindingFlags.NonPublic | BindingFlags.Static)?.GetValue(null) ?? throw new Exception("Actual options missing"));
        return json.RootElement.Deserialize<TelemetryDocument>(options) ?? throw new FormatException();
    }
    static string SHA(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path)));
    static int Main(string[] args)
    {
        if (args.Length != 4) throw new Exception("fixture-root result-path publish-dll publish-pdb required");
        string fixtures = args[0], result = args[1], dll = args[2], pdb = args[3];
        var ids = JsonNode.Parse(File.ReadAllText(Path.Combine(fixtures, "release-revisions.json")))!.AsArray();
        Check("tests_execute_actual_published_dll", () => Need(SHA(typeof(TelemetryRules).Assembly.Location) == SHA(dll), "Loaded assembly is not publish payload"));
        Check("portable_pdb_matches_published_assembly", () => {
            using var pe = new PEReader(File.OpenRead(dll));
            var entry = pe.ReadDebugDirectory().Single(x => x.Type == DebugDirectoryEntryType.CodeView);
            var cv = pe.ReadCodeViewDebugDirectoryData(entry);
            using var provider = MetadataReaderProvider.FromPortablePdbStream(File.OpenRead(pdb));
            var header = provider.GetMetadataReader().DebugMetadataHeader ?? throw new Exception("PDB header missing");
            var content = new BlobContentId(header.Id);
            Need(cv.Guid == content.Guid && cv.Age == 1, "Portable PDB GUID/Age mismatch");
        });
        foreach (var node in ids)
        {
            var item = node!; string id = item["id"]!.GetValue<string>(), revision = item["revision"]!.GetValue<string>();
            Check("release_" + id, () => {
                var doc = Parse(JsonSerializer.Serialize(Frame(revision), Web));
                var view = Evaluate(doc); Need(view.State == "ok" && view.Server.Data.CoreRevision == revision, "Supported revision rejected");
            });
        }
        string current = ids[0]!["revision"]!.GetValue<string>();
        Check("future_full_40_hex_revision", () => Need(Evaluate(Frame(new string('d', 40) + " / fixture")).State == "ok", "40 hex rejected"));
        foreach (var bad in new[] { "", "04c3", new string('g', 20), new string('A', 20), new string('a', 19), new string('a', 21), new string('a', 41), new string('a', 20) + "@bad", new string('a', 20) + "\nspoof", new string('a', 20) + "\r", new string('a', 20) + "\0x" })
        {
            var captured = bad; Check("bad_revision_" + Convert.ToHexString(System.Text.Encoding.UTF8.GetBytes(bad)), () => Reject(() => TelemetryRules.Validate(Frame(captured))));
        }
        Check("stale_sample_hides_all_counters", () => { var view = Evaluate(Frame(current, 90)); Need(view.State == "stale", "Not stale"); Hidden(view); });
        Check("synthetic_transition_fixture_is_error", () => {
            var doc = Parse(File.ReadAllText(Path.Combine(fixtures, "TRANSITION-SNAPSHOT.json")));
            var view = TelemetryRules.Evaluate(doc, doc.CollectedAtUtc, doc.World.ProcessId, doc.World.CreatedUtc);
            Need(view.State == "error" && view.Server.ErrorCode == "RELEASE_TRANSITION", "Transition was healthy"); Hidden(view);
        });
        Check("fresh_transition_error_not_healthy", () => {
            var d = Frame(current); d.Server.Status = d.LegacyBots.Status = d.AiBots.Status = "error";
            d.Server.ErrorCode = d.LegacyBots.ErrorCode = d.AiBots.ErrorCode = "RELEASE_TRANSITION";
            d.Server.Data = null!; d.LegacyBots.Data = null!; d.AiBots.Data = null!;
            var v = Evaluate(d); Need(v.State == "error", "Transition healthy"); Hidden(v);
        });
        Check("wrong_pid_generation_hides_data", () => { var v = TelemetryRules.Evaluate(Frame(current), Now, 9124, Created); Need(v.State == "generation_changed", "PID generation bypass"); Hidden(v); });
        Check("wrong_creation_generation_hides_data", () => { var v = TelemetryRules.Evaluate(Frame(current), Now, 9123, Created.AddSeconds(1)); Need(v.State == "generation_changed", "Creation generation bypass"); Hidden(v); });
        Check("unavailable_generation_hides_data", () => { var v = TelemetryRules.Evaluate(Frame(current), Now, 0, null); Need(v.State == "unavailable", "Not unavailable"); Hidden(v); });
        Check("warming_generation_hides_data", () => { var v = TelemetryRules.Evaluate(Frame(current), Now, 9123, null); Need(v.State == "warming", "Not warming"); Hidden(v); });
        Check("schema_version_still_enforced", () => { var d = Frame(current); d.SchemaVersion = 2; Reject(() => TelemetryRules.Validate(d)); });
        Check("counter_limit_still_enforced", () => { var d = Frame(current); d.Server.Data.PeakActiveSessions = 1000000001; Reject(() => TelemetryRules.Validate(d)); });
        Check("peak_counter_identity_still_enforced", () => { var d = Frame(current); d.Server.Data.ActiveSessions = 2; d.Server.Data.PeakActiveSessions = 1; Reject(() => TelemetryRules.Validate(d)); });
        Check("legacy_counter_identity_still_enforced", () => { var d = Frame(current); d.LegacyBots.Data.Online = 1; Reject(() => TelemetryRules.Validate(d)); });
        Check("ai_counter_identity_still_enforced", () => { var d = Frame(current); d.AiBots.Data.OnlineCharactersTotal = 1; Reject(() => TelemetryRules.Validate(d)); });
        Check("missing_field_rejected_by_actual_reader", () => { var n = JsonNode.Parse(JsonSerializer.Serialize(Frame(current), Web))!.AsObject(); n.Remove("world"); Reject(() => Parse(n.ToJsonString())); });
        Check("unknown_field_rejected_by_actual_reader", () => { var n = JsonNode.Parse(JsonSerializer.Serialize(Frame(current), Web))!.AsObject(); n["unexpected"] = true; Reject(() => Parse(n.ToJsonString())); });
        Check("duplicate_key_rejected_by_actual_reader", () => { string text = JsonSerializer.Serialize(Frame(current), Web); Reject(() => Parse(text.Replace("\"schemaVersion\":1", "\"schemaVersion\":1,\"schemaVersion\":1"))); });
        Check("public_schema_unchanged", () => { var n = JsonNode.Parse(JsonSerializer.Serialize(Frame(current), Web))!.AsObject(); Need(n.Select(x => x.Key).Order().SequenceEqual(new[] { "aiBots", "collectedAtUtc", "legacyBots", "schemaVersion", "server", "world" }), "Public fields changed"); });
        Check("reader_getasync_malformed_file_is_invalid_without_runtime_call", () => {
            string p = Path.Combine(fixtures, "reader-invalid.json"); File.WriteAllText(p, "{bad-json}");
            var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> { ["Telemetry:SnapshotPath"] = p }).Build();
            var reader = new TelemetryReader(config);
            var view = reader.GetAsync(null!, CancellationToken.None).GetAwaiter().GetResult();
            Need(view.State == "invalid", "Actual async reader did not fail before runtime"); Hidden(view);
        });
        var report = new { result = Failed == 0 ? "PASS" : "FAIL", count = Results.Count, failed = Failed,
            testedAssembly = typeof(TelemetryRules).Assembly.Location, publishedAssembly = dll, sha256 = SHA(dll),
            instrumentation = "Actual full published assembly; reflection exposes unchanged private reader parsing functions/options. Synthetic telemetry counters and process generation arguments; no HTTP, IIS token impersonation, SCM, SOAP, SQL, or control action. No production code instrumented.",
            tests = Results, panelDeployment = "NOT_RUN", collectorInstallation = "NOT_RUN", coreDeployment = "NOT_RUN" };
        File.WriteAllText(result, JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
        Console.WriteLine(JsonSerializer.Serialize(new { report.result, report.count, report.failed }));
        return Failed == 0 ? 0 : 1;
    }
}
