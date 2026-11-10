using System.Security.Cryptography;
using Vmangos.Accounts.Core;

internal static class Fixtures
{
    internal const string Sid = "S-1-5-21-100-200-300-1001";
    internal const string OtherSid = "S-1-5-21-100-200-300-1002";
    internal static string Secret() => string.Concat(Enumerable.Range(0,16).Select(_ => "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[RandomNumberGenerator.GetInt32(36)]));
    internal static CreateAccountRequest Request(Guid? id = null,string name = "PLAYERONE",string? secret = null) =>
        new(id ?? Guid.NewGuid(),name,new PasswordSecret(secret ?? Secret()));
    internal static JournalEntry Entry(Guid id,JournalPhase phase,long sequence,int attempts) =>
        new(1,sequence,id,"PLAYERONE",Sid,phase,AccountState.Running,AccountError.None,attempts,null,DateTimeOffset.UtcNow);
}
internal sealed class MemoryJournal : IOperationJournal
{
    internal List<JournalEntry> Entries = [];
    internal int FailAppend = -1;
    internal bool ThrowAfterAppend;
    internal bool FailRead;
    private int _appends;
    public IReadOnlyList<JournalEntry> Read() => FailRead ? throw new IOException("SYNTHETIC_STORAGE_FAILURE") : Entries.ToArray();
    public void Append(JournalEntry entry)
    {
        bool fail = ++_appends == FailAppend;
        if (fail && !ThrowAfterAppend) throw new IOException("SYNTHETIC_STORAGE_FAILURE");
        Entries.Add(entry);
        if (fail) throw new IOException("SYNTHETIC_STORAGE_FAILURE");
    }
}
internal sealed class MemoryAudit : IAccountAudit
{
    internal List<SafeAudit> Entries = [];
    internal bool FailRequest, FailResult;
    public void Append(SafeAudit entry)
    {
        if (entry.Phase == "request" && FailRequest || entry.Phase == "result" && FailResult) throw new IOException("SYNTHETIC_AUDIT_FAILURE");
        Entries.Add(entry);
    }
}
internal sealed class TestGate : IControlGate
{
    private readonly SemaphoreSlim _gate = new(1,1);
    public IDisposable? TryEnter() => _gate.Wait(0) ? new Release(_gate) : null;
    private sealed class Release(SemaphoreSlim gate) : IDisposable { public void Dispose() => gate.Release(); }
}
internal sealed class FakeBackend : IAccountBackend
{
    internal int Dispatches;
    internal bool Exists, BaselineFailure, SendFailure, VerifyFailure;
    internal string FailureSecret = "";
    internal Func<CancellationToken,Task<CoreReply>>? SendOverride;
    internal AccountVerification Verification = new(101,"PLAYERONE",0,true,true,true,true,true,true);
    public Task<AccountBaseline> BaselineAsync(string name,CancellationToken token) => BaselineFailure ?
        Task.FromException<AccountBaseline>(new IOException(FailureSecret)) : Task.FromResult(new AccountBaseline(Exists,100));
    public Task<CoreReply> CreateAsync(CreateAccountRequest request,CancellationToken token)
    {
        Dispatches++;
        if (SendFailure) throw new IOException(FailureSecret);
        return SendOverride?.Invoke(token) ?? Task.FromResult(CoreReply.ConfirmedSuccess);
    }
    public Task<AccountVerification> VerifyAsync(string name,AccountBaseline baseline,CancellationToken token) => VerifyFailure ?
        Task.FromException<AccountVerification>(new IOException(FailureSecret)) : Task.FromResult(Verification);
}
internal sealed class Fixture
{
    internal MemoryJournal Journal = new();
    internal MemoryAudit Audit = new();
    internal FakeBackend Backend = new();
    internal TestGate Gate = new();
    internal OperationEngine Engine(TimeSpan? deadline = null) => new(Journal,Audit,Backend,Gate,deadline);
}
internal sealed class FakeGateway(OperationEngine engine) : IAccountGateway
{
    public AccountCapabilities Capabilities => new(true,false,"offline_fake");
    public Task<AccountStatus> SubmitAsync(CreateAccountRequest request,string sid,CancellationToken token) => engine.ExecuteAsync(request,sid,token);
    public Task<AccountStatus?> GetAsync(Guid id,string sid,CancellationToken token) => Task.FromResult(engine.Get(id,sid));
}
