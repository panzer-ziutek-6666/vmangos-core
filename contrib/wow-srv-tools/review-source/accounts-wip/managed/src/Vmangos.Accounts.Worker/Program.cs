using Vmangos.Accounts.Windows;

// Executable fixture only. No default server startup, service installation,
// credential input, network endpoint, shell or backend selection.
if (!OperatingSystem.IsWindows()) { Console.WriteLine("A135_WORKER_ERROR=WindowsRequired"); return 2; }
try
{
    if (args.Length != 3 || args[0] is not ("--initialize-fixture" or "--fixture-worker"))
    { Console.WriteLine("A135_WORKER_ERROR=InvalidSpec"); return 2; }
    var spec = FixtureSpec.Load(args[1], args[2]);
    if (args[0] == "--initialize-fixture")
    {
        FixtureStorage.Initialize(spec);
        Console.WriteLine("A135_STORAGE_INITIALIZED=True LIVE_CONNECTIONS=0");
        return 0;
    }
    var result = await WindowsFixture.RunWorkerAsync(spec);
    Console.WriteLine("A135_WORKER_SESSIONS=" + result.SessionsCompleted + " SYNTHETIC_DISPATCHES=" + result.SyntheticDispatches + " LIVE_CONNECTIONS=0");
    return 0;
}
catch (BoundaryException error) { Console.WriteLine("A135_WORKER_ERROR=" + error.Code); return 1; }
catch (OperationCanceledException) { Console.WriteLine("A135_WORKER_ERROR=Timeout"); return 1; }
catch { Console.WriteLine("A135_WORKER_ERROR=Unexpected"); return 1; }
