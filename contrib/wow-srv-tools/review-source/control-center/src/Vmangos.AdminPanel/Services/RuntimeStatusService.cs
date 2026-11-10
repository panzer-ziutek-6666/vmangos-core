using System.Globalization;
using System.Net;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace Vmangos.AdminPanel.Services;

public sealed class RuntimeStatusService
{
    private static readonly string[] AllowedServices =
    [
        "VMANGOS-MySQL",
        "realmd",
        "mangosd"
    ];

    private readonly ProcessUptimeCache _uptime;

    public RuntimeStatusService(ILogger<RuntimeStatusService> logger)
    {
        _uptime = new ProcessUptimeCache(
            WmiProcessStartTimeReader.ReadCreationUtc,
            () => Environment.TickCount64,
            () => DateTime.UtcNow,
            action =>
            {
                // Use the worker process identity; do not flow the HTTP caller's context.
                if (!ThreadPool.UnsafeQueueUserWorkItem(_ => action(), null))
                    throw new InvalidOperationException("Cannot queue the WMI uptime read.");
            },
            (pid, error) => logger.LogWarning(error,
                "WMI uptime unavailable for mangosd PID {ProcessId}; service status remains available.", pid));
    }

    // Reuse the existing bounded asynchronous WMI cache, including its generation guards.
    public (int ProcessId, DateTimeOffset? CreatedUtc) GetWorldGeneration()
    {
        var service = ServiceControlManager.Query("mangosd");
        bool running = service.State == "Running" && service.ProcessId > 0;
        _uptime.GetUptimeSeconds(running, service.ProcessId);
        DateTime? created = _uptime.GetCachedCreationUtc(service.ProcessId);
        return (running ? service.ProcessId : 0,
            created.HasValue ? new DateTimeOffset(created.Value) : null);
    }

    public object GetStatus()
    {
        var listeners = IPGlobalProperties
            .GetIPGlobalProperties()
            .GetActiveTcpListeners();

        var mysql = GetService("VMANGOS-MySQL", 3306, listeners);
        var realmd = GetService("realmd", 3724, listeners);
        var mangosd = GetService("mangosd", 8085, listeners);

        var mangosdUptimeSeconds = _uptime.GetUptimeSeconds(
            mangosd.State == "Running", mangosd.ProcessId);

        var soapListeners = listeners
            .Where(x => x.Port == 7878)
            .ToArray();

        var soapListening = soapListeners.Length > 0;
        var soapLocalOnly = soapListening &&
            soapListeners.All(x => IPAddress.IsLoopback(x.Address));

        var ready =
            mysql.Ready &&
            realmd.Ready &&
            mangosd.Ready &&
            soapListening &&
            soapLocalOnly;

        return new
        {
            host = Environment.MachineName,
            timestamp = DateTimeOffset.Now,
            systemUptimeSeconds = Environment.TickCount64 / 1000,
            mangosdUptimeSeconds,
            ready,
            services = new
            {
                mysql,
                realmd,
                mangosd
            },
            soap = new
            {
                port = 7878,
                listening = soapListening,
                localOnly = soapLocalOnly,
                addresses = soapListeners
                    .Select(x => x.Address.ToString())
                    .Distinct()
                    .OrderBy(x => x)
                    .ToArray()
            }
        };
    }

    private static ServiceRuntimeStatus GetService(
        string serviceName,
        int port,
        IPEndPoint[] listeners)
    {
        if (!AllowedServices.Contains(serviceName, StringComparer.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Service is not allowlisted.");
        }

        var service = ServiceControlManager.Query(serviceName);
        var portListening = listeners.Any(x => x.Port == port);

        return new ServiceRuntimeStatus(
            serviceName,
            service.State,
            service.ProcessId,
            port,
            portListening,
            service.State == "Running" && portListening);
    }
}

public sealed record ServiceRuntimeStatus(
    string Name,
    string State,
    int ProcessId,
    int Port,
    bool PortListening,
    bool Ready);

internal static class ServiceControlManager
{
    private const uint ScManagerConnect = 0x0001;
    private const uint ServiceQueryStatus = 0x0004;
    private const int ScStatusProcessInfo = 0;

