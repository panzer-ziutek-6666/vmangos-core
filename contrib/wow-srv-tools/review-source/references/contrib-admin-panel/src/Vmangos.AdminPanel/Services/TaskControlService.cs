using System.Diagnostics;

namespace Vmangos.AdminPanel.Services;

public sealed class TaskControlService(
    ILogger<TaskControlService> logger,
    ControlAuditWriter auditWriter)
{
    private const string SchtasksPath = @"C:\Windows\System32\schtasks.exe";

    private const string StartAllTask = "VMANGOS-ADMIN-PANEL-START-ALL";
    private const string StopAllTask = "VMANGOS-ADMIN-PANEL-STOP-ALL";
    private const string RestartWorldTask = "VMANGOS-ADMIN-PANEL-RESTART-WORLD";

    public Task<ControlDispatchResult> StartAllAsync(
        ControlRequestContext request,
        CancellationToken cancellationToken) =>
        DispatchTaskAsync(
            operation: "Start-All",
            taskName: StartAllTask,
            request,
            cancellationToken);

    public Task<ControlDispatchResult> StopAllAsync(
        ControlRequestContext request,
        CancellationToken cancellationToken) =>
        DispatchTaskAsync(
            operation: "Stop-All",
            taskName: StopAllTask,
            request,
            cancellationToken);

    public Task<ControlDispatchResult> RestartWorldAsync(
        ControlRequestContext request,
        CancellationToken cancellationToken) =>
        DispatchTaskAsync(
            operation: "Restart-World",
            taskName: RestartWorldTask,
            request,
            cancellationToken);

    private async Task<ControlDispatchResult> DispatchTaskAsync(
        string operation,
        string taskName,
        ControlRequestContext request,
        CancellationToken cancellationToken)
    {
        var stopwatch = Stopwatch.StartNew();

        try
        {
            await auditWriter.AppendAsync(
                new ControlAuditRecord(
                    TimestampUtc: DateTimeOffset.UtcNow,
                    Phase: "request",
                    CorrelationId: request.CorrelationId,
                    User: request.User,
                    RemoteIp: request.RemoteIp,
                    Operation: operation,
                    TaskName: taskName,
                    Accepted: null,
                    ExitCode: null,
                    DurationMs: 0,
                    Result: "requested",
                    Detail: null),
                cancellationToken);
        }
        catch (Exception ex)
        {
            stopwatch.Stop();

            logger.LogError(
                ex,
                "VMANGOS_CONTROL correlationId={CorrelationId} user={User} remoteIp={RemoteIp} operation={Operation} task={TaskName} accepted=False auditPersisted=False actionRefused=True durationMs={DurationMs}",
                request.CorrelationId,
                request.User,
                request.RemoteIp,
                operation,
                taskName,
                stopwatch.ElapsedMilliseconds);

            return new ControlDispatchResult(
                Accepted: false,
                CorrelationId: request.CorrelationId,
                Operation: operation,
                Message: "Durable audit log is unavailable; privileged action refused.",
                ExitCode: null);
        }

        try
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = SchtasksPath,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            startInfo.ArgumentList.Add("/Run");
            startInfo.ArgumentList.Add("/TN");
            startInfo.ArgumentList.Add(taskName);

            using var process = new Process
            {
                StartInfo = startInfo
            };

            if (!process.Start())
            {
                throw new InvalidOperationException("schtasks.exe failed to start.");
            }

            var stdoutTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
            var stderrTask = process.StandardError.ReadToEndAsync(cancellationToken);

            await process.WaitForExitAsync(cancellationToken);

            _ = (await stdoutTask).Trim();
            var stderr = (await stderrTask).Trim();
            stopwatch.Stop();

            var accepted = process.ExitCode == 0;
            var result = accepted ? "accepted" : "rejected";
            var detail = accepted ? null : SafeSingleLine(stderr);

            if (accepted)
            {
                logger.LogInformation(
                    "VMANGOS_CONTROL correlationId={CorrelationId} user={User} remoteIp={RemoteIp} operation={Operation} task={TaskName} accepted={Accepted} exitCode={ExitCode} durationMs={DurationMs}",
                    request.CorrelationId,
                    request.User,
                    request.RemoteIp,
                    operation,
                    taskName,
                    true,
                    process.ExitCode,
                    stopwatch.ElapsedMilliseconds);
            }
            else
            {
                logger.LogWarning(
                    "VMANGOS_CONTROL correlationId={CorrelationId} user={User} remoteIp={RemoteIp} operation={Operation} task={TaskName} accepted={Accepted} exitCode={ExitCode} durationMs={DurationMs} stderr={Stderr}",
                    request.CorrelationId,
                    request.User,
                    request.RemoteIp,
                    operation,
                    taskName,
                    false,
                    process.ExitCode,
                    stopwatch.ElapsedMilliseconds,
                    detail);
            }

            try
            {
                await auditWriter.AppendAsync(
                    new ControlAuditRecord(
                        TimestampUtc: DateTimeOffset.UtcNow,
                        Phase: "result",
                        CorrelationId: request.CorrelationId,
                        User: request.User,
                        RemoteIp: request.RemoteIp,
                        Operation: operation,
                        TaskName: taskName,
                        Accepted: accepted,
                        ExitCode: process.ExitCode,
                        DurationMs: stopwatch.ElapsedMilliseconds,
                        Result: result,
                        Detail: detail),
                    CancellationToken.None);
            }
            catch (Exception auditException)
            {
                logger.LogError(
                    auditException,
                    "VMANGOS_CONTROL correlationId={CorrelationId} user={User} remoteIp={RemoteIp} operation={Operation} task={TaskName} accepted={Accepted} exitCode={ExitCode} auditCompletionPersisted=False durationMs={DurationMs}",
                    request.CorrelationId,
                    request.User,
                    request.RemoteIp,
                    operation,
                    taskName,
                    accepted,
                    process.ExitCode,
                    stopwatch.ElapsedMilliseconds);

                var auditWarning = accepted
                    ? " Task Scheduler accepted the action, but the completion audit record could not be persisted; the request audit record exists."
                    : " Task Scheduler rejected the action, but the completion audit record could not be persisted; the request audit record exists.";

                return new ControlDispatchResult(
                    Accepted: accepted,
                    CorrelationId: request.CorrelationId,
                    Operation: operation,
                    Message: (accepted
                        ? "Task Scheduler accepted the fixed VMaNGOS action."
                        : "Task Scheduler rejected the fixed VMaNGOS action.") + auditWarning,
                    ExitCode: process.ExitCode);
            }

            return new ControlDispatchResult(
                Accepted: accepted,
                CorrelationId: request.CorrelationId,
                Operation: operation,
                Message: accepted
                    ? "Task Scheduler accepted the fixed VMaNGOS action."
                    : "Task Scheduler rejected the fixed VMaNGOS action.",
                ExitCode: process.ExitCode);
        }
        catch (OperationCanceledException)
        {
            stopwatch.Stop();

            logger.LogWarning(
                "VMANGOS_CONTROL correlationId={CorrelationId} user={User} remoteIp={RemoteIp} operation={Operation} task={TaskName} accepted=False cancelled=True durationMs={DurationMs}",
                request.CorrelationId,
                request.User,
                request.RemoteIp,
                operation,
                taskName,
                stopwatch.ElapsedMilliseconds);

            await TryAppendTerminalAuditAsync(
                new ControlAuditRecord(
                    TimestampUtc: DateTimeOffset.UtcNow,
                    Phase: "result",
                    CorrelationId: request.CorrelationId,
                    User: request.User,
                    RemoteIp: request.RemoteIp,
                    Operation: operation,
                    TaskName: taskName,
                    Accepted: null,
                    ExitCode: null,
                    DurationMs: stopwatch.ElapsedMilliseconds,
                    Result: "cancelled",
                    Detail: null));

            return new ControlDispatchResult(
                Accepted: false,
                CorrelationId: request.CorrelationId,
                Operation: operation,
                Message: "Control dispatch was cancelled before Task Scheduler confirmed acceptance.",
                ExitCode: null);
        }
        catch (Exception ex)
        {
            stopwatch.Stop();

            logger.LogError(
                ex,
                "VMANGOS_CONTROL correlationId={CorrelationId} user={User} remoteIp={RemoteIp} operation={Operation} task={TaskName} accepted=False durationMs={DurationMs}",
                request.CorrelationId,
                request.User,
                request.RemoteIp,
                operation,
                taskName,
                stopwatch.ElapsedMilliseconds);

            await TryAppendTerminalAuditAsync(
                new ControlAuditRecord(
                    TimestampUtc: DateTimeOffset.UtcNow,
                    Phase: "result",
                    CorrelationId: request.CorrelationId,
                    User: request.User,
                    RemoteIp: request.RemoteIp,
                    Operation: operation,
                    TaskName: taskName,
                    Accepted: false,
                    ExitCode: null,
                    DurationMs: stopwatch.ElapsedMilliseconds,
                    Result: "error",
                    Detail: ex.GetType().Name));

            return new ControlDispatchResult(
                Accepted: false,
                CorrelationId: request.CorrelationId,
                Operation: operation,
                Message: "Control dispatch failed before Task Scheduler accepted the action.",
                ExitCode: null);
        }

        async Task TryAppendTerminalAuditAsync(ControlAuditRecord record)
        {
            try
            {
                await auditWriter.AppendAsync(record, CancellationToken.None);
            }
            catch (Exception auditException)
            {
                logger.LogError(
                    auditException,
                    "VMANGOS_CONTROL correlationId={CorrelationId} user={User} remoteIp={RemoteIp} operation={Operation} task={TaskName} auditCompletionPersisted=False result={Result}",
                    record.CorrelationId,
                    record.User,
                    record.RemoteIp,
                    record.Operation,
                    record.TaskName,
                    record.Result);
            }
        }
    }

    private static string SafeSingleLine(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        const int maxLength = 300;

        var normalized = value
            .Replace('\r', ' ')
            .Replace('\n', ' ')
            .Trim();

        return normalized.Length <= maxLength
            ? normalized
            : normalized[..maxLength];
    }
}

public sealed record ControlRequestContext(
    string CorrelationId,
    string User,
    string RemoteIp);

public sealed record ControlDispatchResult(
    bool Accepted,
    string CorrelationId,
    string Operation,
    string Message,
    int? ExitCode);
