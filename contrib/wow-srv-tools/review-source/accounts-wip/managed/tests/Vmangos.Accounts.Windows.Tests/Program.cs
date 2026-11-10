using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Vmangos.Accounts.Core;
using Vmangos.Accounts.Windows;
using Vmangos.Accounts.Windows.Tests;

if (args.Length == 3 && args[0] == "--fixture-client")
{
    if (!OperatingSystem.IsWindows()) { Console.WriteLine("A135_CLIENT_ERROR=WindowsRequired"); return 2; }
    try
    {
        var nativeSpec = FixtureSpec.Load(args[1], args[2]);
        using var request = ModelData.Request();
        var result = await WindowsFixture.SubmitAsync(nativeSpec, request);
        if (result.State != "succeeded" || result.ErrorCode != "None" || result.DispatchAttempts != 1)
        { Console.WriteLine("A135_CLIENT_ERROR=TransportUncertain"); return 1; }
        // Same operationId on a fresh connection: the worker journal owns
        // idempotency. No retry is performed following an uncertain result.
        var duplicate = await WindowsFixture.SubmitAsync(nativeSpec, request);
        if (duplicate != result) { Console.WriteLine("A135_CLIENT_ERROR=Unexpected"); return 1; }
        Console.WriteLine("A135_CLIENT_FIXED_SUCCESS_AND_DUPLICATE=True LIVE_CONNECTIONS=0"); return 0;
    }
    catch (BoundaryException error) { Console.WriteLine("A135_CLIENT_ERROR=" + error.Code); return 1; }
    catch { Console.WriteLine("A135_CLIENT_ERROR=Unexpected"); return 1; }
}
if (args.Length != 1 || args[0] != "--model-tests") { Console.WriteLine("A135_TEST_ERROR=InvalidMode"); return 2; }
int passed = 0, failed = 0;
void Assert(bool condition) { if (!condition) throw new InvalidOperationException("MODEL_ASSERTION"); }
async Task Test(string label, Func<Task> action)
{
    try { await action(); passed++; Console.WriteLine("MODEL_PASS " + label); }
    catch { failed++; Console.WriteLine("MODEL_FAIL " + label); }
}
Task Sync(Action action) { action(); return Task.CompletedTask; }
async Task Refuse(Func<Task> action)
{
    bool refused = false;
    try { await action(); } catch (Exception e) when (e is BoundaryException or EndOfStreamException or OperationCanceledException or IOException) { refused = true; }
    Assert(refused);
}
Task RefuseSync(Action action) => Refuse(() => Sync(action));
var generation = ModelData.Generation;

await Test("pipe_client_cannot_create_instance_or_change_acl", () => Sync(() =>
    Assert((PipeAccessPolicy.ClientMask & (PipeAccessPolicy.CreateInstance | 0x00040000 | 0x00080000 | 0xF0000000)) == 0 &&
        (PipeAccessPolicy.ClientMask & 3) == 3)));
await Test("pipe_policy_rejects_non_pool_sid", () => RefuseSync(() => PipeAccessPolicy.PipeSddl("S-1-1-0")));
await Test("pipe_policy_rejects_sddl_injection", () => RefuseSync(() => PipeAccessPolicy.PipeSddl(BoundaryLimits.TargetPoolSid + ")(A;;FA;;;WD)")));
await Test("pipe_name_requires_generation", () => RefuseSync(() => BoundaryLimits.PipeName(Guid.Empty)));
await Test("pipe_names_do_not_accept_remote_or_arbitrary_path", () => Sync(() => Assert(BoundaryLimits.PipeName(generation) == @"\\.\pipe\VMANGOS-Accounts-A135-" + generation.ToString("N"))));

foreach (int n in new[] { -1, 0, 4097, int.MaxValue })
    await Test("frame_rejects_length_" + n.ToString().Replace('-', 'm'), async () =>
    {
        byte[] b = new byte[4]; BinaryPrimitives.WriteInt32LittleEndian(b, n);
        using var stream = new ScriptedStream(b);
        await Refuse(async () => { _ = await BoundedFrames.ReadAsync(stream, 4096, CancellationToken.None); });
        Assert(stream.BytesRead == 4);
    });