    public static ServiceQueryResult Query(string serviceName)
    {
        var scm = OpenSCManager(null, null, ScManagerConnect);

        if (scm == IntPtr.Zero)
        {
            throw new InvalidOperationException(
                $"OpenSCManager failed with Win32 error {Marshal.GetLastWin32Error()}.");
        }

        try
        {
            var service = OpenService(scm, serviceName, ServiceQueryStatus);

            if (service == IntPtr.Zero)
            {
                return new ServiceQueryResult("NotFound", 0);
            }

            try
            {
                var size = Marshal.SizeOf<SERVICE_STATUS_PROCESS>();
                var buffer = Marshal.AllocHGlobal(size);

                try
                {
                    if (!QueryServiceStatusEx(
                        service,
                        ScStatusProcessInfo,
                        buffer,
                        size,
                        out _))
                    {
                        throw new InvalidOperationException(
                            $"QueryServiceStatusEx({serviceName}) failed with Win32 error {Marshal.GetLastWin32Error()}.");
                    }

                    var status = Marshal.PtrToStructure<SERVICE_STATUS_PROCESS>(buffer);

                    return new ServiceQueryResult(
                        MapState(status.dwCurrentState),
                        unchecked((int)status.dwProcessId));
                }
                finally
                {
                    Marshal.FreeHGlobal(buffer);
                }
            }
            finally
            {
                CloseServiceHandle(service);
            }
        }
        finally
        {
            CloseServiceHandle(scm);
        }
    }

    private static string MapState(uint state) => state switch
    {
        1 => "Stopped",
        2 => "StartPending",
        3 => "StopPending",
        4 => "Running",
        5 => "ContinuePending",
        6 => "PausePending",
        7 => "Paused",
        _ => $"Unknown({state})"
    };

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr OpenSCManager(
        string? machineName,
        string? databaseName,
        uint desiredAccess);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr OpenService(
        IntPtr scManager,
        string serviceName,
        uint desiredAccess);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryServiceStatusEx(
        IntPtr service,
        int infoLevel,
        IntPtr buffer,
        int bufferSize,
        out int bytesNeeded);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseServiceHandle(IntPtr handle);

    [StructLayout(LayoutKind.Sequential)]
    private struct SERVICE_STATUS_PROCESS
    {
        public uint dwServiceType;
        public uint dwCurrentState;
        public uint dwControlsAccepted;
        public uint dwWin32ExitCode;
        public uint dwServiceSpecificExitCode;
        public uint dwCheckPoint;
        public uint dwWaitHint;
        public uint dwProcessId;
        public uint dwServiceFlags;
    }
}

internal sealed record ServiceQueryResult(
    string State,
    int ProcessId);

// This cache owns one background read, including while an old PID read is stalled.
// A timeout observed by the caller would not cancel COM, so it never frees that slot.
internal sealed class ProcessUptimeCache
{
    private const long RefreshMilliseconds = 15000;
    private const long ValidMilliseconds = 30000;
    private const long RetryMilliseconds = 10000;
    private const long WarningMilliseconds = 60000;
    private readonly object _gate = new object();
    private readonly Func<int, DateTime?> _readCreationUtc;
    private readonly Func<long> _milliseconds;
    private readonly Func<DateTime> _utcNow;
    private readonly Action<Action> _queue;
    private readonly Action<int, Exception> _warn;
    private int _processId;
    private long _generation;
    private DateTime? _createdUtc;
    private long _validUntil;
    private long _nextAttempt;
    private long _nextWarning = long.MinValue;
    private bool _readInFlight;

    internal ProcessUptimeCache(
        Func<int, DateTime?> readCreationUtc,
        Func<long> milliseconds,
        Func<DateTime> utcNow,
        Action<Action> queue,
        Action<int, Exception> warn)
    {
        _readCreationUtc = readCreationUtc;
        _milliseconds = milliseconds;
        _utcNow = utcNow;
        _queue = queue;
        _warn = warn;
    }

