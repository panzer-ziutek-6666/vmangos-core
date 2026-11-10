using System.Text.Json;
using System.Text.Json.Serialization;
using Vmangos.AdminPanel.Telemetry;

namespace Vmangos.AdminPanel.Services;

public sealed class TelemetryReader
{
    private const int ByteCap = 32768;
    private readonly string _path;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 12
    };

    public TelemetryReader(IConfiguration configuration)
    {
        _path = configuration["Telemetry:SnapshotPath"] ??
            @"C:\ProgramData\VMANGOS\AdminPanelTelemetry\snapshot.json";
        if (!Path.IsPathFullyQualified(_path) || _path.StartsWith(@"\\", StringComparison.Ordinal) ||
            _path.StartsWith("//", StringComparison.Ordinal))
            throw new InvalidOperationException("Telemetry must use a fixed local absolute path.");
    }

    public async Task<TelemetryView> GetAsync(RuntimeStatusService runtime, CancellationToken cancellationToken)
    {
        if (!await _gate.WaitAsync(200, cancellationToken)) return TelemetryRules.Missing("unavailable");
        try
        {
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            deadline.CancelAfter(500);
            using var file = new FileStream(_path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete,
                4096, FileOptions.Asynchronous);
            if (file.Length > ByteCap) return TelemetryRules.Missing("invalid");
            byte[] buffer = new byte[ByteCap + 1];
            int used = 0;
            for (int index = 0; index < ByteCap + 1; index++)
            {
                int count = await file.ReadAsync(buffer.AsMemory(used, buffer.Length - used), deadline.Token);
                if (count == 0) break;
                used += count;
                if (used > ByteCap) return TelemetryRules.Missing("invalid");
            }
            using var json = JsonDocument.Parse(buffer.AsMemory(0, used), new JsonDocumentOptions { MaxDepth = 12 });
            RejectDuplicateKeys(json.RootElement);
            RequireCompleteShape(json.RootElement, typeof(TelemetryDocument));
            var document = json.Deserialize<TelemetryDocument>(JsonOptions)
                ?? throw new FormatException("TELEMETRY_INVALID");
            var world = runtime.GetWorldGeneration();
            return TelemetryRules.Evaluate(document, DateTimeOffset.UtcNow, world.ProcessId, world.CreatedUtc);
        }
        catch (FileNotFoundException) { return TelemetryRules.Missing("missing"); }
        catch (DirectoryNotFoundException) { return TelemetryRules.Missing("missing"); }
        catch (JsonException) { return TelemetryRules.Missing("invalid"); }
        catch (FormatException) { return TelemetryRules.Missing("invalid"); }
        catch (UnauthorizedAccessException) { return TelemetryRules.Missing("unavailable"); }
        catch (IOException) { return TelemetryRules.Missing("unavailable"); }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        { return TelemetryRules.Missing("unavailable"); }
        finally { _gate.Release(); }
    }

    private static void RejectDuplicateKeys(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            var keys = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in element.EnumerateObject())
            {
                if (!keys.Add(property.Name)) throw new FormatException("TELEMETRY_INVALID");
                RejectDuplicateKeys(property.Value);
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
            throw new FormatException("TELEMETRY_INVALID"); // Schema 1 has no arrays.
    }

    private static void RequireCompleteShape(JsonElement element, Type type)
    {
        if (element.ValueKind == JsonValueKind.Null) return; // Validation checks which nulls are allowed.
        if (type == typeof(string) || type.IsValueType) return;
        if (element.ValueKind != JsonValueKind.Object) throw new FormatException("TELEMETRY_INVALID");
        foreach (var property in type.GetProperties())
        {
            string name = JsonNamingPolicy.CamelCase.ConvertName(property.Name);
            if (!element.TryGetProperty(name, out var child)) throw new FormatException("TELEMETRY_INVALID");
            RequireCompleteShape(child, property.PropertyType);
        }
    }
}
