# Isolated SQL outcome regressions (Windows)

Run in **Windows PowerShell 5.1 Desktop x64**, with existing Visual Studio C++ Build Tools and Windows SDK:

```powershell
& .\tests\isolated-sql-outcome\Run.ps1 -OutputDirectory C:\path\to\new-test-output
```

The output directory must not exist. No installation, server, service or database connection is needed. Existing tools are discovered with vswhere; explicit `-VisualStudioRoot` and `-WindowsSdkVersion` are also supported. The script compiles only the isolated test executable, never mangosd/realmd or runtime binaries. A timeout fails without killing or retrying a child process.

The runner extracts complete actual `_Query`, Execute, error-handler, transaction and prepared-execute functions from the selected source tree, compiles the exact SqlDelayThread.cpp and includes the exact ServiceWin32.cpp. Source hashes, compiler output, every native exit code and test output are recorded. Extraction checks unique function signatures; this is an isolated seam rather than a substitute implementation of those methods.

Fixtures replace the MySQL C client (including thread context instrumentation), connection reconnect, database queue owner, logging, clocks and SCM registration/dispatcher/status/current-directory. Stub declarations in DatabaseEnv.h and Database/SqlOperations.h intentionally expose methods for testing; production declarations and full application linkage are covered only by the separate release build. Framework headers and queue implementation come from the source tree. No real SQL, real service registration or real STOP/START is performed.

24 cases cover success, STOP before loop, arrivals during drain/after run, failed initialization, known/unknown worker exceptions, 1053 during work/explicit STOP, unconfirmed write without replay, duplicate/deadlock continuation, failed COMMIT with best-effort rollback, full `_Query` first/last attempt and bounded reconnect, prepared statements, and propagation through actual Windows service code. Expected native **1** is success of a negative case only when all assertions and actual measured result match; the test runner itself exits 0 only if all cases pass.

This does not prove real MySQL shutdown ordering, Windows SCM behavior/recovery, Windows PRESHUTDOWN, durable replay, a production STOP of R3, Linux portability, or the complete updated target release. Existing deployment evidence is separate and must not be presented as a Windows reboot test. Test fixtures originated in the accepted R3 isolated regression suite; this runner makes that suite reproducible within the proposed repository without machine-specific operational scripts.
