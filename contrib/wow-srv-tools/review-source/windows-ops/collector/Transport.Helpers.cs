using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.RegularExpressions;
using System.Text;
using System.Threading;
using System.Xml;
using System;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;

namespace VmangosAiBotCountR220261007
{
    // Fixed buffers drain both pipes concurrently; child output never grows a file/list.
    internal sealed class Capture
    {
        private readonly object gate = new object();
        private readonly StringBuilder text = new StringBuilder();
        private long seen;
        private string failure;
        internal void Read(StreamReader reader)
        {
            char[] buffer = new char[2048];
            try
            {
                int count;
                while ((count = reader.Read(buffer, 0, buffer.Length)) > 0)
                {
                    lock (gate)
                    {
                        seen += count;
                        int take = Math.Min(count, 16384 - text.Length);
                        if (take > 0) text.Append(buffer, 0, take);
                    }
                }
            }
            catch (Exception error)
            {
                lock (gate) { failure = error.GetType().Name + ": " + error.Message; }
            }
        }
        internal string Text { get { lock (gate) { return text.ToString(); } } }
        internal long Seen { get { lock (gate) { return seen; } } }
        internal string Failure { get { lock (gate) { return failure; } } }
    }

    public sealed class Child : IDisposable
    {
        private readonly Process process;
        private readonly Capture stdout = new Capture();
        private readonly Capture stderr = new Capture();
        private readonly Thread outputReader;
        private readonly Thread errorReader;
        private bool closed;
        public Child(string file, string arguments, string directory, string[] environment)
        {
            ProcessStartInfo info = new ProcessStartInfo(file, arguments);
            info.WorkingDirectory = directory;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            foreach (string entry in environment)
            {
                int split = entry.IndexOf('=');
                if (split <= 0) throw new ArgumentException("Invalid child environment pair.");
                info.EnvironmentVariables[entry.Substring(0, split)] = entry.Substring(split + 1);
            }
            info.EnvironmentVariables.Remove("MYSQL_PWD");
            info.EnvironmentVariables.Remove("MYSQL_TEST_LOGIN_FILE");
            info.EnvironmentVariables.Remove("MYSQL_GROUP_SUFFIX");
            process = new Process();
            process.StartInfo = info;
            if (!process.Start()) throw new InvalidOperationException("Cannot start retained child process.");
            outputReader = new Thread(() => stdout.Read(process.StandardOutput));
            errorReader = new Thread(() => stderr.Read(process.StandardError));
            outputReader.IsBackground = true;
            errorReader.IsBackground = true;
            try { outputReader.Start(); errorReader.Start(); }
            catch { try { process.Kill(); process.WaitForExit(3000); } finally { process.Dispose(); } throw; }
        }
        public int Id { get { return process.Id; } }
        public bool HasExited { get { return process.HasExited; } }
        public int ExitCode { get { return process.ExitCode; } }
        public bool Wait(int milliseconds) { return process.WaitForExit(milliseconds); }
        public bool OutputLimitExceeded { get { return stdout.Seen > 16384 || stderr.Seen > 16384; } }
        public string StandardOutput { get { return stdout.Text; } }
        public string StandardError { get { return stderr.Text; } }
        public string ReaderFailure { get { return stdout.Failure ?? stderr.Failure; } }
        public long OutputCharacters { get { return stdout.Seen; } }
        public long ErrorCharacters { get { return stderr.Seen; } }
        public bool WasTerminated { get; private set; }
        public bool ReadersCompleted { get; private set; }
        public void Finish()
        {
            if (closed) return;
            if (!process.HasExited)
            {
                process.Kill();
                WasTerminated = true;
                if (!process.WaitForExit(3000)) throw new TimeoutException("Retained child did not exit after termination.");
            }
            bool outputDone = outputReader.Join(1000);
            bool errorDone = errorReader.Join(1000);
            ReadersCompleted = outputDone && errorDone;
            closed = true;
        }
        public void Dispose()
        {
            try { Finish(); }
            finally { process.Dispose(); }
        }
    }

}

namespace VmangosAiBotCountR220261007
{
    public sealed class AiConfig
    {
        public string Prefix { get; private set; }
        public string PrefixOrigin { get; private set; }
        public int AccountCount { get; private set; }
        public string AccountCountOrigin { get; private set; }
        private static string Get(string text, string key)
        {
            MatchCollection rows = Regex.Matches(text, @"(?m)^[ \t]*" + Regex.Escape(key) + @"[ \t]*=[ \t]*([^\r\n]*)\r?$");
            if (rows.Count > 1) throw new InvalidOperationException("Duplicate allowed AI configuration key: " + key);
            if (rows.Count == 0) return null;
            string value = rows[0].Groups[1].Value.Split('#')[0].Trim();
            if (value.StartsWith("\"", StringComparison.Ordinal))
            {
                if (value.Length < 2 || !value.EndsWith("\"", StringComparison.Ordinal))
                    throw new InvalidOperationException("Unbalanced quotes in allowed AI configuration key.");
                value = value.Substring(1, value.Length - 2);
            }
            return value;
        }
        public static AiConfig Parse(string text)
        {
            if (text == null || text.Length > 1048576) throw new ArgumentException("AI configuration read cap exceeded.");
            AiConfig result = new AiConfig();
            string prefix = Get(text, "AiPlayerbot.RandomBotAccountPrefix");
            string count = Get(text, "AiPlayerbot.RandomBotAccountCount");
            result.Prefix = prefix ?? "rndbot";
            result.PrefixOrigin = prefix == null ? "PinnedSourceDefault" : "RuntimeConfigFile";
            result.AccountCountOrigin = count == null ? "PinnedSourceDefault" : "RuntimeConfigFile";
            int parsed;
            if (count == null) parsed = 50;
            else if (!Regex.IsMatch(count, @"^[0-9]{1,6}$") || !Int32.TryParse(count, out parsed) || parsed > 100000)
                throw new InvalidOperationException("Unsupported random-bot account count; value suppressed.");
            result.AccountCount = parsed;
            Queries.PrefixMatch(result.Prefix);
            return result;
        }
    }

