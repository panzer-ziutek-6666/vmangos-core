namespace Vmangos.Accounts.Core;

public enum JournalPhase { Intent, Dispatching, Terminal }
public sealed record JournalEntry(int SchemaVersion, long Sequence, Guid OperationId, string AccountName,
    string OperatorSid, JournalPhase Phase, AccountState State, AccountError ErrorCode, int DispatchAttempts,
    long? AccountId, DateTimeOffset TimestampUtc);
public sealed record SafeAudit(Guid OperationId, string AccountName, string OperatorSid, string Phase,
    AccountState State, AccountError ErrorCode, int DispatchAttempts, long? AccountId, DateTimeOffset TimestampUtc);
public interface IOperationJournal
{
    IReadOnlyList<JournalEntry> Read();
    void Append(JournalEntry entry);
}
public interface IAccountAudit { void Append(SafeAudit entry); }
public interface IControlGate { IDisposable? TryEnter(); }
public sealed record AccountBaseline(bool TargetExists, long MaximumAccountId);
public sealed record AccountVerification(long AccountId, string AccountName, int GmLevel, bool AllRealmAccessIsGm0,
    bool DefaultsVerified, bool RealmCharactersVerified, bool WiderRealmDeltaVerified, bool NoUnexpectedEffects, bool Complete);
public enum CoreReply { ConfirmedSuccess, Uncertain }
public interface IAccountBackend
{
    Task<AccountBaseline> BaselineAsync(string canonicalName, CancellationToken token);
    Task<CoreReply> CreateAsync(CreateAccountRequest request, CancellationToken token);
    Task<AccountVerification> VerifyAsync(string canonicalName, AccountBaseline baseline, CancellationToken token);
}

// Worker-side logic; not registered in IIS. Its dependencies must be supplied by a separately proven boundary.
public sealed class OperationEngine
{
    private readonly IOperationJournal _journal;
    private readonly IAccountAudit _audit;
    private readonly IAccountBackend _backend;
    private readonly IControlGate _control;
    private readonly SemaphoreSlim _serial = new(1, 1);
    private readonly object _sync = new();
    private readonly Dictionary<Guid, JournalEntry> _latest = [];
    private long _sequence;
    private bool _storageFault;
    private Guid? _activeOperation;
    private readonly TimeSpan _deadline;

    public OperationEngine(IOperationJournal journal, IAccountAudit audit, IAccountBackend backend, IControlGate control,
        TimeSpan? deadline = null)
    {
        _journal = journal; _audit = audit; _backend = backend; _control = control;
        _deadline = deadline ?? TimeSpan.FromSeconds(5);
        if (_deadline <= TimeSpan.Zero || _deadline > TimeSpan.FromSeconds(30)) throw new ArgumentOutOfRangeException(nameof(deadline));
        try
        {
            foreach (JournalEntry entry in journal.Read())
            {
                ValidateEntry(entry);
                _latest.TryGetValue(entry.OperationId, out var prior);
                bool validTransition = prior is null ? entry.Phase == JournalPhase.Intent && entry.DispatchAttempts == 0 :
                    prior.AccountName == entry.AccountName && prior.OperatorSid == entry.OperatorSid &&
                    prior.Phase != JournalPhase.Terminal && entry.DispatchAttempts >= prior.DispatchAttempts &&
                    ((prior.Phase == JournalPhase.Intent && entry.Phase == JournalPhase.Dispatching && entry.DispatchAttempts == 1) ||
                     (entry.Phase == JournalPhase.Terminal && entry.DispatchAttempts == prior.DispatchAttempts));
                if (entry.Sequence != _sequence + 1 || !validTransition) throw new InvalidDataException("JOURNAL_INVALID");
                _sequence = entry.Sequence; _latest[entry.OperationId] = entry;
            }
        }
        catch { _storageFault = true; }
    }

