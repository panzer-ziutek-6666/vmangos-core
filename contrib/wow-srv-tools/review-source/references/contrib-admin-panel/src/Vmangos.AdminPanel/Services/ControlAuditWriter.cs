using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;

namespace Vmangos.AdminPanel.Services;

public sealed class ControlAuditWriter
{
    private readonly string _path;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public ControlAuditWriter(IConfiguration configuration)
    {
        _path = configuration["Audit:ControlLogPath"]
            ?? throw new InvalidOperationException("Audit:ControlLogPath is not configured.");

        if (!Path.IsPathFullyQualified(_path))
        {
            throw new InvalidOperationException("Audit:ControlLogPath must be an absolute path.");
        }
    }

    public async Task AppendAsync(
        ControlAuditRecord record,
        CancellationToken cancellationToken)
    {
        var directory = Path.GetDirectoryName(_path);

        if (string.IsNullOrWhiteSpace(directory) || !Directory.Exists(directory))
        {
            throw new InvalidOperationException(
                $"Control audit directory does not exist: {directory}");
        }

        var json = JsonSerializer.Serialize(record);
        var bytes = Encoding.UTF8.GetBytes(json + Environment.NewLine);

        await _gate.WaitAsync(cancellationToken);

        try
        {
            await using var stream = new FileStream(
                _path,
                FileMode.Append,
                FileAccess.Write,
                FileShare.Read,
                bufferSize: 4096,
                FileOptions.Asynchronous | FileOptions.WriteThrough);

            await stream.WriteAsync(bytes.AsMemory(), cancellationToken);
            await stream.FlushAsync(cancellationToken);
            stream.Flush(flushToDisk: true);
        }
        finally
        {
            _gate.Release();
        }
    }
}

public sealed record ControlAuditRecord(
    DateTimeOffset TimestampUtc,
    string Phase,
    string CorrelationId,
    string User,
    string RemoteIp,
    string Operation,
    string TaskName,
    bool? Accepted,
    int? ExitCode,
    long DurationMs,
    string Result,
    string? Detail);
