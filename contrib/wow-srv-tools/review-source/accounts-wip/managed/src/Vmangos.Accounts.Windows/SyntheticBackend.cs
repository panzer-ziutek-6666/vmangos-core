using Vmangos.Accounts.Core;

namespace Vmangos.Accounts.Windows;

// Fixture only: no network, credentials, command executor, DB or SOAP client.
internal sealed class SyntheticBackend : IAccountBackend
{
    private readonly Dictionary<string, long> _accounts = new(StringComparer.Ordinal);
    private long _last = 1000;
    public int Dispatches { get; private set; }
    public Task<AccountBaseline> BaselineAsync(string name, CancellationToken token) => Task.FromResult(new AccountBaseline(_accounts.ContainsKey(name), _last));
    public Task<CoreReply> CreateAsync(CreateAccountRequest request, CancellationToken token)
    {
        BoundaryLimits.Check(AccountPolicy.Valid(request) && !_accounts.ContainsKey(request.AccountName), BoundaryError.FrameInvalid);
        _accounts.Add(request.AccountName, ++_last); Dispatches++;
        return Task.FromResult(CoreReply.ConfirmedSuccess);
    }
    public Task<AccountVerification> VerifyAsync(string name, AccountBaseline baseline, CancellationToken token) =>
        Task.FromResult(new AccountVerification(_accounts[name], name, 0, true, true, true, true, true, true));
}

internal sealed class SyntheticControlGate : IControlGate
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    public IDisposable? TryEnter() => _gate.Wait(0) ? new Lease(_gate) : null;
    private sealed class Lease(SemaphoreSlim gate) : IDisposable
    {
        private SemaphoreSlim? _gate = gate;
        public void Dispose() => Interlocked.Exchange(ref _gate, null)?.Release();
    }
}