    public static class Queries
    {
        public const string Hint = "SELECT /*+ MAX_EXECUTION_TIME(3000) */ ";
        public static string PrefixMatch(string prefix)
        {
            if (prefix == null || !Regex.IsMatch(prefix, @"\A[A-Za-z0-9_]{1,16}\z"))
                throw new ArgumentException("AI prefix must be 1..16 ASCII letters, digits or underscore; value suppressed.");
            List<string> conditions = new List<string>();
            for (int index = 0; index < prefix.Length; index++)
            {
                char character = prefix[index];
                string term = "ASCII(SUBSTRING(CAST(COALESCE(a.username,'') AS BINARY)," + (index + 1).ToString(CultureInfo.InvariantCulture) + ",1))";
                if (character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z')
                    term += " IN (" + ((int)Char.ToLowerInvariant(character)).ToString(CultureInfo.InvariantCulture) + "," +
                        ((int)Char.ToUpperInvariant(character)).ToString(CultureInfo.InvariantCulture) + ")";
                else term += "=" + ((int)character).ToString(CultureInfo.InvariantCulture);
                conditions.Add(term);
            }
            return "(" + String.Join(" AND ", conditions.ToArray()) + ")";
        }
        public static string Metadata()
        {
            return Hint + "CONCAT('COLUMN:',TABLE_SCHEMA,'.',TABLE_NAME,'.',COLUMN_NAME),DATA_TYPE FROM information_schema.COLUMNS " +
                "WHERE (TABLE_SCHEMA='characters_dev' AND TABLE_NAME='characters' AND COLUMN_NAME IN ('guid','account','online')) " +
                "OR (TABLE_SCHEMA='realmd_dev' AND TABLE_NAME='account' AND COLUMN_NAME IN ('id','username')) " +
                "UNION ALL SELECT CONCAT('TABLE:',TABLE_SCHEMA,'.',TABLE_NAME),CONCAT(TABLE_TYPE,':',COALESCE(ENGINE,'NULL')) " +
                "FROM information_schema.TABLES WHERE (TABLE_SCHEMA='characters_dev' AND TABLE_NAME='characters') " +
                "OR (TABLE_SCHEMA='realmd_dev' AND TABLE_NAME='account') ORDER BY 1;";
        }
        public static string Inventory(string prefix)
        {
            string match = PrefixMatch(prefix);
            return Hint + "UTC_TIMESTAMP(6),VERSION()," +
                "(SELECT COUNT(*) FROM realmd_dev.account a WHERE " + match + ")," +
                "(SELECT COUNT(*) FROM characters_dev.characters c INNER JOIN realmd_dev.account a ON a.id=c.account WHERE " + match + ");";
        }
        public static string Online(string prefix)
        {
            string match = PrefixMatch(prefix);
            return Hint + "UTC_TIMESTAMP(6),COUNT(*)," +
                "COALESCE(SUM(CASE WHEN a.id IS NOT NULL AND " + match + " THEN 1 ELSE 0 END),0)," +
                "COALESCE(SUM(CASE WHEN a.id IS NOT NULL AND NOT " + match + " THEN 1 ELSE 0 END),0)," +
                "COALESCE(SUM(CASE WHEN a.id IS NULL THEN 1 ELSE 0 END),0)," +
                "COUNT(DISTINCT CASE WHEN a.id IS NOT NULL AND " + match + " THEN c.account ELSE NULL END) " +
                "FROM characters_dev.characters c LEFT JOIN realmd_dev.account a ON a.id=c.account WHERE c.online=1;";
        }
    }