    internal long? GetUptimeSeconds(bool running, int processId)
    {
        ReadRequest? request = null;
        long? uptime = null;
        lock (_gate)
        {
            long now = _milliseconds();
            int observed = running && processId > 0 ? processId : 0;
            if (observed != _processId)
            {
                _processId = observed;
                _generation++;
                _createdUtc = null;
                _validUntil = 0;
                _nextAttempt = now;
            }
            if (observed == 0)
            {
                return null;
            }
            if (_createdUtc.HasValue && now < _validUntil)
            {
                TimeSpan age = _utcNow() - _createdUtc.Value;
                if (age >= TimeSpan.Zero)
                {
                    uptime = (long)age.TotalSeconds;
                }
                else
                {
                    _createdUtc = null;
                    _nextAttempt = now;
                }
            }
            if (!_readInFlight && now >= _nextAttempt)
            {
                _readInFlight = true;
                _nextAttempt = now + RetryMilliseconds;
                request = new ReadRequest(observed, _generation);
            }
        }
        if (request != null)
        {
            ReadRequest pending = request;
            try
            {
                // The production scheduler suppresses request ExecutionContext flow.
                _queue(() => Refresh(pending));
            }
            catch (Exception error)
            {
                Complete(pending, null, error);
            }
        }
        return uptime;
    }

    internal DateTime? GetCachedCreationUtc(int processId)
    {
        lock (_gate)
        {
            return processId > 0 && processId == _processId && _milliseconds() < _validUntil
                ? _createdUtc : null;
        }
    }

    private void Refresh(ReadRequest request)
    {
        DateTime? created = null;
        Exception? failure = null;
        try
        {
            lock (_gate)
            {
                if (request.Generation != _generation || request.ProcessId != _processId)
                {
                    _readInFlight = false;
                    return;
                }
            }
            created = _readCreationUtc(request.ProcessId);
            if (!created.HasValue || created.Value.Kind != DateTimeKind.Utc || created.Value > _utcNow())
            {
                throw new InvalidOperationException("WMI returned no valid UTC process creation time.");
            }
        }
        catch (Exception error)
        {
            failure = error;
        }
        Complete(request, created, failure);
    }

    private void Complete(ReadRequest request, DateTime? created, Exception? failure)
    {
        bool warn = false;
        lock (_gate)
        {
            long now = _milliseconds();
            _readInFlight = false;
            if (request.Generation != _generation || request.ProcessId != _processId)
            {
                return;
            }
            if (failure == null)
            {
                _createdUtc = created;
                _validUntil = now + ValidMilliseconds;
                _nextAttempt = now + RefreshMilliseconds;
            }
            else
            {
                // Retain a previously verified value only until its original expiry.
                _nextAttempt = now + RetryMilliseconds;
                if (now >= _nextWarning)
                {
                    _nextWarning = now + WarningMilliseconds;
                    warn = true;
                }
            }
        }
        if (warn && failure != null)
        {
            try { _warn(request.ProcessId, failure); }
            catch (Exception) { /* A logging provider cannot break the status API. */ }
        }
    }

    private sealed class ReadRequest
    {
        internal readonly int ProcessId;
        internal readonly long Generation;
        internal ReadRequest(int processId, long generation)
        {
            ProcessId = processId;
            Generation = generation;
        }
    }
}

internal static class WmiProcessStartTimeReader
{
    internal static DateTime? ReadCreationUtc(int processId)
    {
        if (processId <= 0) throw new ArgumentOutOfRangeException(nameof(processId));
        if (!OperatingSystem.IsWindows()) return null;
        return ReadWindowsCreationUtc(processId);
    }