await Test("frame_fragmented_roundtrip", async () =>
{
    byte[] expected = RandomNumberGenerator.GetBytes(4096);
    using var stream = new ScriptedStream(ModelData.Frame(expected.ToArray())) { Chunk = 1 };
    byte[] actual = await BoundedFrames.ReadAsync(stream, 4096, CancellationToken.None);
    Assert(actual.AsSpan().SequenceEqual(expected)); Array.Clear(actual); Array.Clear(expected);
});
await Test("handshake_cap_prevents_body_read", async () =>
{
    byte[] prefix = new byte[4]; BinaryPrimitives.WriteInt32LittleEndian(prefix, 513);
    using var stream = new ScriptedStream(prefix);
    await Refuse(async () => { _ = await BoundedFrames.ReadAsync(stream, 512, CancellationToken.None); });
    Assert(stream.BytesRead == 4);
});
await Test("truncated_prefix_refused", async () => { using var stream = new ScriptedStream([1, 0]); await Refuse(async () => { _ = await BoundedFrames.ReadAsync(stream, 4096, default); }); });
await Test("truncated_body_refused", async () => { using var stream = new ScriptedStream([2, 0, 0, 0, 1]); await Refuse(async () => { _ = await BoundedFrames.ReadAsync(stream, 4096, default); }); });
await Test("io_cancellation_reaches_underlying_stream", async () =>
{
    using var stream = new ScriptedStream([]) { StallOnEnd = true };
    using var cancel = new CancellationTokenSource(40);
    await Refuse(async () => { _ = await BoundedFrames.ReadAsync(stream, 512, cancel.Token); });
});
await Test("write_cap_rejected_without_prefix_or_body", async () =>
{
    using var stream = new ScriptedStream([]);
    await Refuse(() => BoundedFrames.WriteAsync(stream, new byte[513], 512, default)); Assert(stream.Written.Length == 0);
});

await Test("handshake_roundtrip_nonce_bound", () => Sync(() =>
{
    Guid nonce = Guid.NewGuid(); byte[] bytes = WireCodec.Handshake(generation, nonce, false);
    Assert(WireCodec.ReadHandshake(bytes, generation, false, nonce) == nonce); Array.Clear(bytes);
}));
foreach (string kind in new[] { "generation", "nonce", "phase", "duplicate", "unknown", "nested", "version" })
    await Test("handshake_rejects_" + kind, () => RefuseSync(() =>
    {
        Guid nonce = Guid.NewGuid(); string json = Encoding.UTF8.GetString(WireCodec.Handshake(generation, nonce, false));
        json = kind switch
        {
            "generation" => json.Replace(generation.ToString("D"), Guid.NewGuid().ToString("D")),
            "nonce" => json.Replace(nonce.ToString("D"), Guid.Empty.ToString("D")),
            "phase" => json.Replace("hello", "ready"), "version" => json.Replace("A135-1", "A135-2"),
            "duplicate" => json.Replace("{", "{\"version\":\"A135-1\","),
            "unknown" => json.Replace("{", "{\"PeerProof\":\"trusted\","),
            _ => json.Replace("\"hello\"", "{}")
        };
        _ = WireCodec.ReadHandshake(Encoding.UTF8.GetBytes(json), generation, false);
    }));

await Test("spec_accepts_sealed_fixture_profile", () => Sync(() => Assert(ModelData.Spec().Worker.Files.Count == 6)));
foreach (string kind in new[] { "schema", "session0", "session17", "sid", "operator", "host", "traversal", "missing", "duplicate", "hash", "size", "shared", "unknown" })
    await Test("spec_refuses_" + kind, () => RefuseSync(() =>
    {
        var node = ModelData.SpecNode(); var files = node["worker"]!["files"]!.AsArray();
        switch (kind)
        {
            case "schema": node["schema"] = "live"; break;
            case "session0": node["sessionLimit"] = 0; break;
            case "session17": node["sessionLimit"] = 17; break;
            case "sid": node["clientSid"] = "S-1-5-18"; break;
            case "operator": node["operatorSid"] = "S-1-1-0"; break;
            case "host": node["worker"]!["image"] = "worker/dotnet.exe"; break;
            case "traversal": files[0]!["path"] = "worker/../Vmangos.Accounts.Worker.exe"; break;
            case "missing": files.RemoveAt(0); break;
            case "duplicate": files.Add(files[0]!.DeepClone()); break;
            case "hash": files[0]!["sha256"] = "A"; break;
            case "size": files[0]!["length"] = 8388609; break;
            case "shared": files[4]!["sha256"] = new string('B', 64); break;
            case "unknown": node["backend"] = "soap"; break;
        }
        _ = ModelData.Spec(node);
    }));
