namespace Vmangos.Accounts.Windows;

internal static class RuntimeProcessPolicy
{
    private static readonly string[] Forbidden =
    [
        "DOTNET_STARTUP_HOOKS", "DOTNET_ADDITIONAL_DEPS", "DOTNET_SHARED_STORE", "DOTNET_ROOT", "DOTNET_ROOT_X64",
        "DOTNET_HOST_PATH", "DOTNET_ROLL_FORWARD", "DOTNET_ROLL_FORWARD_TO_PRERELEASE", "DOTNET_MODIFIABLE_ASSEMBLIES",
        "CORECLR_ENABLE_PROFILING", "CORECLR_PROFILER", "CORECLR_PROFILER_PATH", "CORECLR_PROFILER_PATH_64",
        "COR_ENABLE_PROFILING", "COR_PROFILER", "COR_PROFILER_PATH", "COMPLUS_ENABLEDIAGNOSTICS",
        "COMPlus_ForceENC", "COMPlus_AltJit", "COMPlus_AltJitName", "DOTNET_DiagnosticPorts",
        "DOTNET_ENABLE_PROFILING", "DOTNET_PROFILER", "DOTNET_PROFILER_PATH"
    ];
    internal static void AssertEnvironment(Func<string, string?> lookup)
    {
        foreach (string name in Forbidden)
            BoundaryLimits.Check(string.IsNullOrEmpty(lookup(name)), BoundaryError.InvalidSpec);
    }
    internal static void AssertCurrent()
    {
        BoundaryLimits.Check(OperatingSystem.IsWindows() && Environment.Is64BitProcess && Environment.Version.Major == 10,
            BoundaryError.WindowsRequired);
        AssertEnvironment(Environment.GetEnvironmentVariable);
    }
}
