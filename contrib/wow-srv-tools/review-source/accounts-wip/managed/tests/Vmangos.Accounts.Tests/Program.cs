using System.Buffers.Binary;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Vmangos.Accounts.Core;
using Vmangos.AdminPanel.Services;

return await Tests.Run();

internal static class Tests
{
    private static int _passed, _failed;
    private static readonly List<string> ExposedOutputs = [];
    private static readonly List<string> Secrets = [];
    private static void Assert(bool condition) { if (!condition) throw new InvalidOperationException("ASSERTION_FAILED"); }
    private static async Task Test(string name,Func<Task> test)
    {
        try { await test(); _passed++; Console.WriteLine("PASS "+name); }
        catch { _failed++; Console.WriteLine("FAIL "+name); }
    }
    private static Task Sync(Action action) { action(); return Task.CompletedTask; }
    private static string NewSecret() { string secret=Fixtures.Secret(); Secrets.Add(secret); return secret; }
    private static byte[] Dto(string name = "PlayerOne",Guid? id = null,string? secret = null) => JsonSerializer.SerializeToUtf8Bytes(new
    { operationId=(id??Guid.NewGuid()).ToString("D"),accountName=name,password=secret??NewSecret() });
    private static void Capture(Fixture fixture,AccountStatus status)
    {
        ExposedOutputs.Add(JsonSerializer.Serialize(status));
        ExposedOutputs.Add(JsonSerializer.Serialize(fixture.Audit.Entries));
        ExposedOutputs.Add(JsonSerializer.Serialize(fixture.Journal.Entries));
    }
    internal static async Task<int> Run()
    {
        await Validation();
        await EngineCases();
        await RecoveryAndConcurrency();
        await Storage();
        await Http();
        await Protocol();
        await Test("outputs_have_no_generated_secret",()=>Sync(()=>Assert(Secrets.All(s=>ExposedOutputs.All(o=>!o.Contains(s,StringComparison.Ordinal))))));
        Console.WriteLine($"TESTS_PASSED={_passed} TESTS_FAILED={_failed} LIVE_CONNECTIONS=0");
        return _failed==0?0:1;
    }
    private static async Task Validation()
    {
        foreach (string name in new[]{"Ab3","PlayerOne","ABCDEFGHIJKLMNOP"})
            await Test("accept_name_length_"+name.Length,()=>Sync(()=>
            { byte[] bytes=Dto(name); Assert(AccountPolicy.TryParse(bytes,out var request)); using(request!) Assert(request!.AccountName==name.ToUpperInvariant()); Array.Clear(bytes); }));
        foreach (string name in new[]{"ab","ABCDEFGHIJKLMNOPQ"," PlayerOne","PlayerOne ","a;b","a'b","a|b","a\nb","a\0b","ĄBC","RNDBOT123","ADMIN","SYSTEM","SOAP"})
            await Test("reject_name_case_"+Guid.NewGuid().ToString("N")[..6],()=>Sync(()=>
            { byte[] bytes=Dto(name); Assert(!AccountPolicy.TryParse(bytes,out _)); Array.Clear(bytes); }));
        foreach (string secret in new[]{"A".PadRight(11,'A'),"A".PadRight(17,'A'),"lowercaseabc12","ABCD EFGH1234","ABCD'EFGH1234","ABCD\nEFGH1234"})
            await Test("reject_password_shape_"+Guid.NewGuid().ToString("N")[..6],()=>Sync(()=>
            { byte[] bytes=Dto(secret:secret); Assert(!AccountPolicy.TryParse(bytes,out _)); Array.Clear(bytes); }));
        foreach (int length in new[]{12,16})
            await Test("accept_password_length_"+length,()=>Sync(()=>
            { byte[] bytes=Dto(secret:NewSecret()[..length]); Assert(AccountPolicy.TryParse(bytes,out var request)); request!.Dispose(); Array.Clear(bytes); }));
        string good=Encoding.UTF8.GetString(Dto());
        var mutations=new Dictionary<string,string>
        {
            ["duplicate"]=good[..^1]+",\"password\":\"ZZZZZZZZZZZZ\"}",
            ["escaped_duplicate"]=good[..^1]+",\"pass\\u0077ord\":\"ZZZZZZZZZZZZ\"}",
            ["unknown"]=good[..^1]+",\"gm\":\"7\"}", ["nested"]=good.Replace("\"accountName\":\"PlayerOne\"","\"accountName\":{}"),
            ["null"]=good.Replace("\"accountName\":\"PlayerOne\"","\"accountName\":null"),
            ["array"]="["+good+"]",["comment"]="/*x*/"+good,["trailing"]=good+"x",["oversize"]=good+new string(' ',2049),
            ["zero_guid"]=good.Replace(good.Split('"')[3],Guid.Empty.ToString("D"))
        };
        foreach (var (label,value) in mutations)
            await Test("strict_json_"+label,()=>Sync(()=>Assert(!AccountPolicy.TryParse(Encoding.UTF8.GetBytes(value),out _))));
        await Test("secret_tostring_and_json_are_redacted",()=>Sync(()=>
        { using var request=Fixtures.Request(secret:NewSecret()); ExposedOutputs.Add(request.ToString()); ExposedOutputs.Add(JsonSerializer.Serialize(request)); ExposedOutputs.Add(request.Password.ToString()); }));
        await Test("password_equal_to_public_username_is_rejected",()=>Sync(()=>
        { byte[] bytes=Dto("PLAYERONE1234",secret:"PLAYERONE1234"); Assert(!AccountPolicy.TryParse(bytes,out _)); Array.Clear(bytes); }));
    }
    private static async Task EngineCases()
    {
        await Test("success_and_idempotent_retry_different_password",async()=>
        {
            var f=new Fixture(); var engine=f.Engine(); using var request=Fixtures.Request(secret:NewSecret());
            var first=await engine.ExecuteAsync(request,Fixtures.Sid,default);
            using var repeat=Fixtures.Request(request.OperationId,secret:NewSecret());
            var second=await engine.ExecuteAsync(repeat,Fixtures.Sid,default);
            Assert(first.State==AccountState.Succeeded && second==first && f.Backend.Dispatches==1 && f.Journal.Entries.Count==3 && f.Audit.Entries.Count==2 && !engine.BlocksControl);
            Assert(engine.Get(request.OperationId,Fixtures.OtherSid)==null); Capture(f,first);
            using var otherName=Fixtures.Request(request.OperationId,"OTHERTARGET");
            Assert((await engine.ExecuteAsync(otherName,Fixtures.Sid,default)).ErrorCode==AccountError.Conflict);
            Assert((await engine.ExecuteAsync(repeat,Fixtures.OtherSid,default)).ErrorCode==AccountError.Conflict && f.Backend.Dispatches==1);
        });
        await Test("worker_revalidates_untrusted_request",async()=>
        { var f=new Fixture(); using var request=Fixtures.Request(name:"BAD;NAME"); var result=await f.Engine().ExecuteAsync(request,Fixtures.Sid,default); Assert(result.State==AccountState.Rejected && f.Backend.Dispatches==0 && f.Audit.Entries.Count==0); });
        await Test("invalid_operator_sid_zero_dispatch",async()=>
        { var f=new Fixture(); using var request=Fixtures.Request(); var result=await f.Engine().ExecuteAsync(request,"untrusted",default); Assert(result.State==AccountState.Rejected && f.Backend.Dispatches==0); });
        await Test("invalid_worker_fields_are_not_reflected",async()=>
        { var f=new Fixture(); using var request=Fixtures.Request(name:NewSecret()+"\n"); var result=await f.Engine().ExecuteAsync(request,Fixtures.Sid,default); Assert(result.AccountName=="" && f.Backend.Dispatches==0); Capture(f,result); });
        await Test("cancel_before_admission_zero_dispatch",async()=>
        { var f=new Fixture(); using var request=Fixtures.Request(); using var token=new CancellationTokenSource(); token.Cancel(); var result=await f.Engine().ExecuteAsync(request,Fixtures.Sid,token.Token); Assert(result.ErrorCode==AccountError.Cancelled && f.Backend.Dispatches==0); });
        await Test("pre_audit_failure_zero_dispatch",async()=>
        { var f=new Fixture(); f.Audit.FailRequest=true; using var request=Fixtures.Request(); var result=await f.Engine().ExecuteAsync(request,Fixtures.Sid,default); Assert(result.ErrorCode==AccountError.AuditUnavailable && f.Backend.Dispatches==0 && f.Journal.Entries.Count==0); });
        foreach (int index in new[]{1,2}) foreach (bool after in new[]{false,true})
            await Test($"journal_write_failure_{index}_after_{after}_zero_dispatch",async()=>
            {
                var f=new Fixture(); f.Journal.FailAppend=index; f.Journal.ThrowAfterAppend=after;
                using var request=Fixtures.Request(); var engine=f.Engine(); var result=await engine.ExecuteAsync(request,Fixtures.Sid,default);
                Assert(f.Backend.Dispatches==0 && engine.BlocksControl && result.State is AccountState.Rejected or AccountState.FailedBeforeDispatch);
                Capture(f,result);
            });
        foreach (bool failure in new[]{false,true})
            await Test("baseline_"+(failure?"failure":"existing")+"_zero_dispatch",async()=>
            { var f=new Fixture(); f.Backend.BaselineFailure=failure; f.Backend.Exists=!failure; using var request=Fixtures.Request(); var result=await f.Engine().ExecuteAsync(request,Fixtures.Sid,default); Assert(f.Backend.Dispatches==0 && result.State==(failure?AccountState.FailedBeforeDispatch:AccountState.AlreadyExists)); Capture(f,result); });
        await Test("transport_exception_is_unknown_not_exposed",async()=>
        {
            var f=new Fixture(); f.Backend.SendFailure=true; f.Backend.FailureSecret=NewSecret(); using var request=Fixtures.Request(secret:f.Backend.FailureSecret);
            var engine=f.Engine(); var result=await engine.ExecuteAsync(request,Fixtures.Sid,default);
            Assert(result.State==AccountState.Unknown && f.Backend.Dispatches==1 && engine.BlocksControl);
            using var next=Fixtures.Request(); Assert((await engine.ExecuteAsync(next,Fixtures.Sid,default)).ErrorCode==AccountError.Pending);
            Assert((await engine.ExecuteAsync(request,Fixtures.Sid,default)).State==AccountState.Unknown && f.Backend.Dispatches==1); Capture(f,result);
        });
        await Test("timeout_after_send_unknown_no_retry",async()=>
        {
            var f=new Fixture(); var never=new TaskCompletionSource<CoreReply>(TaskCreationOptions.RunContinuationsAsynchronously); f.Backend.SendOverride=_=>never.Task;
            using var request=Fixtures.Request(secret:NewSecret()); var engine=f.Engine(TimeSpan.FromMilliseconds(30));
            var result=await engine.ExecuteAsync(request,Fixtures.Sid,default);
            Assert(result.State==AccountState.Unknown && f.Backend.Dispatches==1 && engine.BlocksControl); Capture(f,result);
        });
        await Test("verification_exception_unknown",async()=>
        { var f=new Fixture(); f.Backend.VerifyFailure=true; f.Backend.FailureSecret=NewSecret(); using var request=Fixtures.Request(secret:f.Backend.FailureSecret); var result=await f.Engine().ExecuteAsync(request,Fixtures.Sid,default); Assert(result.State==AccountState.Unknown && f.Backend.Dispatches==1); Capture(f,result); });
        var verificationCases=new Dictionary<string,Func<AccountVerification,AccountVerification>>
        {
            ["old_id"]=v=>v with{AccountId=100},["wrong_name"]=v=>v with{AccountName="OTHER"},["gm"]=v=>v with{GmLevel=1},
            ["realm_access"]=v=>v with{AllRealmAccessIsGm0=false},["defaults"]=v=>v with{DefaultsVerified=false},
            ["realmcharacters"]=v=>v with{RealmCharactersVerified=false},["wider_delta"]=v=>v with{WiderRealmDeltaVerified=false},
            ["other_effect"]=v=>v with{NoUnexpectedEffects=false},["incomplete"]=v=>v with{Complete=false}
        };
        foreach(var (name,mutate) in verificationCases)
            await Test("verification_requires_"+name,async()=>
            { var f=new Fixture(); f.Backend.Verification=mutate(f.Backend.Verification); using var request=Fixtures.Request(); var result=await f.Engine().ExecuteAsync(request,Fixtures.Sid,default); Assert(result.State==AccountState.Unknown && f.Backend.Dispatches==1); });
        await Test("terminal_audit_failure_retains_pending_across_restart",async()=>
        { var f=new Fixture(); f.Audit.FailResult=true; using var request=Fixtures.Request(secret:NewSecret()); var engine=f.Engine(); var result=await engine.ExecuteAsync(request,Fixtures.Sid,default); var recovered=f.Engine(); Assert(result.State==AccountState.SucceededAuditIncomplete && engine.BlocksControl && recovered.BlocksControl && recovered.Get(request.OperationId,Fixtures.Sid)!.State==AccountState.SucceededAuditIncomplete); Capture(f,result); });
        foreach(bool after in new[]{false,true})
            await Test("terminal_journal_failure_after_"+after+"_never_redispatches",async()=>
            { var f=new Fixture(); f.Journal.FailAppend=3; f.Journal.ThrowAfterAppend=after; using var request=Fixtures.Request(secret:NewSecret()); var engine=f.Engine(); var result=await engine.ExecuteAsync(request,Fixtures.Sid,default); Assert(result.State==AccountState.SucceededAuditIncomplete && engine.BlocksControl); var recovered=f.Engine(); await recovered.ExecuteAsync(request,Fixtures.Sid,default); Assert(f.Backend.Dispatches==1); Capture(f,result); });
    }
    private static async Task RecoveryAndConcurrency()
    {
        foreach (JournalPhase phase in new[]{JournalPhase.Intent,JournalPhase.Dispatching})
            await Test("recover_"+phase+"_does_not_replay",async()=>
            {
                var f=new Fixture(); Guid id=Guid.NewGuid(); f.Journal.Entries.Add(Fixtures.Entry(id,JournalPhase.Intent,1,0));
                if(phase==JournalPhase.Dispatching) f.Journal.Entries.Add(Fixtures.Entry(id,phase,2,1));
                var engine=f.Engine(); using var same=Fixtures.Request(id); using var other=Fixtures.Request();
                Assert(engine.Get(id,Fixtures.Sid)!.State==AccountState.ReconciliationRequired && engine.BlocksControl);
                Assert((await engine.ExecuteAsync(same,Fixtures.Sid,default)).State==AccountState.ReconciliationRequired);
                Assert((await engine.ExecuteAsync(other,Fixtures.Sid,default)).ErrorCode==AccountError.Pending && f.Backend.Dispatches==0);
            });
        foreach (string corruption in new[]{"read_failure","sequence_gap","first_dispatching","identity_changed","two_dispatches","bad_state"})
            await Test("corrupt_journal_"+corruption+"_blocks",async()=>
            {
                var f=new Fixture(); Guid id=Guid.NewGuid(); var first=Fixtures.Entry(id,JournalPhase.Intent,1,0);
                f.Journal.Entries.Add(first);
                switch(corruption)
                {
                    case "read_failure": f.Journal.FailRead=true; break;
                    case "sequence_gap": f.Journal.Entries[0]=first with {Sequence=2}; break;
                    case "first_dispatching": f.Journal.Entries[0]=first with {Phase=JournalPhase.Dispatching,DispatchAttempts=1}; break;
                    case "identity_changed": f.Journal.Entries.Add(first with {Sequence=2,Phase=JournalPhase.Dispatching,DispatchAttempts=1,OperatorSid=Fixtures.OtherSid}); break;
                    case "two_dispatches": f.Journal.Entries.Add(first with {Sequence=2,Phase=JournalPhase.Dispatching,DispatchAttempts=1}); f.Journal.Entries.Add(first with {Sequence=3,Phase=JournalPhase.Dispatching,DispatchAttempts=1}); break;
                    case "bad_state": f.Journal.Entries[0]=first with {State=(AccountState)999}; break;
                }
                var engine=f.Engine(); using var request=Fixtures.Request();
                Assert(engine.BlocksControl && (await engine.ExecuteAsync(request,Fixtures.Sid,default)).ErrorCode==AccountError.JournalUnavailable && f.Backend.Dispatches==0);
            });
        await Test("concurrent_create_and_service_control_single_dispatch",async()=>
        {
            var f=new Fixture(); var entered=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var release=new TaskCompletionSource<CoreReply>(TaskCreationOptions.RunContinuationsAsynchronously);
            f.Backend.SendOverride=_=>{entered.SetResult();return release.Task;};
            using var first=Fixtures.Request(secret:NewSecret()); using var second=Fixtures.Request(name:"PLAYERTWO"); var engine=f.Engine();
            var running=engine.ExecuteAsync(first,Fixtures.Sid,default); await entered.Task.WaitAsync(TimeSpan.FromSeconds(1));
            Assert(engine.Get(first.OperationId,Fixtures.Sid)!.State==AccountState.Running);
            Assert((await engine.ExecuteAsync(first,Fixtures.Sid,default)).State==AccountState.Running && f.Backend.Dispatches==1);
            Assert((await engine.ExecuteAsync(second,Fixtures.OtherSid,default)).ErrorCode==AccountError.Busy && f.Gate.TryEnter() is null && f.Backend.Dispatches==1);
            release.SetResult(CoreReply.ConfirmedSuccess); Assert((await running).State==AccountState.Succeeded);
            using var gate=f.Gate.TryEnter(); Assert(gate is not null && !engine.BlocksControl);
        });
        await Test("service_control_holding_gate_refuses_create",async()=>
        { var f=new Fixture(); using var hold=f.Gate.TryEnter(); using var request=Fixtures.Request(); Assert((await f.Engine().ExecuteAsync(request,Fixtures.Sid,default)).ErrorCode==AccountError.Busy && f.Backend.Dispatches==0); });
        await Test("http_disconnect_after_admission_does_not_replay",async()=>
        {
            var f=new Fixture(); using var abort=new CancellationTokenSource(); f.Backend.SendOverride=_=>{abort.Cancel();return Task.FromResult(CoreReply.ConfirmedSuccess);};
            using var request=Fixtures.Request(); var result=await f.Engine().ExecuteAsync(request,Fixtures.Sid,abort.Token);
            Assert(result.State==AccountState.Succeeded && f.Backend.Dispatches==1);
        });
    }
    private static async Task Storage()
    {
        var root=Directory.CreateTempSubdirectory("vmangos-a130-tests-");
        try
        {
            await Test("missing_journal_is_not_silently_recreated",()=>Sync(()=>
            {
                string path=Path.Combine(root.FullName,"missing.jsonl"); bool refused=false;
                try { using var journal=new FileOperationJournal(path); } catch(FileNotFoundException) { refused=true; }
                Assert(refused && !File.Exists(path));
            }));
            await Test("durable_journal_restart_and_exclusive_open",async()=>
            {
                string path=Path.Combine(root.FullName,"journal.jsonl"),auditPath=Path.Combine(root.FullName,"audit.jsonl");
                using var request=Fixtures.Request(secret:NewSecret()); var backend=new FakeBackend();
                using(var journal=new FileOperationJournal(path,createNew:true)) using(var audit=new FileAccountAudit(auditPath,createNew:true))
                {
                    var engine=new OperationEngine(journal,audit,backend,new TestGate());
                    Assert((await engine.ExecuteAsync(request,Fixtures.Sid,default)).State==AccountState.Succeeded);
                    bool denied=false; try { using var other=new FileOperationJournal(path); } catch(IOException) { denied=true; }
                    Assert(denied);
                }
                using(var journal=new FileOperationJournal(path)) using(var audit=new FileAccountAudit(auditPath))
                {
                    var engine=new OperationEngine(journal,audit,backend,new TestGate());
                    Assert((await engine.ExecuteAsync(request,Fixtures.Sid,default)).State==AccountState.Succeeded && backend.Dispatches==1);
                }
                ExposedOutputs.Add(File.ReadAllText(path)); ExposedOutputs.Add(File.ReadAllText(auditPath));
            });
            foreach(string bad in new[]{"partial_tail","duplicate_key","extra_field","oversize","bad_json"})
                await Test("record_file_rejects_"+bad,()=>Sync(()=>
                {
                    string path=Path.Combine(root.FullName,bad+".jsonl");
                    string good=JsonSerializer.Serialize(Fixtures.Entry(Guid.NewGuid(),JournalPhase.Intent,1,0),new JsonSerializerOptions(JsonSerializerDefaults.Web));
                    string raw=bad switch
                    {
                        "partial_tail"=>good,"duplicate_key"=>good[..^1]+",\"sequence\":1}\n",
                        "extra_field"=>good[..^1]+",\"password\":null}\n","oversize"=>new string('x',4097)+"\n",_=>"{bad}\n"
                    };
                    File.WriteAllText(path,raw,new UTF8Encoding(false)); bool refused=false;
                    try { using var journal=new FileOperationJournal(path); } catch(Exception e) when(e is IOException or InvalidDataException or JsonException) { refused=true; }
                    Assert(refused);
                }));
            await Test("record_capacity_fails_closed_without_truncation",()=>Sync(()=>
            {
                string path=Path.Combine(root.FullName,"capacity.jsonl"); using var journal=new FileOperationJournal(path,createNew:true);
                for(int i=0;i<512;i++) journal.Append(Fixtures.Entry(Guid.NewGuid(),JournalPhase.Intent,i+1,0));
                long length=new FileInfo(path).Length; bool refused=false;
                try { journal.Append(Fixtures.Entry(Guid.NewGuid(),JournalPhase.Intent,513,0)); } catch(IOException) { refused=true; }
                Assert(refused && new FileInfo(path).Length==length);
            }));
        }
        finally { root.Delete(recursive:true); }
    }
    private static DefaultHttpContext Context(IServiceProvider services,byte[]? body=null,bool https=true,Stream? stream=null)
    {
        var context=new DefaultHttpContext { RequestServices=services };
        context.Request.Scheme=https?"https":"http"; context.Request.Host=new HostString("wow-srv");
        context.Request.Path="/api/accounts/create"; context.Request.Method="POST"; context.Request.ContentType="application/json";
        context.Request.Body=stream??new MemoryStream(body??[]); context.Response.Body=new MemoryStream();
        context.User=new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier,Fixtures.Sid)],"fixture"));
        return context;
    }
    private static void Token(IAntiforgery anti,HttpContext context,IServiceProvider services)
    {
        var issuer=Context(services); var tokens=anti.GetAndStoreTokens(issuer);
        context.Request.Headers.Cookie=issuer.Response.Headers.SetCookie[0]!.Split(';')[0];
        context.Request.Headers["X-VMANGOS-CSRF"]=tokens.RequestToken;
    }
    private static async Task Http()
    {
        var collection=new ServiceCollection(); collection.AddLogging(); collection.AddDataProtection().UseEphemeralDataProtectionProvider();
        collection.AddAntiforgery(o=>o.HeaderName="X-VMANGOS-CSRF");
        using var services=collection.BuildServiceProvider(); var anti=services.GetRequiredService<IAntiforgery>();
        foreach(string scenario in new[]{"http","non_operator","disabled","no_csrf","bad_csrf","bad_content_type","encoding","query","known_oversize"})
            await Test("http_rejects_"+scenario+"_before_body",async()=>
            {
                var sentinel=new SentinelStream(); var context=Context(services,https:scenario!="http",stream:sentinel);
                var f=new Fixture(); IAccountGateway gateway=scenario=="disabled"?new DisabledAccountGateway():new FakeGateway(f.Engine());
                if(scenario=="http") context.Request.Headers["X-Forwarded-Proto"]="https";
                if(scenario=="bad_csrf") context.Request.Headers["X-VMANGOS-CSRF"]="invalid";
                if(scenario=="bad_content_type") context.Request.ContentType="text/plain";
                if(scenario=="encoding") context.Request.Headers.ContentEncoding="gzip";
                if(scenario=="query") context.Request.QueryString=new QueryString("?unexpected=1");
                if(scenario=="known_oversize") {Token(anti,context,services);context.Request.ContentLength=2049;}
                await AccountEndpoints.CreateCore(context,gateway,anti,_=>scenario=="non_operator"?null:Fixtures.Sid);
                Assert(context.Response.StatusCode>=400 && sentinel.Reads==0 && f.Backend.Dispatches==0 && context.Response.Headers.CacheControl=="no-store");
            });
        await Test("https_guard_precedes_downstream_body_reader",async()=>
        {
            var sentinel=new SentinelStream(); var context=Context(services,https:false,stream:sentinel); bool reached=false;
            await AccountEndpoints.HttpsGuard(context,_=>{reached=true;return Task.CompletedTask;}); Assert(!reached && sentinel.Reads==0 && context.Response.StatusCode==400);
            context=Context(services,https:false); context.Request.Path="/api/status";
            await AccountEndpoints.HttpsGuard(context,_=>{reached=true;return Task.CompletedTask;}); Assert(reached);
        });
        await Test("actual_antiforgery_valid_cookie_and_header_success",async()=>
        {
            byte[] dto=Dto(secret:NewSecret()); var context=Context(services,dto); Token(anti,context,services);
            var f=new Fixture(); await AccountEndpoints.CreateCore(context,new FakeGateway(f.Engine()),anti,_=>Fixtures.Sid);
            Assert(context.Response.StatusCode==201 && f.Backend.Dispatches==1);
            string response=Encoding.UTF8.GetString(((MemoryStream)context.Response.Body).ToArray()); ExposedOutputs.Add(response);
            Assert(!response.Contains("password",StringComparison.OrdinalIgnoreCase)); Array.Clear(dto);
        });
        await Test("unknown_length_body_bounded_to_2049",async()=>
        {
            var body=new CountingStream(new byte[10000]); var context=Context(services,stream:body); Token(anti,context,services);
            var f=new Fixture(); await AccountEndpoints.CreateCore(context,new FakeGateway(f.Engine()),anti,_=>Fixtures.Sid);
            Assert(context.Response.StatusCode==413 && body.TotalRead==2049 && f.Backend.Dispatches==0);
        });
        await Test("malformed_dto_with_valid_csrf_zero_dispatch",async()=>
        { var context=Context(services,Encoding.UTF8.GetBytes("{\"gm\":7}")); Token(anti,context,services); var f=new Fixture(); await AccountEndpoints.CreateCore(context,new FakeGateway(f.Engine()),anti,_=>Fixtures.Sid); Assert(context.Response.StatusCode==400 && f.Backend.Dispatches==0); });
        await Test("production_gateway_cannot_be_enabled_by_config",()=>Sync(()=>
        { IAccountGateway gateway=new DisabledAccountGateway(); Assert(!gateway.Capabilities.Enabled && !gateway.Capabilities.LiveReady); }));
        await Test("real_windows_operator_gate_rejects_claims_fixture",()=>Sync(()=>Assert(AccountEndpoints.WindowsOperatorSid(Context(services)) is null)));
    }
    private static async Task Protocol()
    {
        var expected=new ExpectedPeer("S-1-5-18",new string('A',64),123,DateTimeOffset.UtcNow,Guid.NewGuid());
        var good=new PeerProof(true,true,expected.TokenSid,expected.ImageSha256,expected.ProcessId,expected.CreatedUtc,expected.Generation);
        await Test("logical_peer_exact_proof_accepted",()=>Sync(()=>Assert(PeerRules.Accept(good,expected))));
        foreach(var pair in new Dictionary<string,PeerProof>
        {
            ["remote"]=good with {Local=false},["precreated"]=good with {FirstInstance=false},["sid"]=good with {TokenSid=Fixtures.Sid},
            ["hash"]=good with {ImageSha256=new string('B',64)},["pid"]=good with {ProcessId=124},
            ["created"]=good with {CreatedUtc=good.CreatedUtc.AddSeconds(1)},["generation"]=good with {Generation=Guid.NewGuid()}
        }) await Test("logical_peer_rejects_"+pair.Key,()=>Sync(()=>Assert(!PeerRules.Accept(pair.Value,expected))));
        byte[] body=JsonSerializer.SerializeToUtf8Bytes(new {version="1",generation=expected.Generation.ToString("D"),operationId=Guid.NewGuid().ToString("D"),accountName="PLAYERONE",password=NewSecret(),operatorSid=Fixtures.Sid});
        await Test("bounded_frame_and_strict_dto",async()=>
        {
            byte[] bytes=new byte[body.Length+4]; BinaryPrimitives.WriteInt32LittleEndian(bytes,body.Length); body.CopyTo(bytes,4);
            byte[] decoded=await AccountFrames.ReadAsync(new MemoryStream(bytes),default);
            Assert(AccountFrames.TryDecode(decoded,good,expected,out var request,out string sid) && sid==Fixtures.Sid); request!.Dispose(); Array.Clear(decoded); Array.Clear(bytes);
        });
        await Test("frame_generation_and_unknown_fields_rejected",()=>Sync(()=>
        {
            Assert(!AccountFrames.TryDecode(body,good,expected with{Generation=Guid.NewGuid()},out _,out _));
            byte[] bad=Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(body)[..^1]+",\"command\":\"arbitrary\"}");
            Assert(!AccountFrames.TryDecode(bad,good,expected,out _,out _)); Array.Clear(bad);
        }));
        foreach(int size in new[]{-1,0,4097,100})
            await Test("frame_bad_length_"+size,async()=>
            { byte[] bytes=new byte[4]; BinaryPrimitives.WriteInt32LittleEndian(bytes,size); bool refused=false; try {await AccountFrames.ReadAsync(new MemoryStream(bytes),default);} catch(Exception e) when(e is IOException or InvalidDataException){refused=true;} Assert(refused); });
        await Test("soap_fixed_mapping_never_arbitrary_command",()=>Sync(()=>
        {
            string secret=NewSecret(); using var request=Fixtures.Request(secret:secret); byte[] bytes=AccountSoapShape.Build(request);
            string xml=Encoding.UTF8.GetString(bytes); Assert(xml.Contains("account create PLAYERONE "+secret,StringComparison.Ordinal));
            Array.Clear(bytes);
        }));
        string valid="<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\"><s:Body><executeCommandResponse xmlns=\"urn:MaNGOS\"><result>fixture</result></executeCommandResponse></s:Body></s:Envelope>";
        await Test("soap_shape_is_not_success_classification",()=>Sync(()=>Assert(AccountSoapShape.IsBoundedResponse(Encoding.UTF8.GetBytes(valid)))));
        foreach(var (label,xml) in new Dictionary<string,string>
        {
            ["dtd"]="<!DOCTYPE x [<!ENTITY a 'x'>]>"+valid,["fault"]=valid.Replace("executeCommandResponse","Fault"),
            ["namespace"]=valid.Replace("urn:MaNGOS","urn:other"),["truncated"]=valid[..^10],["too_large"]=new string('x',65537),
            ["two_bodies"]=valid.Replace("</s:Envelope>","<s:Body/></s:Envelope>")
        }) await Test("soap_rejects_"+label,()=>Sync(()=>Assert(!AccountSoapShape.IsBoundedResponse(Encoding.UTF8.GetBytes(xml)))));
        Array.Clear(body);
    }
    private sealed class SentinelStream : MemoryStream
    {
        public int Reads;
        public override ValueTask<int> ReadAsync(Memory<byte> buffer,CancellationToken token=default)
        { Reads++; throw new InvalidOperationException("BODY_MUST_NOT_BE_READ"); }
    }
    private sealed class CountingStream(byte[] bytes) : MemoryStream(bytes)
    {
        public int TotalRead;
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer,CancellationToken token=default)
        { int n=await base.ReadAsync(buffer,token);TotalRead+=n;return n; }
    }
}