    public sealed class InventoryResult
    {
        public string DatabaseSampleUtc { get; internal set; }
        public string ServerVersion { get; internal set; }
        public ulong PrefixAccountsTotal { get; internal set; }
        public ulong PrefixCharactersTotal { get; internal set; }
    }
    public sealed class OnlineResult
    {
        public string DatabaseSampleUtc { get; internal set; }
        public ulong OnlineCharactersTotal { get; internal set; }
        public ulong OnlineRandomAiCandidates { get; internal set; }
        public ulong OnlineOtherCharacters { get; internal set; }
        public ulong OnlineOrphanCharacters { get; internal set; }
        public ulong OnlineRandomAiAccounts { get; internal set; }
    }
    public static class Results
    {
        private static string[] Lines(string text)
        {
            if (text == null || text.Length > 16384) throw new InvalidOperationException("MySQL output is absent or exceeds its cap.");
            return text.Replace("\r\n", "\n").TrimEnd('\n').Split('\n');
        }
        private static string[] OneRow(string text, int columns)
        {
            string[] lines = Lines(text);
            if (lines.Length != 1) throw new InvalidOperationException("Expected exactly one aggregate SQL row.");
            string[] row = lines[0].Split('\t');
            if (row.Length != columns) throw new InvalidOperationException("Aggregate SQL column count differs.");
            return row;
        }
        private static ulong Number(string value)
        {
            ulong result;
            if (!Regex.IsMatch(value, @"\A[0-9]{1,20}\z") || !UInt64.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out result))
                throw new InvalidOperationException("Aggregate SQL counter is not an unsigned integer.");
            return result;
        }
        private static string Timestamp(string value)
        {
            DateTime parsed;
            if (!DateTime.TryParseExact(value, "yyyy-MM-dd HH:mm:ss.ffffff", CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out parsed))
                throw new InvalidOperationException("SQL UTC sample timestamp differs from the expected format.");
            return parsed.ToString("o", CultureInfo.InvariantCulture);
        }
        public static void Metadata(string text)
        {
            Dictionary<string, string> expected = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (string name in new string[] { "characters_dev.characters.guid", "characters_dev.characters.account",
                "characters_dev.characters.online", "realmd_dev.account.id" }) expected.Add("COLUMN:" + name, "integer");
            expected.Add("COLUMN:realmd_dev.account.username", "text");
            expected.Add("TABLE:characters_dev.characters", "table");
            expected.Add("TABLE:realmd_dev.account", "table");
            string[] rows = Lines(text);
            if (rows.Length != 7) throw new InvalidOperationException("Expected five schema columns and two base-table metadata rows.");
            foreach (string line in rows)
            {
                string[] fields = line.Split('\t');
                string kind;
                if (fields.Length != 2 || !expected.TryGetValue(fields[0], out kind))
                    throw new InvalidOperationException("Unexpected or duplicate schema metadata row.");
                bool valid = kind == "integer" && Regex.IsMatch(fields[1], @"\A(tinyint|smallint|mediumint|int|bigint)\z") ||
                    kind == "text" && Regex.IsMatch(fields[1], @"\A(char|varchar)\z") ||
                    kind == "table" && Regex.IsMatch(fields[1], @"\ABASE TABLE:(InnoDB|MyISAM)\z");
                if (!valid) throw new InvalidOperationException("DEV tables/columns differ from the supported schema; metadata only, values suppressed.");
                expected.Remove(fields[0]);
            }
            if (expected.Count != 0) throw new InvalidOperationException("Schema metadata is incomplete.");
        }
        public static InventoryResult Inventory(string text)
        {
            string[] row = OneRow(text, 4);
            if (!Regex.IsMatch(row[1], @"\A[0-9][A-Za-z0-9._+ -]{0,127}\z"))
                throw new InvalidOperationException("Unexpected MySQL server version format.");
            return new InventoryResult { DatabaseSampleUtc = Timestamp(row[0]), ServerVersion = row[1],
                PrefixAccountsTotal = Number(row[2]), PrefixCharactersTotal = Number(row[3]) };
        }
        public static OnlineResult Online(string text)
        {
            string[] row = OneRow(text, 6);
            OnlineResult result = new OnlineResult { DatabaseSampleUtc = Timestamp(row[0]),
                OnlineCharactersTotal = Number(row[1]), OnlineRandomAiCandidates = Number(row[2]),
                OnlineOtherCharacters = Number(row[3]), OnlineOrphanCharacters = Number(row[4]),
                OnlineRandomAiAccounts = Number(row[5]) };
            ulong combined;
            try { combined = checked(result.OnlineRandomAiCandidates + result.OnlineOtherCharacters + result.OnlineOrphanCharacters); }
            catch (OverflowException) { throw new InvalidOperationException("SQL counter reconciliation overflows."); }
            if (combined != result.OnlineCharactersTotal || result.OnlineRandomAiAccounts > result.OnlineRandomAiCandidates)
                throw new InvalidOperationException("SQL online counters do not reconcile.");
            return result;
        }
    }