    public bool BlocksControl { get { lock (_sync) return _storageFault || _latest.Values.Any(IsPending); } }
    private static bool IsPending(JournalEntry e) => e.Phase != JournalPhase.Terminal ||
        e.State is AccountState.Unknown or AccountState.ReconciliationRequired or AccountState.SucceededAuditIncomplete;
    internal static void ValidateEntry(JournalEntry e)
    {
        if (e.SchemaVersion != 1 || e.Sequence < 1 || e.OperationId == Guid.Empty ||
            !AccountPolicy.TryCanonicalName(e.AccountName, out string name) || name != e.AccountName ||
            !AccountPolicy.ValidSid(e.OperatorSid) || !Enum.IsDefined(e.Phase) || !Enum.IsDefined(e.State) || !Enum.IsDefined(e.ErrorCode) ||
            e.DispatchAttempts is < 0 or > 1 || e.TimestampUtc.Offset != TimeSpan.Zero ||
            e.Phase == JournalPhase.Intent && (e.State != AccountState.Running || e.DispatchAttempts != 0) ||
            e.Phase == JournalPhase.Dispatching && (e.State != AccountState.Running || e.DispatchAttempts != 1) ||
            e.Phase == JournalPhase.Terminal && e.State == AccountState.Running ||
            e.State == AccountState.Succeeded && (e.DispatchAttempts != 1 || e.AccountId is null or <= 0))
            throw new InvalidDataException("JOURNAL_INVALID");
    }
    private AccountStatus Status(JournalEntry entry) => new(entry.OperationId, entry.AccountName,
        entry.Phase == JournalPhase.Terminal ? entry.State : _activeOperation == entry.OperationId ? AccountState.Running : AccountState.ReconciliationRequired,
        entry.Phase == JournalPhase.Terminal ? entry.ErrorCode : _activeOperation == entry.OperationId ? AccountError.None : AccountError.RecoveryRequired,
        entry.DispatchAttempts, entry.AccountId);
    public AccountStatus? Get(Guid id, string operatorSid)
    {
        lock (_sync) return _latest.TryGetValue(id, out var entry) && entry.OperatorSid == operatorSid ? Status(entry) : null;
    }
    private bool Save(CreateAccountRequest request, string sid, JournalPhase phase, AccountState state, AccountError error, int attempts, long? id)
    {
        var entry = new JournalEntry(1, _sequence + 1, request.OperationId, request.AccountName, sid, phase, state, error, attempts, id, DateTimeOffset.UtcNow);
        try
        {
            _journal.Append(entry);
            lock (_sync) { _latest[request.OperationId] = entry; _sequence = entry.Sequence; }
            return true;
        }
        catch { lock (_sync) _storageFault = true; return false; }
    }
    public async Task<AccountStatus> ExecuteAsync(CreateAccountRequest request, string operatorSid, CancellationToken admission)
    {
        AccountStatus Refused(AccountError error)
        {
            string safeName = AccountPolicy.TryCanonicalName(request.AccountName, out string canonical) && !request.Password.EqualsName(canonical) ? canonical : "";
            return new(request.OperationId, safeName, AccountState.Rejected, error, 0);
        }
        // Revalidate at the worker boundary; do not trust the web parser or IPC sender.
        if (!AccountPolicy.Valid(request) || !AccountPolicy.ValidSid(operatorSid)) return Refused(AccountError.InvalidRequest);
        bool acquired;
        try { acquired = await _serial.WaitAsync(0, admission); }
        catch (OperationCanceledException) { return Refused(AccountError.Cancelled); }
        if (!acquired)
        {
            lock (_sync)
            {
                if (_latest.TryGetValue(request.OperationId, out var pending))
                    return pending.AccountName == request.AccountName && pending.OperatorSid == operatorSid ? Status(pending) : Refused(AccountError.Conflict);
            }
            return Refused(AccountError.Busy);
        }
        int attemptedDispatch = 0;
        try
        {
            lock (_sync)
            {
                if (_latest.TryGetValue(request.OperationId, out var old))
                    return old.AccountName == request.AccountName && old.OperatorSid == operatorSid ? Status(old) : Refused(AccountError.Conflict);
                if (_storageFault) return Refused(AccountError.JournalUnavailable);
                if (_latest.Values.Any(IsPending)) return Refused(AccountError.Pending);
            }
            using var lease = _control.TryEnter();
            if (lease is null) return Refused(AccountError.Busy);
            if (admission.IsCancellationRequested) return Refused(AccountError.Cancelled);
            lock (_sync) _activeOperation = request.OperationId;
            try { _audit.Append(new(request.OperationId, request.AccountName, operatorSid, "request", AccountState.Running, AccountError.None, 0, null, DateTimeOffset.UtcNow)); }
            catch { return Refused(AccountError.AuditUnavailable); }
            if (!Save(request, operatorSid, JournalPhase.Intent, AccountState.Running, AccountError.None, 0, null))
                return Refused(AccountError.JournalUnavailable);

            AccountStatus Finish(AccountState state, AccountError error, int attempts, long? id = null)
            {
                bool auditOk;
                try { _audit.Append(new(request.OperationId, request.AccountName, operatorSid, "result", state, error, attempts, id, DateTimeOffset.UtcNow)); auditOk = true; }
                catch { auditOk = false; }
                if (!auditOk)
                {
                    state = state == AccountState.Succeeded ? AccountState.SucceededAuditIncomplete : attempts > 0 ? AccountState.Unknown : AccountState.FailedBeforeDispatch;
                    error = AccountError.TerminalWriteFailed;
                }
                bool journalOk = Save(request, operatorSid, JournalPhase.Terminal, state, error, attempts, id);
                if (!journalOk)
                {
                    state = state is AccountState.Succeeded or AccountState.SucceededAuditIncomplete ? AccountState.SucceededAuditIncomplete : attempts > 0 ? AccountState.ReconciliationRequired : AccountState.FailedBeforeDispatch;
                    error = AccountError.TerminalWriteFailed;
                }
                return new(request.OperationId, request.AccountName, state, error, attempts, id);
            }

            // Once admitted, HTTP disconnects cannot cancel/replay the operation. Worker deadline is independent.
            using var timeout = new CancellationTokenSource(_deadline);
            AccountBaseline baseline;
            try { baseline = await _backend.BaselineAsync(request.AccountName, timeout.Token).WaitAsync(timeout.Token); }
            catch { return Finish(AccountState.FailedBeforeDispatch, AccountError.BaselineUnavailable, 0); }
            if (baseline.MaximumAccountId < 0) return Finish(AccountState.FailedBeforeDispatch, AccountError.BaselineUnavailable, 0);
            if (baseline.TargetExists) return Finish(AccountState.AlreadyExists, AccountError.AlreadyExists, 0);
            if (!Save(request, operatorSid, JournalPhase.Dispatching, AccountState.Running, AccountError.None, 1, null))
                return new(request.OperationId, request.AccountName, AccountState.FailedBeforeDispatch, AccountError.JournalUnavailable, 0);
            CoreReply reply;
            attemptedDispatch = 1;
            try { reply = await _backend.CreateAsync(request, timeout.Token).WaitAsync(timeout.Token); }
            catch { return Finish(AccountState.Unknown, AccountError.TransportUncertain, 1); }
            if (reply != CoreReply.ConfirmedSuccess) return Finish(AccountState.Unknown, AccountError.TransportUncertain, 1);
            AccountVerification verified;
            try { verified = await _backend.VerifyAsync(request.AccountName, baseline, timeout.Token).WaitAsync(timeout.Token); }
            catch { return Finish(AccountState.Unknown, AccountError.VerificationIncomplete, 1); }
            if (!verified.Complete || verified.AccountName != request.AccountName || verified.AccountId <= baseline.MaximumAccountId ||
                verified.GmLevel != 0 || !verified.AllRealmAccessIsGm0 || !verified.DefaultsVerified ||
                !verified.RealmCharactersVerified || !verified.WiderRealmDeltaVerified || !verified.NoUnexpectedEffects)
                return Finish(AccountState.Unknown, AccountError.VerificationIncomplete, 1);
            return Finish(AccountState.Succeeded, AccountError.None, 1, verified.AccountId);
        }
        catch
        {
            // Unknown storage/control errors are never reported as proof of no effect.
            lock (_sync) _storageFault = true;
            return new(request.OperationId, request.AccountName, AccountState.ReconciliationRequired, AccountError.RecoveryRequired, attemptedDispatch);
        }
        finally { lock (_sync) _activeOperation = null; _serial.Release(); }
    }
}
