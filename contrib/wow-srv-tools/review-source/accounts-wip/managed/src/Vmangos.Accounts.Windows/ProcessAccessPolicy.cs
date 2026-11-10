using System.Text.Json;

namespace Vmangos.Accounts.Windows;

public static class ProcessAccessPolicy
{
    public const string Id = "A135-PRIVATE-TOKEN-QUERY-1";
    public const uint ProcessRead = 0x00101000, TokenRead = 8;
    internal const uint ProcessFull = 0x001FFFFF, TokenFull = 0x000F01FF;
    public static string ProcessDacl(string poolSid) => Dacl(ProcessFull, ProcessRead, poolSid);
    public static string TokenDacl(string poolSid) => Dacl(TokenFull, TokenRead, poolSid);
    private static string Dacl(uint full, uint read, string sid)
    {
        BoundaryLimits.Check(sid == BoundaryLimits.TargetPoolSid, BoundaryError.InvalidSpec);
        // No owner/group/SACL in token attributes; never change a source token.
        return $"D:P(A;;0x{full:X8};;;SY)(A;;0x{full:X8};;;BA)(A;;0x{read:X8};;;{sid})";
    }
    internal static void AssertLimits(JsonElement value)
    {
        WireCodec.ExactFields(value, "stageSeconds", "ownedProcesses", "captureBytes");
        BoundaryLimits.Check(value.GetProperty("stageSeconds").GetInt32() == 300 &&
            value.GetProperty("ownedProcesses").GetInt32() == 3 && value.GetProperty("captureBytes").GetInt32() == 65536,
            BoundaryError.InvalidSpec);
    }
    internal static string[] EnvironmentFor(FixtureSpec spec, bool client) =>
    ["SystemRoot=C:\\Windows", "windir=C:\\Windows", "SystemDrive=C:", "PATH=C:\\Windows\\System32",
        "TEMP=" + spec.PathOf(client ? "client-temp" : "system-temp"),
        "TMP=" + spec.PathOf(client ? "client-temp" : "system-temp"), "DOTNET_EnableDiagnostics=0"];
}

// Shared with the real native implementation; models exercise failures and
// prove that no resume is admitted before all independent checks succeed.
internal interface ILaunchSteps
{
    void CreateSuspended(); void AssignJob(); void Verify(); void Resume(); void AbortOwned();
}
internal static class LaunchOrder
{
    internal static void Start(ILaunchSteps steps)
    {
        try { steps.CreateSuspended(); steps.AssignJob(); steps.Verify(); steps.Resume(); }
        catch { steps.AbortOwned(); throw; }
    }
}