    public sealed class MySqlProcessRow
    {
        public int ProcessId { get; set; }
        public int ParentProcessId { get; set; }
        public string Name { get; set; }
        public string ExecutablePath { get; set; }
        public string CreatedUtc { get; set; }
    }
    public static class MySqlOwnership
    {
        private const string ExpectedImage = @"C:\GRY\wow\serwer\mysql-26.7.0-winx64\bin\mysqld.exe";
        private static DateTime Utc(string text)
        {
            DateTime parsed;
            if (!DateTime.TryParseExact(text, "o", CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out parsed) || parsed.Kind != DateTimeKind.Utc)
                throw new InvalidOperationException("MySQL process creation timestamp must be explicit UTC.");
            return parsed;
        }
        private static DateTime CheckImage(MySqlProcessRow row)
        {
            if (!String.Equals(row.Name, "mysqld.exe", StringComparison.OrdinalIgnoreCase) ||
                !String.Equals(row.ExecutablePath, ExpectedImage, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("MySQL service/listener process image differs from the documented exact installation path.");
            return Utc(row.CreatedUtc);
        }
        public static string Validate(int servicePid, string serviceCreatedUtc, int[] listenerPids, MySqlProcessRow[] processes)
        {
            if (servicePid <= 0 || listenerPids == null || listenerPids.Length < 1 || listenerPids.Length > 8 ||
                processes == null || processes.Length < 1 || processes.Length > 9)
                throw new InvalidOperationException("MySQL service/listener/process snapshot is empty or outside the fixed cap.");
            int ownerPid = listenerPids[0];
            foreach (int candidate in listenerPids)
                if (candidate <= 0 || candidate != ownerPid)
                    throw new InvalidOperationException("Port 3306 listeners must have one positive process owner.");
            Dictionary<int, MySqlProcessRow> rows = new Dictionary<int, MySqlProcessRow>();
            foreach (MySqlProcessRow row in processes)
            {
                if (row == null || row.ProcessId <= 0 || rows.ContainsKey(row.ProcessId))
                    throw new InvalidOperationException("MySQL process snapshot has an invalid or duplicate PID.");
                rows.Add(row.ProcessId, row);
            }
            MySqlProcessRow service, owner;
            if (!rows.TryGetValue(servicePid, out service) || !rows.TryGetValue(ownerPid, out owner))
                throw new InvalidOperationException("MySQL service or port-owner process disappeared during observation.");
            DateTime serviceStarted = CheckImage(service);
            if (serviceStarted != Utc(serviceCreatedUtc))
                throw new InvalidOperationException("MySQL service process generation differs from the earlier runtime snapshot.");
            DateTime ownerStarted = CheckImage(owner);
            if (ownerPid == servicePid) return "DirectServiceProcess";
            if (owner.ParentProcessId != servicePid || ownerStarted < serviceStarted)
                throw new InvalidOperationException("Port 3306 owner is not the verified current service process or its documented direct mysqld child.");
            return "VerifiedDirectMysqldChild";
        }
    }

    public static class PrivateFiles
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct SecurityAttributes { public int Length; public IntPtr Descriptor; public int InheritHandle; }
        [DllImport("kernel32.dll", EntryPoint = "CreateDirectoryW", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CreateDirectoryNative(string path, ref SecurityAttributes attributes);
        public static string OptionQuote(string value)
        {
            if (String.IsNullOrEmpty(value) || value.Length > 1024 || value.IndexOf('\0') >= 0 || value.IndexOf('\r') >= 0 || value.IndexOf('\n') >= 0)
                throw new ArgumentException("Unsupported credential value; value suppressed.");
            return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\t", "\\t") + "\"";
        }
        public static string Options(string user, string password)
        {
            return "[client]\r\nhost=127.0.0.1\r\nport=3306\r\nuser=" + OptionQuote(user) +
                "\r\npassword=" + OptionQuote(password) + "\r\n";
        }
        public static void CreatePrivateDirectory(string path)
        {
            DirectorySecurity descriptor = new DirectorySecurity();
            descriptor.SetSecurityDescriptorSddlForm("O:BAG:BAD:P(A;OICI;FA;;;BA)(A;OICI;FA;;;SY)");
            byte[] binary = descriptor.GetSecurityDescriptorBinaryForm();
            IntPtr pointer = Marshal.AllocHGlobal(binary.Length);
            try
            {
                Marshal.Copy(binary, 0, pointer, binary.Length);
                SecurityAttributes attributes = new SecurityAttributes { Length = Marshal.SizeOf(typeof(SecurityAttributes)), Descriptor = pointer };
                if (!CreateDirectoryNative(path, ref attributes))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot exclusively create own private temporary directory.");
            }
            finally { Marshal.FreeHGlobal(pointer); }
        }
        public static void Verify(string path, bool directory)
        {
            if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("Own private temporary object is a reparse point.");
            FileSystemSecurity security = directory ? (FileSystemSecurity)Directory.GetAccessControl(path) : File.GetAccessControl(path);
            if (directory && !security.AreAccessRulesProtected) throw new InvalidOperationException("Own temporary directory DACL is not protected.");
            string owner = security.GetOwner(typeof(SecurityIdentifier)).Value;
            using (WindowsIdentity identity = WindowsIdentity.GetCurrent())
            {
                if (owner != "S-1-5-32-544" && owner != "S-1-5-18" && owner != identity.User.Value)
                    throw new InvalidOperationException("Unexpected owner of own temporary object.");
            }
            AuthorizationRuleCollection rules = security.GetAccessRules(true, true, typeof(SecurityIdentifier));
            bool administrators = false, system = false;
            if (rules.Count != 2) throw new InvalidOperationException("Own temporary DACL must contain only two allow rules.");
            foreach (FileSystemAccessRule rule in rules)
            {
                string sid = rule.IdentityReference.Value;
                if (rule.AccessControlType != AccessControlType.Allow ||
                    (rule.FileSystemRights & FileSystemRights.FullControl) != FileSystemRights.FullControl ||
                    (sid != "S-1-5-32-544" && sid != "S-1-5-18"))
                    throw new InvalidOperationException("Own temporary DACL is not restricted to Administrators and SYSTEM.");
                if (sid == "S-1-5-32-544") administrators = true;
                if (sid == "S-1-5-18") system = true;
            }
            if (!administrators || !system) throw new InvalidOperationException("Own temporary DACL is incomplete.");
        }
        public static void WriteOptions(string path, string user, string password)
        {
            byte[] bytes = new UTF8Encoding(false).GetBytes(Options(user, password));
            try
            {
                using (FileStream stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                    stream.Write(bytes, 0, bytes.Length);
            }
            finally { Array.Clear(bytes, 0, bytes.Length); }
        }
    }
}


namespace VmangosServerInfo20261007
{
    public sealed class HttpSample
    {
        public int Status;
        public string Failure = "";
        public string Body = "";
        public int Bytes;
    }
    public sealed class ServerInfo
    {
        public string CoreRevision;
        public uint ActiveSessions, QueuedSessions, PeakActiveSessions, PeakQueuedSessions;
        public string UptimeDisplay;
    }
    public sealed class NativeBotInfo
    {
        public uint ConfiguredMin, ConfiguredMax, Registered, Loading, Online, Chatting;
        public uint NonNativeBotSessions, TotalWorldSessions;
    }
    public sealed class SoapSample
    {
        public string Command, ObservedAt;
        public int HttpStatus, Bytes;
        public string Failure = "";
        public bool Succeeded;
        public ServerInfo Server;
        public NativeBotInfo NativeBots;
    }
    public static class ReadOnlySoap
    {
        public const string SoapEndpoint = "http://127.0.0.1:7878/";
        public const string SoapNamespace = "urn:MaNGOS";
        public const string EnvelopeNamespace = "http://schemas.xmlsoap.org/soap/envelope/";
        public const int ResponseByteCap = 32768;
        public const int RequestDeadlineMs = 8000;
        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);

        public static string Envelope(string command)
        {
            if (command != "server info" && command != "bot info")
                throw new ArgumentException("Fixed read-only command allowlist.");
            return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
                "<SOAP-ENV:Envelope xmlns:SOAP-ENV=\"" + EnvelopeNamespace +
                "\" xmlns:ns1=\"" + SoapNamespace + "\"><SOAP-ENV:Body>" +
                "<ns1:executeCommand><command>" + command + "</command></ns1:executeCommand>" +
                "</SOAP-ENV:Body></SOAP-ENV:Envelope>";
        }
        private static HttpSample Fetch(HttpWebRequest request, byte[] payload, int deadlineMs)
        {
            HttpSample result = new HttpSample();
            System.Diagnostics.Stopwatch watch = System.Diagnostics.Stopwatch.StartNew();
            request.Proxy = null;
            request.AllowAutoRedirect = false;
            request.Timeout = deadlineMs;
            request.ReadWriteTimeout = 1000;
            request.KeepAlive = false;
            request.AutomaticDecompression = DecompressionMethods.None;
            HttpWebResponse response = null;
            using (Timer deadline = new Timer(delegate(object state) {
                try { ((HttpWebRequest)state).Abort(); } catch { }
            }, request, deadlineMs, Timeout.Infinite))
            {
                try
                {
                    if (payload != null)
                    {
                        request.ContentLength = payload.Length;
                        request.ServicePoint.Expect100Continue = false;
                        using (Stream writer = request.GetRequestStream()) writer.Write(payload, 0, payload.Length);
                    }
                    try { response = (HttpWebResponse)request.GetResponse(); }
                    catch (WebException problem)
                    {
                        response = problem.Response as HttpWebResponse;
                        if (response == null) throw;
                    }
                    result.Status = (int)response.StatusCode;
                    if (result.Status == 401) { result.Failure = "AUTHENTICATION_FAILED"; return result; }
                    if (result.Status == 403) { result.Failure = "AUTHORIZATION_FAILED"; return result; }
                    if (result.Status >= 300 && result.Status < 400) { result.Failure = "REDIRECT_REFUSED"; return result; }
                    if (response.ContentLength > ResponseByteCap) { result.Failure = "RESPONSE_BYTE_CAP"; return result; }
                    using (Stream reader = response.GetResponseStream())
                    using (MemoryStream body = new MemoryStream())
                    {
                        byte[] buffer = new byte[4096];
                        bool eof = false;
                        for (int readNumber = 0; readNumber < 33; readNumber++)
                        {
                            if (watch.ElapsedMilliseconds >= deadlineMs) { result.Failure = "HTTP_TIMEOUT"; return result; }
                            int count = reader.Read(buffer, 0, buffer.Length);
                            if (count == 0) { eof = true; break; }
                            if (body.Length + count > ResponseByteCap) { result.Failure = "RESPONSE_BYTE_CAP"; return result; }
                            body.Write(buffer, 0, count);
                        }
                        if (!eof) { result.Failure = "READ_ITERATION_CAP"; return result; }
                        result.Bytes = (int)body.Length;
                        result.Body = Utf8.GetString(body.ToArray());
                    }
                    if (result.Status != 200) result.Failure = "HTTP_" + result.Status.ToString(CultureInfo.InvariantCulture);
                }
                catch (WebException problem)
                {
                    result.Failure = problem.Status == WebExceptionStatus.Timeout ||
                        problem.Status == WebExceptionStatus.RequestCanceled || watch.ElapsedMilliseconds >= deadlineMs ? "HTTP_TIMEOUT" : "HTTP_TRANSPORT_ERROR";
                }
                catch (DecoderFallbackException) { result.Failure = "INVALID_UTF8"; }
                catch (Exception) { result.Failure = watch.ElapsedMilliseconds >= deadlineMs ? "HTTP_TIMEOUT" : "HTTP_TRANSPORT_ERROR"; }
                finally
                {
                    if (response != null) response.Close();
                    request.Abort();
                }
            }
            return result;
        }
        public static SoapSample Probe(string command, NetworkCredential credential)
        {
            byte[] payload = Utf8.GetBytes(Envelope(command));
            if (credential == null || String.IsNullOrEmpty(credential.UserName) || credential.UserName.Length > 128 ||
                credential.UserName.IndexOf(':') >= 0 || String.IsNullOrEmpty(credential.Password) || credential.Password.Length > 1024)
                throw new ArgumentException("Existing game-account credentials required; never use Windows authentication here.");
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(SoapEndpoint);
            request.Method = "POST";
            request.ContentType = "text/xml; charset=UTF-8";
            request.Headers["SOAPAction"] = SoapNamespace;
            request.Headers["Authorization"] = "Basic " + Convert.ToBase64String(Utf8.GetBytes(credential.UserName + ":" + credential.Password));
            HttpSample transport = Fetch(request, payload, RequestDeadlineMs);
            SoapSample result = new SoapSample { Command = command, ObservedAt = DateTimeOffset.Now.ToString("o"),
                HttpStatus = transport.Status, Bytes = transport.Bytes, Failure = transport.Failure };
            if (result.Failure.Length != 0) return result;
            try
            {
                string text = ExtractResult(transport.Body);
                if (command == "server info") result.Server = ParseServer(text);
                else result.NativeBots = ParseNativeBots(text);
                result.Succeeded = true;
            }
            catch (InvalidOperationException problem) { result.Failure = problem.Message; }
            catch (Exception) { result.Failure = "SOAP_RESPONSE_INVALID"; }
            return result;
        }
        private static XmlDocument LoadXml(string text, int cap)
        {
            if (text == null || text.Length > cap) throw new InvalidOperationException("XML_CHARACTER_CAP");
            XmlReaderSettings settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = cap };
            XmlDocument document = new XmlDocument { XmlResolver = null };
            using (StringReader source = new StringReader(text))
            using (XmlReader reader = XmlReader.Create(source, settings)) document.Load(reader);
            return document;
        }
        public static string ExtractResult(string text)
        {
            XmlDocument document = LoadXml(text, ResponseByteCap);
            XmlNamespaceManager names = new XmlNamespaceManager(document.NameTable);
            names.AddNamespace("s", EnvelopeNamespace); names.AddNamespace("m", SoapNamespace);
            XmlNodeList bodies = document.SelectNodes("/s:Envelope/s:Body", names);
            if (bodies.Count != 1) throw new InvalidOperationException("SOAP_BODY_INVALID");
            if (bodies[0].SelectNodes("s:Fault", names).Count != 0) throw new InvalidOperationException("SOAP_FAULT");
            XmlNodeList wrappers = bodies[0].SelectNodes("m:executeCommandResponse", names);
            if (wrappers.Count != 1) throw new InvalidOperationException("SOAP_WRAPPER_INVALID");
            XmlNodeList results = wrappers[0].SelectNodes("result | m:result", names);
            if (results.Count != 1 || results[0].SelectNodes("*").Count != 0) throw new InvalidOperationException("SOAP_RESULT_INVALID");
            string output = results[0].InnerText;
            if (output.Length == 0 || output.Length > 8192) throw new InvalidOperationException("SOAP_RESULT_LENGTH");
            return output;
        }
        private static string[] Lines(string text, int expected)
        {
            if (text == null || text.Length > 8192) throw new InvalidOperationException("COMMAND_RESPONSE_LENGTH");
            List<string> lines = new List<string>();
            foreach (string line in text.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n'))
                if (line.Trim().Length != 0) lines.Add(line.Trim());
            if (lines.Count != expected) throw new InvalidOperationException("COMMAND_RESPONSE_FORMAT");
            return lines.ToArray();
        }
        private static uint Number(Group group)
        {
            uint value;
            if (!UInt32.TryParse(group.Value, NumberStyles.None, CultureInfo.InvariantCulture, out value))
                throw new InvalidOperationException("COMMAND_NUMBER_INVALID");
            return value;
        }
        private static Match MatchLine(string line, string pattern)
        {
            Match match = Regex.Match(line, pattern, RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100));
            if (!match.Success) throw new InvalidOperationException("COMMAND_RESPONSE_FORMAT");
            return match;
        }
        public static ServerInfo ParseServer(string text)
        {
            string[] lines = Lines(text, 3);
            if (!lines[0].StartsWith("Core revision: ", StringComparison.Ordinal) || lines[0].Length > 512 || lines[2].Length > 256)
                throw new InvalidOperationException("COMMAND_RESPONSE_FORMAT");
            Match count = MatchLine(lines[1], @"^Players online: ([0-9]+) \(([0-9]+) queued\)\. Max online: ([0-9]+) \(([0-9]+) queued\)\.$");
            ServerInfo result = new ServerInfo { CoreRevision = lines[0].Substring(15), ActiveSessions = Number(count.Groups[1]),
                QueuedSessions = Number(count.Groups[2]), PeakActiveSessions = Number(count.Groups[3]), PeakQueuedSessions = Number(count.Groups[4]), UptimeDisplay = lines[2] };
            if (result.CoreRevision.Length == 0 || result.PeakActiveSessions < result.ActiveSessions || result.PeakQueuedSessions < result.QueuedSessions)
                throw new InvalidOperationException("SERVER_COUNTERS_INCONSISTENT");
            return result;
        }
        public static NativeBotInfo ParseNativeBots(string text)
        {
            string[] lines = Lines(text, 4);
            if (lines[0] != "-- PlayerBot stats --") throw new InvalidOperationException("COMMAND_RESPONSE_FORMAT");
            Match config = MatchLine(lines[1], @"^Min:([0-9]+) Max:([0-9]+) Total:([0-9]+)$");
            Match online = MatchLine(lines[2], @"^Loading : ([0-9]+), Online : ([0-9]+), Chat : ([0-9]+)$");
            Match split = MatchLine(lines[3], @"^([0-9]+)p \+ ([0-9]+)b = ([0-9]+)$");
            NativeBotInfo result = new NativeBotInfo { ConfiguredMin = Number(config.Groups[1]), ConfiguredMax = Number(config.Groups[2]),
                Registered = Number(config.Groups[3]), Loading = Number(online.Groups[1]), Online = Number(online.Groups[2]), Chatting = Number(online.Groups[3]),
                NonNativeBotSessions = Number(split.Groups[1]), TotalWorldSessions = Number(split.Groups[3]) };
            if (Number(split.Groups[2]) != result.Online || (ulong)result.NonNativeBotSessions + result.Online != result.TotalWorldSessions)
                throw new InvalidOperationException("NATIVE_BOT_COUNTERS_INCONSISTENT");
            return result;
        }
    }
}

namespace VmangosTelemetryA71
{
    public static class AtomicSnapshot
    {
        public static void Write(string path, string json)
        { VmangosPackageA73.Boundary.AtomicWrite(path, json, true); }
    }
}

namespace VmangosPackageA73
{
    // No ACL changes to existing objects. New objects get their DACL at creation.
    public static class Boundary
    {
        public const string PoolSid = "S-1-5-82-2192834305-681035450-1731772730-1791053079-2169464979";
        public const string SnapshotPath = @"C:\ProgramData\VMANGOS\AdminPanelTelemetry\snapshot.json";
        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
        private static readonly byte[] Entropy = Utf8.GetBytes("VMANGOS-WOW-SRV-AdminPanel-SOAP-v1");
        [StructLayout(LayoutKind.Sequential)]
        private struct SecurityAttributes { public int Length; public IntPtr Descriptor; public int Inherit; }
        [DllImport("kernel32.dll", EntryPoint="CreateDirectoryW", CharSet=CharSet.Unicode, SetLastError=true)]
        private static extern bool MakeDirectory(string path, ref SecurityAttributes security);
        [DllImport("kernel32.dll", EntryPoint="CreateFileW", CharSet=CharSet.Unicode, SetLastError=true)]
        private static extern SafeFileHandle MakeFile(string path, uint access, uint share,
            ref SecurityAttributes security, uint disposition, uint attributes, IntPtr template);

