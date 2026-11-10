using Vmangos.Accounts.Windows;

if (!OperatingSystem.IsWindows()) { Console.WriteLine("A135_LAUNCH_ERROR=WindowsRequired"); return 2; }
try
{
    if (args.Length != 3 || args[0] != "--fixture-launch") { Console.WriteLine("A135_LAUNCH_ERROR=InvalidSpec"); return 2; }
    var spec = FixtureSpec.Load(args[1], args[2]);
    var report = FixtureLaunch.Run(spec);
    Console.WriteLine("A135_LAUNCH_OWNED_CHILDREN=" + report.OwnedChildren + " SESSIONS=" + report.Sessions + " SYNTHETIC_DISPATCHES=" + report.SyntheticDispatches +
        " SOURCE_TOKENS_UNCHANGED=" + report.SourceTokensUnchanged + " JOB_QUIESCENT=" + report.JobQuiescent + " LIVE_CONNECTIONS=0 IIS_PIPELINE_TESTED=False");
    return 0;
}
catch (BoundaryException e) { Console.WriteLine("A135_LAUNCH_ERROR=" + e.Code); return 1; }
catch { Console.WriteLine("A135_LAUNCH_ERROR=Unexpected"); return 1; }