await Test("spec_rejects_wrong_trusted_hash", () => RefuseSync(() =>
{
    byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(ModelData.SpecNode()); _ = FixtureSpec.Parse(ModelData.Root, bytes, new string('B', 64));
}));
await Test("spec_rejects_duplicate_top_property", () => RefuseSync(() =>
{
    string json = ModelData.SpecNode().ToJsonString().Replace("{", "{\"schema\":\"A139-FIXTURE-1\",", StringComparison.Ordinal);
    byte[] bytes = Encoding.UTF8.GetBytes(json); _ = FixtureSpec.Parse(ModelData.Root, bytes, Convert.ToHexString(SHA256.HashData(bytes)));
}));
await Test("spec_root_must_match_generation", () => RefuseSync(() =>
{
    byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(ModelData.SpecNode());
    _ = FixtureSpec.Parse(ModelData.Root[..^32] + Guid.NewGuid().ToString("N"), bytes, Convert.ToHexString(SHA256.HashData(bytes)));
}));

var spec = ModelData.Spec();
await Test("generation_receipt_roundtrip", () => Sync(() =>
{
    var receipt = new GenerationReceipt(generation, 1234, DateTime.UtcNow.ToFileTimeUtc(), spec.Sha256);
    Assert(GenerationReceipt.Decode(spec, receipt.Encode()) == receipt);
}));
foreach (string kind in new[] { "generation", "pid", "time", "hash", "unknown", "duplicate" })
    await Test("receipt_refuses_" + kind, () => RefuseSync(() =>
    {
        var node = JsonNode.Parse(new GenerationReceipt(generation, 1234, DateTime.UtcNow.ToFileTimeUtc(), spec.Sha256).Encode())!.AsObject();
        switch (kind)
        {
            case "generation": node["generation"] = Guid.NewGuid().ToString("D"); break;
            case "pid": node["pid"] = 0; break;
            case "time": node["createdFileTime"] = DateTime.UtcNow.AddMinutes(10).ToFileTimeUtc(); break;
            case "hash": node["specSha256"] = new string('B', 64); break;
            case "unknown": node["tokenSid"] = "S-1-5-18"; break;
        }
        string json = node.ToJsonString(); if (kind == "duplicate") json = json.Replace("{", "{\"pid\":1234,");
        _ = GenerationReceipt.Decode(spec, Encoding.UTF8.GetBytes(json));
    }));

await Test("request_roundtrip_revalidates_worker_policy", () => Sync(() =>
{
    using var request = ModelData.Request(); byte[] bytes = WireCodec.Request(request, ModelData.Operator, generation);
    using var parsed = WireCodec.ReadRequest(bytes, generation, ModelData.Operator);
    Assert(parsed.AccountName == request.AccountName && parsed.OperationId == request.OperationId); Array.Clear(bytes);
}));
foreach (string kind in new[] { "sid", "generation", "duplicate", "unknown", "peerproof", "password", "lowercase", "nameequalssecret" })
    await Test("request_refuses_" + kind, () => RefuseSync(() =>
    {
        using var request = ModelData.Request(); byte[] bytes = WireCodec.Request(request, ModelData.Operator, generation);
        var node = JsonNode.Parse(bytes)!.AsObject(); Array.Clear(bytes);
        switch (kind)
        {
            case "sid": node["operatorSid"] = "S-1-5-21-1-2-3-9999"; break;
            case "generation": node["generation"] = Guid.NewGuid().ToString("D"); break;
            case "unknown": node["command"] = "noop"; break;
            case "peerproof": node["FirstInstance"] = "true"; break;
            case "password": node["password"] = "INVALID"; break;
            case "lowercase": node["accountName"] = "a132player"; break;
            case "nameequalssecret": node["accountName"] = "SYNTHETICONLY12"; node["password"] = "SYNTHETICONLY12"; break;
        }
        string json = node.ToJsonString(); if (kind == "duplicate") json = json.Replace("{", "{\"version\":\"A135-1\",");
        using var parsed = WireCodec.ReadRequest(Encoding.UTF8.GetBytes(json), generation, ModelData.Operator);
    }));