        private static string Sddl(bool reader, bool directory)
        {
            string flags = directory ? "OICI" : "";
            return "D:P(A;" + flags + ";FA;;;SY)(A;" + flags + ";FA;;;BA)" +
                (reader ? "(A;" + flags + ";0x1200a9;;;" + PoolSid + ")" : "");
        }
        private static SecurityAttributes Attributes(string sddl, out GCHandle pinned)
        {
            byte[] bytes = new RawSecurityDescriptor(sddl).GetBinaryFormBytes();
            pinned = GCHandle.Alloc(bytes, GCHandleType.Pinned);
            return new SecurityAttributes { Length=Marshal.SizeOf(typeof(SecurityAttributes)), Descriptor=pinned.AddrOfPinnedObject() };
        }
        public static void Canonical(string path)
        {
            if (String.IsNullOrEmpty(path) || path.Length > 230 || path.StartsWith(@"\\", StringComparison.Ordinal) ||
                path.IndexOf(':', 2) >= 0 || !Path.IsPathRooted(path) || Path.GetFullPath(path) != path)
                throw new InvalidOperationException("LOCAL_CANONICAL_PATH_REQUIRED");
            string current = path;
            for (int level=0; level<32 && !String.IsNullOrEmpty(current); level++)
            {
                if ((File.Exists(current) || Directory.Exists(current)) &&
                    (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                    throw new InvalidOperationException("REPARSE_PATH_REFUSED");
                current = Path.GetDirectoryName(current);
            }
        }
        public static bool SafeSnapshotName(string path)
        { return String.Equals(path, SnapshotPath, StringComparison.Ordinal); }
        public static void CreateDirectory(string path, bool reader)
        {
            Canonical(path);
            if (!Directory.Exists(Path.GetDirectoryName(path))) throw new InvalidOperationException("PARENT_MISSING");
            GCHandle pinned;
            SecurityAttributes security = Attributes(Sddl(reader, true), out pinned);
            try
            {
                if (!MakeDirectory(path, ref security)) throw new Win32Exception(Marshal.GetLastWin32Error(), "EXCLUSIVE_DIRECTORY_CREATE_FAILED");
            }
            finally { pinned.Free(); }
            Verify(path, true, reader);
        }
        public static void Verify(string path, bool directory, bool reader)
        {
            Canonical(path);
            FileSystemSecurity security = directory ? (FileSystemSecurity)Directory.GetAccessControl(path) : File.GetAccessControl(path);
            if (!security.AreAccessRulesProtected) throw new InvalidOperationException("PROTECTED_DACL_REQUIRED");
            string owner = security.GetOwner(typeof(SecurityIdentifier)).Value;
            if (owner != "S-1-5-32-544" && owner != "S-1-5-18") throw new InvalidOperationException("TRUSTED_OWNER_REQUIRED");
            AuthorizationRuleCollection rules = security.GetAccessRules(true, true, typeof(SecurityIdentifier));
            if (rules.Count != (reader ? 3 : 2)) throw new InvalidOperationException("DACL_CARDINALITY");
            bool system=false, admin=false, pool=false;
            foreach (FileSystemAccessRule rule in rules)
            {
                string sid = rule.IdentityReference.Value;
                if (rule.AccessControlType != AccessControlType.Allow || rule.IsInherited || rule.PropagationFlags != PropagationFlags.None ||
                    rule.InheritanceFlags != (directory ? InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit : InheritanceFlags.None))
                    throw new InvalidOperationException("EXPLICIT_DACL_PROFILE_REQUIRED");
                if (sid == "S-1-5-18" && !system && rule.FileSystemRights == FileSystemRights.FullControl) system=true;
                else if (sid == "S-1-5-32-544" && !admin && rule.FileSystemRights == FileSystemRights.FullControl) admin=true;
                else if (reader && sid == PoolSid && !pool && (long)rule.FileSystemRights == 0x1200a9) pool=true;
                else throw new InvalidOperationException("DACL_RULE_REFUSED");
            }
            if (!system || !admin || pool != reader) throw new InvalidOperationException("DACL_INCOMPLETE");
        }
        public static void NewFile(string path, byte[] bytes, bool reader)
        {
            Canonical(path);
            if (bytes == null || bytes.Length > 1048576) throw new InvalidOperationException("OWN_FILE_CAP");
            Verify(Path.GetDirectoryName(path), true, reader);
            GCHandle pinned;
            SecurityAttributes security = Attributes(Sddl(reader, false), out pinned);
            try
            {
                using (SafeFileHandle handle = MakeFile(path, 0x40000000, 0, ref security, 1, 0x80, IntPtr.Zero))
                {
                    if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error(), "EXCLUSIVE_FILE_CREATE_FAILED");
                    using (FileStream stream = new FileStream(handle, FileAccess.Write))
                    { stream.Write(bytes, 0, bytes.Length); stream.Flush(true); }
                }
            }
            finally { pinned.Free(); }
            Verify(path, false, reader);
        }
        public static void AtomicWrite(string path, string json, bool reader)
        {
            Canonical(path);
            byte[] bytes = Utf8.GetBytes(json);
            if (bytes.Length == 0 || bytes.Length > (reader ? 32768 : 8192)) throw new InvalidOperationException("JSON_BYTE_CAP");
            Verify(Path.GetDirectoryName(path), true, reader);
            if (File.Exists(path)) Verify(path, false, reader);
            string temporary = Path.Combine(Path.GetDirectoryName(path), "write-" + Guid.NewGuid().ToString("N") + ".tmp");
            try
            {
                NewFile(temporary, bytes, reader);
                if (File.Exists(path)) File.Replace(temporary, path, null);
                else File.Move(temporary, path);
                Verify(path, false, reader);
            }
            finally
            {
                Array.Clear(bytes, 0, bytes.Length);
                if (File.Exists(temporary)) { Verify(temporary, false, reader); File.Delete(temporary); }
            }
        }
        // LocalMachine is transferable between admin provisioning and SYSTEM.
        // Its isolation depends on the strict SYSTEM+Administrators DACL, not DPAPI alone.
        public static byte[] Protect(string text)
        {
            byte[] bytes = Utf8.GetBytes(text);
            if (bytes.Length == 0 || bytes.Length > 4096) throw new InvalidOperationException("CREDENTIAL_BYTE_CAP");
            try { return ProtectedData.Protect(bytes, Entropy, DataProtectionScope.LocalMachine); }
            finally { Array.Clear(bytes, 0, bytes.Length); }
        }
        public static string Unprotect(string path)
        {
            Verify(Path.GetDirectoryName(path), true, false); Verify(path, false, false);
            if (new FileInfo(path).Length == 0 || new FileInfo(path).Length > 16384) throw new InvalidOperationException("PROTECTED_BLOB_CAP");
            byte[] cipher=File.ReadAllBytes(path), plain=null;
            try
            {
                plain=ProtectedData.Unprotect(cipher, Entropy, DataProtectionScope.LocalMachine);
                if (plain.Length == 0 || plain.Length > 4096) throw new InvalidOperationException("CREDENTIAL_BYTE_CAP");
                return Utf8.GetString(plain);
            }
            finally { Array.Clear(cipher, 0, cipher.Length); if (plain != null) Array.Clear(plain, 0, plain.Length); }
        }
        public static void PinnedHash(string path, string expected)
        {
            Canonical(path);
            if (new FileInfo(path).Length > 67108864) throw new InvalidOperationException("PINNED_FILE_CAP");
            using (SHA256 sha=SHA256.Create())
            using (FileStream stream=new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
                if (BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "") != expected)
                    throw new InvalidOperationException("PINNED_RUNTIME_HASH_CHANGED");
        }
    }
    internal static class DescriptorBytes
    {
        internal static byte[] GetBinaryFormBytes(this RawSecurityDescriptor descriptor)
        { byte[] bytes=new byte[descriptor.BinaryLength]; descriptor.GetBinaryForm(bytes, 0); return bytes; }
    }
}