    [SupportedOSPlatform("windows")]
    private static DateTime ReadWindowsCreationUtc(int processId)
    {
        IWbemLocator? locator = null;
        IWbemServices? services = null;
        IEnumWbemClassObject? enumerator = null;
        try
        {
            Type locatorType = Type.GetTypeFromCLSID(
                new Guid("4590F811-1D3A-11D0-891F-00AA004B2E24"), true)
                ?? throw new InvalidOperationException("WMI locator type is unavailable.");
            locator = (IWbemLocator)(Activator.CreateInstance(locatorType)
                ?? throw new InvalidOperationException("WMI locator is unavailable."));
            // 0x80 is WMI's native connect limit (up to two minutes), not an HTTP timeout.
            // This entire method runs outside the HTTP path; only one read can remain in flight.
            CheckHResult(locator.ConnectServer("ROOT\\CIMV2", null, null, null,
                0x80, null, IntPtr.Zero, out services));
            SetAndVerifyCloaking(services, typeof(IWbemServices));
            string query = "SELECT ProcessId,CreationDate FROM Win32_Process WHERE ProcessId=" +
                processId.ToString(CultureInfo.InvariantCulture);
            CheckHResult(services.ExecQuery("WQL", query, 0x30, IntPtr.Zero, out enumerator));
            SetAndVerifyCloaking(enumerator, typeof(IEnumWbemClassObject));

            DateTime? created = null;
            int count = 0;
            // Fixed bound: a row and end-of-enumeration check, never a growing result list.
            for (int index = 0; index < 2; index++)
            {
                IWbemClassObject[] row = new IWbemClassObject[1];
                try
                {
                    int status = enumerator.Next(2000, 1, row, out uint returned);
                    CheckHResult(status);
                    if (status == 0x00040004) throw new TimeoutException("WMI enumeration timed out.");
                    if (returned == 0)
                    {
                        if (status != 1) throw new InvalidOperationException("Unexpected empty WMI status.");
                        break;
                    }
                    if (returned != 1 || row[0] == null || ++count > 1)
                        throw new InvalidOperationException("Invalid WMI process row count.");
                    int observed = Convert.ToInt32(GetProperty(row[0], "ProcessId"), CultureInfo.InvariantCulture);
                    if (observed != processId) throw new InvalidOperationException("WMI returned a different PID.");
                    string raw = Convert.ToString(GetProperty(row[0], "CreationDate"), CultureInfo.InvariantCulture)
                        ?? throw new InvalidOperationException("WMI CreationDate is null.");
                    created = ParseDmtfUtc(raw);
                }
                finally { Release(row[0]); }
            }
            if (count != 1 || !created.HasValue)
                throw new InvalidOperationException("WMI returned no process row.");
            return created.Value;
        }
        finally
        {
            try { Release(enumerator); }
            finally
            {
                try { Release(services); }
                finally { Release(locator); }
            }
        }
    }

    private static object GetProperty(IWbemClassObject row, string name)
    {
        CheckHResult(row.Get(name, 0, out object value, out _, out _));
        if (value == null || value == DBNull.Value)
            throw new InvalidOperationException("WMI property is null: " + name);
        return value;
    }

    private static void CheckHResult(int status)
    {
        if (status < 0) Marshal.ThrowExceptionForHR(status);
    }

    [SupportedOSPlatform("windows")]
    private static void SetAndVerifyCloaking(object proxy, Type interfaceType)
    {
        IntPtr pointer = Marshal.GetComInterfaceForObject(proxy, interfaceType);
        IntPtr principal = IntPtr.Zero;
        try
        {
            CheckHResult(CoSetProxyBlanket(pointer, 10, 0, IntPtr.Zero, 6, 3, IntPtr.Zero, 0x40));
            CheckHResult(CoQueryProxyBlanket(pointer, out _, out _, out principal,
                out uint level, out uint impersonation, out _, out uint capabilities));
            if ((capabilities & 0x40) == 0 || impersonation != 3 || level < 6)
                throw new InvalidOperationException("WMI proxy security did not match requested settings.");
        }
        finally
        {
            if (principal != IntPtr.Zero) Marshal.FreeCoTaskMem(principal);
            Marshal.Release(pointer);
        }
    }

    [SupportedOSPlatform("windows")]
    private static void Release(object? value)
    {
        if (value != null) Marshal.FinalReleaseComObject(value);
    }