await Test("server_model_one_dispatch_and_idempotent_repeat", async () =>
{
    var backend = new SyntheticBackend(); var journal = new MemoryJournal(); var audit = new MemoryAudit();
    var engine = new OperationEngine(journal, audit, backend, new SyntheticControlGate());
    using var request = ModelData.Request();
    for (int i = 0; i < 2; i++)
    {
        var peer = new ModelPeer();
        using var stream = new ScriptedStream(ModelData.Join(ModelData.Frame(WireCodec.Handshake(generation, Guid.NewGuid(), false)),
            ModelData.Frame(WireCodec.Request(request, ModelData.Operator, generation))));
        await FixtureConversation.ServerAsync(stream, generation, ModelData.Operator, () => peer, engine, default);
        Assert(peer.Calls == 2 && peer.Disposed);
    }
    Assert(backend.Dispatches == 1 && journal.Entries.Count == 3 && audit.Entries.Count == 2);
});
await Test("server_rejects_peer_before_secret_body_or_ack", async () =>
{
    using var request = ModelData.Request(); byte[] hello = ModelData.Frame(WireCodec.Handshake(generation, Guid.NewGuid(), false)); int expectedRead = hello.Length;
    using var stream = new ScriptedStream(ModelData.Join(hello, ModelData.Frame(WireCodec.Request(request, ModelData.Operator, generation))));
    var backend = new SyntheticBackend(); var engine = new OperationEngine(new MemoryJournal(), new MemoryAudit(), backend, new SyntheticControlGate());
    await Refuse(() => FixtureConversation.ServerAsync(stream, generation, ModelData.Operator,
        () => { Assert(stream.BytesRead == expectedRead); throw new BoundaryException(BoundaryError.PeerRejected); }, engine, default));
    Assert(backend.Dispatches == 0 && stream.BytesRead == expectedRead && stream.Written.Length == 0);
});
await Test("server_generation_change_after_handshake_zero_dispatch", async () =>
{
    using var request = ModelData.Request();
    using var stream = new ScriptedStream(ModelData.Join(ModelData.Frame(WireCodec.Handshake(generation, Guid.NewGuid(), false)),
        ModelData.Frame(WireCodec.Request(request, ModelData.Operator, generation))));
    var backend = new SyntheticBackend(); var engine = new OperationEngine(new MemoryJournal(), new MemoryAudit(), backend, new SyntheticControlGate());
    var peer = new ModelPeer(2);
    await Refuse(() => FixtureConversation.ServerAsync(stream, generation, ModelData.Operator, () => peer, engine, default));
    Assert(backend.Dispatches == 0 && peer.Disposed);
});
await Test("server_operator_rejection_zero_dispatch", async () =>
{
    using var request = ModelData.Request();
    using var stream = new ScriptedStream(ModelData.Join(ModelData.Frame(WireCodec.Handshake(generation, Guid.NewGuid(), false)),
        ModelData.Frame(WireCodec.Request(request, "S-1-5-21-1-2-3-9999", generation))));
    var backend = new SyntheticBackend(); var engine = new OperationEngine(new MemoryJournal(), new MemoryAudit(), backend, new SyntheticControlGate());
    await Refuse(() => FixtureConversation.ServerAsync(stream, generation, ModelData.Operator, () => new ModelPeer(), engine, default));
    Assert(backend.Dispatches == 0);
});
await Test("client_model_success", async () =>
{
    using var request = ModelData.Request(); using var stream = new ClientScript(generation, request.OperationId);
    var outcome = await FixtureConversation.ClientAsync(stream, generation, ModelData.Operator, request, new ModelPeer(), default);
    Assert(outcome.State == "succeeded" && outcome.DispatchAttempts == 1 && outcome.Synthetic);
});
foreach (string kind in new[] { "peer", "nonce", "generation" })
    await Test("client_" + kind + "_failure_sends_no_password", async () =>
    {
        using var request = ModelData.Request(); using var stream = new ClientScript(generation, request.OperationId, kind == "nonce", kind == "generation");
        await Refuse(async () => { _ = await FixtureConversation.ClientAsync(stream, generation, ModelData.Operator, request, new ModelPeer(kind == "peer" ? 2 : 0), default); });
        string sent = Encoding.UTF8.GetString(stream.Written); Assert(!sent.Contains("password", StringComparison.Ordinal));
    });
