using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Vmangos.Accounts.Core;

// Storage mechanics only. Windows SYSTEM/Administrators ownership and ACL are a separate installation gate.
internal sealed class BoundedRecordFile<T> : IDisposable
{
    private const int FileCap = 1048576, RecordCap = 4096, CountCap = 512;
    private readonly FileStream _stream;
    private readonly string[] _fields;
    private readonly Action<T> _validate;
    private readonly List<T> _records = [];
    private readonly object _sync = new();
    private bool _faulted;
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    { UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow, PropertyNameCaseInsensitive = false, MaxDepth = 3 };

    public BoundedRecordFile(string path, string[] fields, Action<T> validate, bool createNew)
    {
        _fields = fields; _validate = validate;
        if (!Path.IsPathFullyQualified(path) || path.StartsWith("\\\\", StringComparison.Ordinal)) throw new IOException("LOCAL_PATH_REQUIRED");
        var file = new FileInfo(path);
        for (DirectoryInfo? parent = file.Directory; parent is not null; parent = parent.Parent)
            if (!parent.Exists || (parent.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("REGULAR_PATH_REQUIRED");
        if (file.Exists && (file.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("REGULAR_FILE_REQUIRED");
        _stream = new FileStream(path, createNew ? FileMode.CreateNew : FileMode.Open, FileAccess.ReadWrite, FileShare.None, 4096, FileOptions.WriteThrough);
        try
        {
            if (_stream.Length > FileCap) throw new InvalidDataException("STORAGE_CAP");
            byte[] bytes = new byte[(int)_stream.Length];
            _stream.ReadExactly(bytes);
            try
            {
                if (bytes.Length != 0 && bytes[^1] != 10) throw new InvalidDataException("PARTIAL_RECORD");
                int start = 0;
                for (int i = 0; i < bytes.Length; i++)
                {
                    if (bytes[i] != 10) continue;
                    int length = i - start;
                    if (length is 0 or > RecordCap || _records.Count == CountCap) throw new InvalidDataException("STORAGE_CAP");
                    using var doc = JsonDocument.Parse(bytes.AsMemory(start, length), new JsonDocumentOptions { MaxDepth = 3 });
                    if (doc.RootElement.ValueKind != JsonValueKind.Object) throw new InvalidDataException("RECORD_INVALID");
                    var names = new HashSet<string>(StringComparer.Ordinal);
                    foreach (var p in doc.RootElement.EnumerateObject())
                        if (!_fields.Contains(p.Name, StringComparer.Ordinal) || !names.Add(p.Name)) throw new InvalidDataException("RECORD_INVALID");
                    if (names.Count != _fields.Length) throw new InvalidDataException("RECORD_INVALID");
                    T record = doc.Deserialize<T>(Options) ?? throw new InvalidDataException("RECORD_INVALID");
                    _validate(record); _records.Add(record); start = i + 1;
                }
            }
            finally { Array.Clear(bytes); }
            _stream.Seek(0, SeekOrigin.End);
        }
        catch { _stream.Dispose(); throw; }
    }
    public IReadOnlyList<T> Read() { lock (_sync) return _records.ToArray(); }
    public void Append(T record)
    {
        _validate(record);
        byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(record, Options);
        try
        {
            lock (_sync)
            {
                if (_faulted || bytes.Length > RecordCap || _records.Count >= CountCap || _stream.Length + bytes.Length + 1 > FileCap)
                    throw new IOException("STORAGE_CAP_OR_FAULT");
                try
                {
                    _stream.Write(bytes); _stream.WriteByte(10); _stream.Flush(flushToDisk: true);
                    _records.Add(record);
                }
                catch { _faulted = true; throw; }
            }
        }
        finally { Array.Clear(bytes); }
    }
    public void Dispose() => _stream.Dispose();
}

public sealed class FileOperationJournal : IOperationJournal, IDisposable
{
    private readonly BoundedRecordFile<JournalEntry> _file;
    public FileOperationJournal(string path, bool createNew = false) => _file = new(path,
        ["schemaVersion","sequence","operationId","accountName","operatorSid","phase","state","errorCode","dispatchAttempts","accountId","timestampUtc"],
        OperationEngine.ValidateEntry, createNew);
    public IReadOnlyList<JournalEntry> Read() => _file.Read();
    public void Append(JournalEntry entry) => _file.Append(entry);
    public void Dispose() => _file.Dispose();
}

public sealed class FileAccountAudit : IAccountAudit, IDisposable
{
    private readonly BoundedRecordFile<SafeAudit> _file;
    public FileAccountAudit(string path, bool createNew = false) => _file = new(path,
        ["operationId","accountName","operatorSid","phase","state","errorCode","dispatchAttempts","accountId","timestampUtc"],
        entry =>
        {
            if (entry.OperationId == Guid.Empty || !AccountPolicy.TryCanonicalName(entry.AccountName, out string name) || name != entry.AccountName ||
                !AccountPolicy.ValidSid(entry.OperatorSid) || entry.Phase is not ("request" or "result") ||
                !Enum.IsDefined(entry.State) || !Enum.IsDefined(entry.ErrorCode) || entry.DispatchAttempts is < 0 or > 1 || entry.TimestampUtc.Offset != TimeSpan.Zero)
                throw new InvalidDataException("AUDIT_INVALID");
        }, createNew);
    public void Append(SafeAudit entry) => _file.Append(entry);
    public void Dispose() => _file.Dispose();
}