    internal static DateTime ParseDmtfUtc(string value)
    {
        if (value.Length != 25 || value[14] != '.' ||
            (value[21] != '+' && value[21] != '-') || value.IndexOf('*') >= 0)
            throw new FormatException("DMTF datetime is incomplete or malformed.");
        for (int index = 0; index < value.Length; index++)
            if (index != 14 && index != 21 && (value[index] < '0' || value[index] > '9'))
                throw new FormatException("DMTF datetime contains a non-digit.");
        DateTime local = DateTime.ParseExact(value.Substring(0, 14), "yyyyMMddHHmmss",
            CultureInfo.InvariantCulture, DateTimeStyles.None);
        int micros = int.Parse(value.Substring(15, 6), CultureInfo.InvariantCulture);
        int minutes = int.Parse(value.Substring(22, 3), CultureInfo.InvariantCulture);
        if (value[21] == '-') minutes = -minutes;
        return new DateTimeOffset(DateTime.SpecifyKind(local, DateTimeKind.Unspecified),
            TimeSpan.FromMinutes(minutes)).UtcDateTime.AddTicks(checked((long)micros * 10));
    }

    [DllImport("ole32.dll")]
    private static extern int CoSetProxyBlanket(IntPtr proxy, uint authentication, uint authorization,
        IntPtr principal, uint level, uint impersonation, IntPtr authenticationInfo, uint capabilities);
    [DllImport("ole32.dll")]
    private static extern int CoQueryProxyBlanket(IntPtr proxy, out uint authentication, out uint authorization,
        out IntPtr principal, out uint level, out uint impersonation, out IntPtr authenticationInfo,
        out uint capabilities);

    [ComImport, Guid("DC12A687-737F-11CF-884D-00AA004B2E24"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IWbemLocator
    {
        [PreserveSig] int ConnectServer([MarshalAs(UnmanagedType.BStr)] string resource,
            [MarshalAs(UnmanagedType.BStr)] string? user, [MarshalAs(UnmanagedType.BStr)] string? password,
            [MarshalAs(UnmanagedType.BStr)] string? locale, int flags,
            [MarshalAs(UnmanagedType.BStr)] string? authority, IntPtr context, out IWbemServices services);
    }

    [ComImport, Guid("9556DC99-828C-11CF-A37E-00AA003240C7"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IWbemServices
    {
        // Uncalled slots preserve the IWbemServices vtable. Only read-only ExecQuery is callable.
        [PreserveSig] int UnusedSlot03();
        [PreserveSig] int UnusedSlot04();
        [PreserveSig] int UnusedSlot05();
        [PreserveSig] int UnusedSlot06();
        [PreserveSig] int UnusedSlot07();
        [PreserveSig] int UnusedSlot08();
        [PreserveSig] int UnusedSlot09();
        [PreserveSig] int UnusedSlot10();
        [PreserveSig] int UnusedSlot11();
        [PreserveSig] int UnusedSlot12();
        [PreserveSig] int UnusedSlot13();
        [PreserveSig] int UnusedSlot14();
        [PreserveSig] int UnusedSlot15();
        [PreserveSig] int UnusedSlot16();
        [PreserveSig] int UnusedSlot17();
        [PreserveSig] int UnusedSlot18();
        [PreserveSig] int UnusedSlot19();
        [PreserveSig] int ExecQuery([MarshalAs(UnmanagedType.BStr)] string language,
            [MarshalAs(UnmanagedType.BStr)] string query, int flags, IntPtr context,
            out IEnumWbemClassObject enumerator);
    }

    [ComImport, Guid("027947E1-D731-11CE-A357-000000000001"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IEnumWbemClassObject
    {
        [PreserveSig] int UnusedReset();
        [PreserveSig] int Next(int timeoutMilliseconds, uint count,
            [Out, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 1, ArraySubType = UnmanagedType.Interface)]
            IWbemClassObject[] objects, out uint returned);
    }

    [ComImport, Guid("DC12A681-737F-11CF-884D-00AA004B2E24"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IWbemClassObject
    {
        [PreserveSig] int UnusedGetQualifierSet();
        [PreserveSig] int Get([MarshalAs(UnmanagedType.LPWStr)] string name, int flags,
            [MarshalAs(UnmanagedType.Struct)] out object value, out int cimType, out int flavor);
    }
}