await Test("client_response_lost_is_unknown_without_replay", async () =>
{
    using var request = ModelData.Request(); using var stream = new ClientScript(generation, request.OperationId, dropResponse: true);
    var outcome = await FixtureConversation.ClientAsync(stream, generation, ModelData.Operator, request, new ModelPeer(), default);
    Assert(outcome.State == "unknown" && outcome.ErrorCode == "TransportUncertain");
    string sent = Encoding.UTF8.GetString(stream.Written); Assert(sent.Split("\"password\"", StringSplitOptions.None).Length == 2);
});
await Test("response_and_errors_do_not_echo_secret", () => Sync(() =>
{
    using var request = ModelData.Request(); byte[] response = WireCodec.Response(new(request.OperationId, request.AccountName, AccountState.Succeeded, AccountError.None, 1, 1001));
    string json = Encoding.UTF8.GetString(response); Assert(!json.Contains("password", StringComparison.Ordinal) && !json.Contains(request.AccountName, StringComparison.Ordinal));
    Assert(!new BoundaryException(BoundaryError.TokenUnavailable).ToString().Contains("password", StringComparison.Ordinal));
    Array.Clear(response);
}));
await Test("generated_marker_absent_from_status_journal_audit_and_errors", async () =>
{
    string marker = ModelData.Secret();
    using var request = new CreateAccountRequest(Guid.NewGuid(), "A135PLAYER", new PasswordSecret(marker));
    var journal = new MemoryJournal(); var audit = new MemoryAudit();
    var engine = new OperationEngine(journal, audit, new SyntheticBackend(), new SyntheticControlGate());
    var status = await engine.ExecuteAsync(request, ModelData.Operator, default);
    string outputs = JsonSerializer.Serialize(status) + JsonSerializer.Serialize(journal.Entries) + JsonSerializer.Serialize(audit.Entries) +
        request.ToString() + request.Password.ToString() + new BoundaryException(BoundaryError.TransportUncertain).ToString();
    Assert(!outputs.Contains(marker, StringComparison.Ordinal));
});

await Test("runtime_empty_injection_environment_allowed", () => Sync(() => RuntimeProcessPolicy.AssertEnvironment(_ => null)));
foreach (string injected in new[] { "DOTNET_STARTUP_HOOKS", "DOTNET_ADDITIONAL_DEPS", "CORECLR_PROFILER_PATH", "DOTNET_ROOT", "DOTNET_DiagnosticPorts" })
    await Test("runtime_refuses_" + injected.ToLowerInvariant(), () => RefuseSync(() => RuntimeProcessPolicy.AssertEnvironment(name => name == injected ? "SYNTHETIC_UNTRUSTED" : null)));
foreach (string kind in new[] { "wrongid", "unknownstate", "secretfield", "success0", "successerror", "falsefixture", "extraattempt", "duplicate" })
    await Test("response_refuses_" + kind, () => RefuseSync(() =>
    {
        Guid operation = Guid.NewGuid();
        var node = JsonNode.Parse(WireCodec.Response(new(operation, "A135PLAYER", AccountState.Succeeded, AccountError.None, 1, 1001)))!.AsObject();
        switch (kind)
        {
            case "wrongid": node["operationId"] = Guid.NewGuid().ToString("D"); break;
            case "unknownstate": node["state"] = "untrusted"; break;
            case "secretfield": node["password"] = ModelData.Secret(); break;
            case "success0": node["dispatchAttempts"] = 0; break;
            case "successerror": node["errorCode"] = "TransportUncertain"; break;
            case "falsefixture": node["synthetic"] = false; break;
            case "extraattempt": node["dispatchAttempts"] = 2; break;
        }
        string json = node.ToJsonString(); if (kind == "duplicate") json = json.Replace("{", "{\"state\":\"succeeded\",");
        _ = WireCodec.ReadResponse(Encoding.UTF8.GetBytes(json), operation);
    }));

await LauncherModelTests.Run(Test, Assert);
await LocationModelTests.Run(Test, Assert);
Console.WriteLine("REAL_WINDOWS_SYSTEM_TOKEN=NOT_RUN REAL_APPPOOL_TOKEN=NOT_RUN REAL_PIPE_ACL_REMOTE_SPOOF=NOT_RUN REAL_IIS_PIPELINE=NOT_RUN");
Console.WriteLine("MODEL_TESTS_PASSED=" + passed + " MODEL_TESTS_FAILED=" + failed + " LIVE_CONNECTIONS=0");
return failed == 0 ? 0 : 1;
