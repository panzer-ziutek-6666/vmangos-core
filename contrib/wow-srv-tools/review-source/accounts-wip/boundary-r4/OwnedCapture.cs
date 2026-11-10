using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Threading;
using System.Collections.Generic;
using System.Xml;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Security.AccessControl;
using Microsoft.Win32.SafeHandles;


namespace VmangosA147
{
    // A job contains only this stage's compiler/test child and its descendants.
    internal sealed class OwnedJob : IDisposable
    {
        [StructLayout(LayoutKind.Sequential)] private struct Limits
        {
            internal long ProcessTime, JobTime;
            internal uint Flags;
            internal UIntPtr MinimumWorkingSet, MaximumWorkingSet;
            internal uint ActiveLimit;
            internal UIntPtr Affinity;
            internal uint Priority, Scheduling;
        }
        [StructLayout(LayoutKind.Sequential)] private struct Io
        { internal ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes; }
        [StructLayout(LayoutKind.Sequential)] private struct Extended
        { internal Limits Basic; internal Io Counters; internal UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory; }
        [StructLayout(LayoutKind.Sequential)] private struct Accounting
        { internal long User, Kernel, PeriodUser, PeriodKernel; internal uint Faults, Total, Active, Terminated; }
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
        private static extern IntPtr CreateJobObjectW(IntPtr security, string name);
        [DllImport("kernel32.dll", SetLastError=true)]
        private static extern bool SetInformationJobObject(IntPtr job, int info, IntPtr data, uint length);
        [DllImport("kernel32.dll", SetLastError=true)]
        private static extern bool QueryInformationJobObject(IntPtr job, int info, out Accounting data, uint length, IntPtr returned);
        [DllImport("kernel32.dll", SetLastError=true)]
        private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll", SetLastError=true)]
        private static extern bool TerminateJobObject(IntPtr job, uint code);
        [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
        private IntPtr handle;
        internal OwnedJob()
        {
            handle=CreateJobObjectW(IntPtr.Zero,null);
            if (handle==IntPtr.Zero) throw new InvalidOperationException("A147_JOB_CREATE_FAILED");
            IntPtr memory=IntPtr.Zero;
            try
            {
                Extended data=new Extended(); data.Basic.Flags=0x2008; data.Basic.ActiveLimit=32;
                int size=Marshal.SizeOf(typeof(Extended)); memory=Marshal.AllocHGlobal(size);
                Marshal.StructureToPtr(data,memory,false);
                if (!SetInformationJobObject(handle,9,memory,(uint)size))
                    throw new InvalidOperationException("A147_JOB_LIMIT_FAILED");
            }
            catch { CloseHandle(handle);handle=IntPtr.Zero;throw; }
            finally { if(memory!=IntPtr.Zero) Marshal.FreeHGlobal(memory); }
        }
        internal void Assign(IntPtr process)
        { if(!AssignProcessToJobObject(handle,process)) throw new InvalidOperationException("A147_JOB_ASSIGN_FAILED"); }
        internal uint Active()
        {
            Accounting data;
            if(!QueryInformationJobObject(handle,1,out data,(uint)Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero))
                throw new InvalidOperationException("A147_JOB_QUERY_FAILED");
            return data.Active;
        }
        internal JobSnapshot Snapshot(string phase) { return JobObserver.Capture(handle,phase,Active()); }
        internal void Terminate()
        { if(!TerminateJobObject(handle,131)) throw new InvalidOperationException("A147_OWN_JOB_CLEANUP_FAILED"); }
        public void Dispose()
        { if(handle!=IntPtr.Zero) { if(!CloseHandle(handle)) throw new InvalidOperationException("A147_JOB_CLOSE_FAILED");handle=IntPtr.Zero; } }
    }

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
                        int take = Math.Min(count, 262144 - text.Length);
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

    public sealed class DrainReport
    {
        public uint Initial, Final;
        public int Polls;
        public bool Empty;
    }
    public static class JobDrain
    {
        // Closing the root process handle MUST precede the first accounting query.
        // The query can still include terminated processes held by other references.
        public static DrainReport AfterRelease(Action releaseRoot, Func<uint> active, Action<int> delay, int maxPolls)
        {
            if (releaseRoot == null || active == null || delay == null || maxPolls < 0 || maxPolls > 120)
                throw new InvalidOperationException("A147_DRAIN_ARGUMENTS");
            releaseRoot();
            DrainReport result = new DrainReport();
            result.Initial = result.Final = active();
            while (result.Final != 0 && result.Polls < maxPolls)
            {
                delay(25);
                result.Polls++;
                result.Final = active();
            }
            result.Empty = result.Final == 0;
            return result;
        }
    }
    public sealed class Child : IDisposable
    {
        private readonly Process process;
        private readonly Capture stdout = new Capture();
        private readonly Capture stderr = new Capture();
        private readonly Thread outputReader;
        private readonly Thread errorReader;
        private readonly StreamReader outputPipe;
        private readonly StreamReader errorPipe;
        private readonly int processId;
        private bool closed, exitCaptured, assignedToJob;
        private int cachedExitCode;
        private OwnedJob ownedJob;
        private readonly TelemetryCleanupLease telemetry;
        private readonly DateTime startedUtc=DateTime.UtcNow;
        public bool VerifiedTelemetryCleanup { get; private set; }
        public int TelemetryCleanupMembers { get; private set; }
        private readonly System.Collections.Generic.List<JobSnapshot> snapshots=new System.Collections.Generic.List<JobSnapshot>();
        public JobSnapshot[] JobSnapshots { get { return snapshots.ToArray(); } }
        public Child(string file, string arguments, string directory, string[] environment)
            : this(file,arguments,directory,environment,false) { }
        public Child(string file, string arguments, string directory, string[] environment, bool isolated)
            : this(file,arguments,directory,environment,isolated,null) { }
        public Child(string file, string arguments, string directory, string[] environment, bool isolated,TelemetryCleanupLease telemetry)
        {
            if(telemetry != null && (!isolated || !string.Equals(file,@"C:\Program Files\CMake\bin\cmake.exe",StringComparison.OrdinalIgnoreCase)))
                throw new InvalidOperationException("A147_TELEMETRY_POLICY_ONLY_CMAKE");
            this.telemetry=telemetry;
            ProcessStartInfo info = new ProcessStartInfo(file, arguments);
            info.WorkingDirectory = directory;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            if (isolated)
            {
                info.EnvironmentVariables.Clear();
                foreach (string key in new string[] { "SystemRoot", "WINDIR", "SystemDrive", "COMSPEC", "OS", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "COMPUTERNAME" })
                {
                    string value = Environment.GetEnvironmentVariable(key);
                    if (value != null) info.EnvironmentVariables[key] = value;
                }
            }
            foreach (string name in new string[] { "DOTNET_STARTUP_HOOKS", "DOTNET_ADDITIONAL_DEPS", "DOTNET_SHARED_STORE", "MYSQL_PWD", "MYSQL_TEST_LOGIN_FILE", "MYSQL_GROUP_SUFFIX" })
                info.EnvironmentVariables.Remove(name);
            foreach (string entry in environment)
            {
                int split = entry.IndexOf('=');
                if (split <= 0) throw new ArgumentException("A147_CHILD_ENVIRONMENT_PAIR");
                info.EnvironmentVariables[entry.Substring(0, split)] = entry.Substring(split + 1);
            }
            process = new Process();
            process.StartInfo = info;
            if (isolated) ownedJob = new OwnedJob();
            TerminationReason = "none";
            try
            {
                if (!process.Start()) throw new InvalidOperationException("A147_CHILD_START_FAILED");
                processId = process.Id;
                if (ownedJob != null) { ownedJob.Assign(process.Handle); assignedToJob = true; }
                // Keep explicit reader references so Process.Close cannot invalidate capture.
                outputPipe = process.StandardOutput;
                errorPipe = process.StandardError;
            }
            catch
            {
                try { if (!process.HasExited) { if (ownedJob != null && assignedToJob) ownedJob.Terminate(); else process.Kill(); process.WaitForExit(3000); } } catch { }
                process.Dispose();
                if (outputPipe != null) outputPipe.Dispose();
                if (errorPipe != null) errorPipe.Dispose();
                if (ownedJob != null) ownedJob.Dispose();
                throw;
            }
            outputReader = new Thread(() => stdout.Read(outputPipe));
            errorReader = new Thread(() => stderr.Read(errorPipe));
            outputReader.IsBackground = true;
            errorReader.IsBackground = true;
            try { outputReader.Start(); errorReader.Start(); }
            catch
            {
                try { if (ownedJob != null) ownedJob.Terminate(); else process.Kill(); process.WaitForExit(3000); }
                finally { process.Dispose(); outputPipe.Dispose(); errorPipe.Dispose(); if (ownedJob != null) ownedJob.Dispose(); }
                throw;
            }
        }
        public int Id { get { return processId; } }
        public bool HasExited { get { return ProcessHandleReleased ? exitCaptured : process.HasExited; } }
        public int ExitCode
        {
            get
            {
                if (!ProcessHandleReleased) return process.ExitCode;
                if (!exitCaptured) throw new InvalidOperationException("A147_EXIT_CODE_NOT_CAPTURED");
                return cachedExitCode;
            }
        }
        public bool Wait(int milliseconds) { return ProcessHandleReleased ? exitCaptured : process.WaitForExit(milliseconds); }
        public bool OutputLimitExceeded { get { return stdout.Seen > 262144 || stderr.Seen > 262144; } }
        public string StandardOutput { get { return stdout.Text; } }
        public string StandardError { get { return stderr.Text; } }
        public string ReaderFailure { get { return stdout.Failure ?? stderr.Failure; } }
        public long OutputCharacters { get { return stdout.Seen; } }
        public long ErrorCharacters { get { return stderr.Seen; } }
        public bool WasTerminated { get; private set; }
        public string TerminationReason { get; private set; }
        public bool NaturalExitBeforeCleanup { get; private set; }
        public bool ProcessHandleReleased { get; private set; }
        public bool ReadersCompleted { get; private set; }
        public bool JobQuiescent { get; private set; }
        public uint JobInitialActive { get; private set; }
        public uint JobFinalActive { get; private set; }
        public int JobGracePolls { get; private set; }
        private void ReleaseProcessHandle()
        {
            if (!ProcessHandleReleased)
            {
                // Exit code and PID were cached before Close clears Process properties.
                process.Close();
                ProcessHandleReleased = true;
            }
        }
        public void Finish()
        {
            if (closed) return;
            closed = true;
            try
            {
                NaturalExitBeforeCleanup = process.HasExited;
                if (!NaturalExitBeforeCleanup)
                {
                    WasTerminated = true;
                    TerminationReason = "root_not_exited";
                    if (ownedJob != null) ownedJob.Terminate(); else process.Kill();
                    if (!process.WaitForExit(3000)) throw new InvalidOperationException("A147_OWN_ROOT_DID_NOT_EXIT");
                }
                cachedExitCode = process.ExitCode;
                exitCaptured = true;
                if (ownedJob == null)
                {
                    ReleaseProcessHandle();
                    JobQuiescent = true;
                }
                else
                {
                    snapshots.Add(ownedJob.Snapshot("ROOT_EXIT_BEFORE_RELEASE"));
                    DrainReport report = JobDrain.AfterRelease(ReleaseProcessHandle,ownedJob.Active,Thread.Sleep,80);
                    JobInitialActive = report.Initial;
                    JobFinalActive = report.Final;
                    JobGracePolls = report.Polls;
                    JobQuiescent = report.Empty;
                    if (!report.Empty)
                    {
                        JobSnapshot surviving=ownedJob.Snapshot("AFTER_GRACE_BEFORE_OWNED_TERMINATION");
                        snapshots.Add(surviving);
                        // All query handles have been closed. Recheck so an
                        // asynchronously drained Job is never terminated.
                        JobFinalActive=ownedJob.Active();JobQuiescent=JobFinalActive == 0;
                        if(!JobQuiescent)
                        {
                            bool reviewed=telemetry != null && telemetry.Eligible(surviving,NaturalExitBeforeCleanup,cachedExitCode,processId,JobFinalActive,startedUtc);
                            TelemetryCleanupMembers=reviewed ? surviving.Members.Length : 0;
                            WasTerminated = true;
                            TerminationReason = reviewed ? "verified_owned_vctip_after_successful_root" : "job_nonzero_after_release_and_grace";
                            ownedJob.Terminate();
                            DrainReport cleanup = JobDrain.AfterRelease(ReleaseProcessHandle,ownedJob.Active,Thread.Sleep,80);
                            JobFinalActive = cleanup.Final;
                            JobQuiescent = cleanup.Empty;
                        }
                    }
                }
                bool outputDone = outputReader.Join(1000);
                bool errorDone = errorReader.Join(1000);
                ReadersCompleted = outputDone && errorDone;
                VerifiedTelemetryCleanup=WasTerminated && TerminationReason == "verified_owned_vctip_after_successful_root" &&
                    NaturalExitBeforeCleanup && cachedExitCode == 0 && ProcessHandleReleased && JobQuiescent &&
                    ReadersCompleted && ReaderFailure == null && !OutputLimitExceeded;
                if (!JobQuiescent) throw new InvalidOperationException("A147_OWN_JOB_ACCOUNTING_NOT_QUIESCENT");
            }
            finally { ReleaseProcessHandle(); }
        }
        public void Dispose()
        {
            try { Finish(); }
            finally
            {
                try { process.Dispose(); }
                finally
                {
                    try { outputPipe.Dispose(); errorPipe.Dispose(); }
                    finally { if (ownedJob != null) ownedJob.Dispose(); }
                }
            }
        }
    }
}


namespace VmangosA147
{
    public sealed class CandidateFile
    {
        public string RelativePath;
        public byte[] Bytes;
    }
    public static class Package
    {
        public static string Hash(byte[] bytes)
        {
            using (SHA256 hash = SHA256.Create())
                return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "");
        }
        public static void Name(string name)
        {
            if (String.IsNullOrEmpty(name) || name.Length > 192 || name.IndexOf('\\') >= 0 ||
                name.IndexOf(':') >= 0 || name.StartsWith("/", StringComparison.Ordinal))
                throw new InvalidOperationException("A147_ARCHIVE_NAME_REFUSED");
            foreach (string part in name.Split('/'))
            {
                if (part.Length == 0 || part == "." || part == ".." || part.EndsWith(".", StringComparison.Ordinal))
                    throw new InvalidOperationException("A147_ARCHIVE_NAME_REFUSED");
                string stem = part.Split('.')[0].ToUpperInvariant();
                if (stem == "CON" || stem == "PRN" || stem == "AUX" || stem == "NUL" ||
                    (stem.Length == 4 && (stem.StartsWith("COM", StringComparison.Ordinal) || stem.StartsWith("LPT", StringComparison.Ordinal)) &&
                     stem[3] >= '0' && stem[3] <= '9'))
                    throw new InvalidOperationException("A147_ARCHIVE_DEVICE_NAME");
                foreach (char c in part)
                    if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                          (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.'))
                        throw new InvalidOperationException("A147_ARCHIVE_NAME_REFUSED");
            }
        }
        public static CandidateFile[] Load(byte[] zipped, string[] names, int[] lengths, string[] hashes)
        {
            if (zipped == null || zipped.Length > 2097152 || names.Length < 1 || names.Length > 128 ||
                names.Length != lengths.Length || names.Length != hashes.Length)
                throw new InvalidOperationException("A147_ARCHIVE_LIMIT");
            Dictionary<string,int> expected = new Dictionary<string,int>(StringComparer.OrdinalIgnoreCase);
            long total = 0;
            for (int i=0; i<names.Length; i++)
            {
                Name(names[i]);
                if (expected.ContainsKey(names[i])) throw new InvalidOperationException("A147_MANIFEST_DUPLICATE");
                expected.Add(names[i],i);
                if (lengths[i] < 0 || lengths[i] > 262144 || hashes[i] == null || hashes[i].Length != 64)
                    throw new InvalidOperationException("A147_MANIFEST_PROFILE");
                total += lengths[i];
            }
            if (total > 2097152) throw new InvalidOperationException("A147_EXPANDED_CAP");
            List<CandidateFile> loaded = new List<CandidateFile>();
            try
            {
                using (MemoryStream memory = new MemoryStream(zipped,false))
                using (ZipArchive archive = new ZipArchive(memory,ZipArchiveMode.Read,false))
                {
                    if (archive.Entries.Count != names.Length) throw new InvalidOperationException("A147_ENTRY_COUNT");
                    HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        Name(entry.FullName);
                        int index;
                        if (!seen.Add(entry.FullName) || !expected.TryGetValue(entry.FullName,out index) ||
                            entry.FullName != names[index] || entry.Length != lengths[index] ||
                            ((entry.ExternalAttributes >> 16) & 0xF000) == 0xA000)
                            throw new InvalidOperationException("A147_UNEXPECTED_ZIP_ENTRY");
                        byte[] bytes = new byte[lengths[index]];
                        loaded.Add(new CandidateFile { RelativePath=entry.FullName, Bytes=bytes });
                        using (Stream input = entry.Open())
                        {
                            int offset=0;
                            while (offset < bytes.Length)
                            {
                                int read=input.Read(bytes,offset,bytes.Length-offset);
                                if (read == 0) throw new InvalidOperationException("A147_ZIP_TRUNCATED");
                                offset+=read;
                            }
                            if (input.ReadByte() != -1) throw new InvalidOperationException("A147_ZIP_BODY_CAP");
                        }
                        if (Hash(bytes) != hashes[index]) throw new InvalidOperationException("A147_ZIP_HASH_MISMATCH");
                    }
                }
                return loaded.ToArray();
            }
            catch
            {
                foreach (CandidateFile file in loaded) Array.Clear(file.Bytes,0,file.Bytes.Length);
                throw;
            }
        }
    }
    public static class PrivateIo
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct SecurityAttributes { public int Length; public IntPtr Descriptor; public int Inherit; }
        [DllImport("kernel32.dll", EntryPoint="CreateDirectoryW", CharSet=CharSet.Unicode, SetLastError=true)]
        private static extern bool MakeDirectory(string path, ref SecurityAttributes security);
        [DllImport("kernel32.dll", EntryPoint="CreateFileW", CharSet=CharSet.Unicode, SetLastError=true)]
        private static extern SafeFileHandle MakeFile(string path, uint access, uint share,
            ref SecurityAttributes security, uint disposition, uint attributes, IntPtr template);
        private static SecurityAttributes Attributes(byte[] descriptor, out GCHandle pinned)
        {
            if (descriptor == null || descriptor.Length < 20 || descriptor.Length > 4096)
                throw new InvalidOperationException("A147_SECURITY_DESCRIPTOR_PROFILE");
            pinned = GCHandle.Alloc(descriptor, GCHandleType.Pinned);
            return new SecurityAttributes { Length=Marshal.SizeOf(typeof(SecurityAttributes)),
                Descriptor=pinned.AddrOfPinnedObject(), Inherit=0 };
        }
        public static void Directory(string path, byte[] descriptor)
        {
            GCHandle pinned;
            SecurityAttributes security = Attributes(descriptor, out pinned);
            try
            {
                if (!MakeDirectory(path, ref security))
                    throw new InvalidOperationException("A147_EXCLUSIVE_DIRECTORY_CREATE_FAILED");
            }
            finally { pinned.Free(); }
        }
        public static FileStream NewFile(string path, byte[] descriptor)
        {
            GCHandle pinned;
            SecurityAttributes security = Attributes(descriptor, out pinned);
            try
            {
                SafeFileHandle handle = MakeFile(path, 0x40000000, 1, ref security, 1, 0x80000080, IntPtr.Zero);
                if (handle.IsInvalid) { handle.Dispose(); throw new InvalidOperationException("A147_EXCLUSIVE_FILE_CREATE_FAILED"); }
                try { return new FileStream(handle, FileAccess.Write, 4096, false); }
                catch { handle.Dispose(); throw; }
            }
            finally { pinned.Free(); }
        }
    }
}
namespace VmangosA147
{
    public sealed class PeReport
    {
        public string Machine = "AMD64", Format = "PE32+", Subsystem = "CONSOLE";
        public bool ClrAbsent, DelayImportsAbsent, DynamicBase, NxCompatible, HighEntropyVa, ControlFlowGuard;
        public uint GuardFlags;
        public ulong GuardFunctionCount;
        public string[] Imports;
    }
    // Bounded byte parser. Never calls LoadLibrary, Reflection.Load or an image entrypoint.
    public sealed class PeReader
    {
        private readonly byte[] bytes;
        private readonly List<Section> sections = new List<Section>();
        private uint imageSize, headerSize;
        private ulong imageBase;
        private sealed class Section { internal uint Va, Virtual, Raw, RawSize, Flags; }
        private PeReader(byte[] value) { bytes=value; }
        private static void Need(bool value, string code) { if(!value) throw new InvalidOperationException("A147_PE_"+code); }
        private int Offset(ulong offset, ulong size)
        { Need(offset <= (ulong)bytes.Length && size <= (ulong)bytes.Length-offset,"FILE_RANGE");return checked((int)offset); }
        private ushort U16(ulong at) { return BitConverter.ToUInt16(bytes,Offset(at,2)); }
        private uint U32(ulong at) { return BitConverter.ToUInt32(bytes,Offset(at,4)); }
        private ulong U64(ulong at) { return BitConverter.ToUInt64(bytes,Offset(at,8)); }
        private int Map(uint rva, ulong count)
        {
            Need(count>0 && (ulong)rva+count<=imageSize,"IMAGE_RANGE");
            if(rva<headerSize) { Need((ulong)rva+count<=headerSize,"HEADER_RANGE");return Offset(rva,count); }
            Section match=null;
            foreach(Section s in sections)
            {
                if(rva>=s.Va && (ulong)rva-s.Va<s.RawSize)
                { Need(match==null,"AMBIGUOUS_RVA");match=s; }
            }
            Need(match!=null && (ulong)rva-match.Va+count<=match.RawSize,"RVA_NOT_FILE_BACKED");
            return Offset((ulong)match.Raw+rva-match.Va,count);
        }
        private uint VaToRva(ulong va)
        { Need(va>=imageBase && va-imageBase<imageSize,"VA_RANGE");return checked((uint)(va-imageBase)); }
        private void Executable(uint rva)
        {
            Map(rva,1);bool found=false;
            foreach(Section s in sections) if(rva>=s.Va && (ulong)rva-s.Va<Math.Max(s.Virtual,s.RawSize))
            { Need((s.Flags&0x20000000U)!=0 && (s.Flags&0x80000000U)==0,"EXECUTABLE_SECTION");found=true; }
            Need(found,"EXECUTABLE_TARGET");
        }
        private string Ascii(uint rva,int cap)
        {
            StringBuilder result=new StringBuilder();
            for(int i=0;i<cap;i++)
            {
                Need((ulong)rva+(uint)i<=UInt32.MaxValue,"STRING_OVERFLOW");byte b=bytes[Map(rva+(uint)i,1)];
                if(b==0){Need(result.Length>0,"EMPTY_STRING");return result.ToString();}
                Need(b>=33 && b<=126,"STRING_ASCII");result.Append((char)b);
            }
            throw new InvalidOperationException("A147_PE_STRING_LIMIT");
        }
        private uint Directory(uint optional,int index,out uint size)
        { uint rva=U32(optional+112U+(uint)index*8U);size=U32(optional+116U+(uint)index*8U);return rva; }
        private PeReport Parse(bool bootstrap)
        {
            Need(bytes!=null && bytes.Length>=512 && bytes.Length<=16777216,"FILE_SIZE");
            Need(U16(0)==0x5A4D,"DOS_SIGNATURE");uint pe=U32(0x3C);Need(pe>=64 && pe<=1048576,"PE_OFFSET");
            Need(U32(pe)==0x4550 && U16(pe+4)==0x8664,"PE_SIGNATURE_OR_MACHINE");
            uint count=U16(pe+6),optionalSize=U16(pe+20),flags=U16(pe+22),optional=pe+24;
            Need(count>=1 && count<=32 && optionalSize>=240 && optionalSize<=4096,"HEADER_COUNTS");
            Need((flags&0x2023U)==0x22U,"EXE_CHARACTERISTICS");Offset(optional,optionalSize);
            Need(U16(optional)==0x20B && U32(optional+108)==16,"OPTIONAL_FORMAT");
            imageBase=U64(optional+24);imageSize=U32(optional+56);headerSize=U32(optional+60);
            Need(imageBase>0 && imageBase<=UInt64.MaxValue-imageSize && imageSize>=4096 && imageSize<=268435456 && headerSize>=512 && headerSize<=bytes.Length,"IMAGE_LAYOUT");
            Need(U16(optional+68)==3,"SUBSYSTEM");uint dll=U16(optional+70);
            Need((dll&0x4160U)==0x4160U,"ASLR_DEP_CFG_FLAGS");
            uint sectionTable=optional+optionalSize;Offset(sectionTable,(ulong)count*40);
            Need((ulong)sectionTable+count*40<=headerSize,"SECTION_TABLE");
            for(uint i=0;i<count;i++)
            {
                uint at=sectionTable+i*40;
                Section s=new Section { Virtual=U32(at+8),Va=U32(at+12),RawSize=U32(at+16),Raw=U32(at+20),Flags=U32(at+36) };
                ulong span=Math.Max(s.Virtual,s.RawSize);
                Need(s.Va>=headerSize && span>0 && (ulong)s.Va+span<=imageSize,"SECTION_IMAGE_RANGE");
                if(s.RawSize>0){Need(s.Raw>=headerSize,"SECTION_RAW_HEADER_OVERLAP");Offset(s.Raw,s.RawSize);}
                Need((s.Flags&0xA0000000U)!=0xA0000000U,"WRITABLE_EXECUTABLE_SECTION");
                foreach(Section other in sections)
                {
                    Need((ulong)s.Va+span<=other.Va || (ulong)other.Va+Math.Max(other.Virtual,other.RawSize)<=s.Va,"SECTION_IMAGE_OVERLAP");
                    if(s.RawSize>0 && other.RawSize>0)Need((ulong)s.Raw+s.RawSize<=other.Raw || (ulong)other.Raw+other.RawSize<=s.Raw,"SECTION_RAW_OVERLAP");
                }
                sections.Add(s);
            }
            Executable(U32(optional+16));uint size,rva=Directory(optional,14,out size);Need(rva==0 && size==0,"CLR_PRESENT");
            rva=Directory(optional,13,out size);Need(rva==0 && size==0,"DELAY_IMPORT_PRESENT");
            rva=Directory(optional,5,out size);Need(rva!=0 && size>=8,"RELOCATIONS_REQUIRED");Map(rva,size);
            uint iatSize,iat=Directory(optional,12,out iatSize);Need(iat!=0 && iatSize>=16 && iatSize<=131072,"IAT_REQUIRED");Map(iat,iatSize);
            uint imports=Directory(optional,1,out size);Need(imports!=0 && size>=40 && size<=131072,"IMPORT_DIRECTORY");
            int importAt=Map(imports,size);bool ended=false;HashSet<string> modules=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            HashSet<string> allowed=new HashSet<string>(new string[]{"KERNEL32.DLL","ADVAPI32.DLL","BCRYPT.DLL","NTDLL.DLL"},StringComparer.OrdinalIgnoreCase);
            for(uint i=0;i<size/20;i++)
            {
                Need(i<64,"IMPORT_MODULE_CAP");uint at=checked((uint)importAt+i*20);
                uint lookup=U32(at),timestamp=U32(at+4),forwarder=U32(at+8),name=U32(at+12),first=U32(at+16);
                if((lookup|timestamp|forwarder|name|first)==0){ended=true;break;}
                Need(name!=0 && first!=0 && timestamp==0 && forwarder==0,"UNBOUND_IMPORT_DESCRIPTOR");string module=Ascii(name,128).ToUpperInvariant();
                Need(allowed.Contains(module) && modules.Add(module),"IMPORT_MODULE_REFUSED");
                uint table=lookup!=0?lookup:first;bool thunkEnd=false;
                for(uint j=0;j<4096;j++)
                {
                    Need((ulong)table+j*8U<=UInt32.MaxValue && (ulong)first+j*8U<=UInt32.MaxValue,"THUNK_OVERFLOW");
                    ulong thunk=U64((uint)Map(table+j*8U,8));ulong iatThunk=U64((uint)Map(first+j*8U,8));
                    Need(thunk==iatThunk,"UNBOUND_IAT_MISMATCH");
                    Need((ulong)first+j*8U>=iat && (ulong)first+j*8U+8<=(ulong)iat+iatSize,"THUNK_OUTSIDE_IAT");
                    if(thunk==0){thunkEnd=true;break;}
                    if((thunk&0x8000000000000000UL)!=0)Need((thunk&0x7FFFFFFFFFFF0000UL)==0 && (thunk&0xFFFFUL)>0,"IMPORT_ORDINAL");
                    else{Need(thunk<=UInt32.MaxValue-2,"IMPORT_HINT_RVA");Map((uint)thunk,2);Ascii((uint)thunk+2,512);}
                }
                Need(thunkEnd,"THUNK_UNTERMINATED");
            }
            Need(ended && modules.Contains("KERNEL32.DLL"),"IMPORT_TERMINATOR_OR_KERNEL32");
            if(bootstrap)Need(modules.Contains("ADVAPI32.DLL") && modules.Contains("BCRYPT.DLL"),"BOOTSTRAP_IMPORT_SET");
            rva=Directory(optional,10,out size);Need(rva!=0 && size>=148 && size<=65536,"LOAD_CONFIG_REQUIRED");
            uint config=(uint)Map(rva,size),declared=U32(config);Need(declared>=148 && declared<=size,"LOAD_CONFIG_SIZE");
            Map(VaToRva(U64(config+112)),8);Map(VaToRva(U64(config+120)),8);
            uint guard=U32(config+144);ulong n=U64(config+136);Need((guard&0x500U)==0x500U && n>0 && n<=65536,"CFG_TABLE_FLAGS_COUNT");
            uint tableRva=VaToRva(U64(config+128)),stride=4+(guard>>28);
            uint tableAt=(uint)Map(tableRva,n*stride);uint previous=0;
            for(ulong i=0;i<n;i++){uint target=U32((ulong)tableAt+i*stride);Need(i==0 || target>previous,"CFG_TABLE_ORDER");Executable(target);previous=target;}
            string[] names=new string[modules.Count];modules.CopyTo(names);Array.Sort(names,StringComparer.Ordinal);
            return new PeReport{ClrAbsent=true,DelayImportsAbsent=true,DynamicBase=true,NxCompatible=true,HighEntropyVa=true,ControlFlowGuard=true,GuardFlags=guard,GuardFunctionCount=n,Imports=names};
        }
        public static PeReport Verify(byte[] bytes,bool bootstrap) { return new PeReader(bytes).Parse(bootstrap); }
    }
}

namespace VmangosA147
{
    public sealed class JobMember
    {
        public uint ProcessId { get; set; }
        public bool MembershipChecked { get; set; }
        public bool InOwnedJob { get; set; }
        public string Image { get; set; }
        public string CreatedUtc { get; set; }
        public uint ExitCode { get; set; }
        public uint WaitResult { get; set; }
        public int Error { get; set; }
    }
    public sealed class JobSnapshot
    {
        public string Phase { get; set; }
        public uint AccountingActive { get; set; }
        public bool Captured { get; set; }
        public string Failure { get; set; }
        public JobMember[] Members { get; set; }
        public bool QueryHandlesClosedBeforeReturn { get; set; }
    }
    public static class JobObserver
    {
        [System.Runtime.InteropServices.DllImport("kernel32.dll",EntryPoint="QueryInformationJobObject",SetLastError=true)]
        private static extern bool QueryIds(System.IntPtr job,int type,System.IntPtr data,uint size,out uint returned);
        [System.Runtime.InteropServices.DllImport("kernel32.dll",SetLastError=true)]
        private static extern System.IntPtr OpenProcess(uint access,bool inherit,uint id);
        [System.Runtime.InteropServices.DllImport("kernel32.dll",SetLastError=true)]
        private static extern bool IsProcessInJob(System.IntPtr process,System.IntPtr job,out bool member);
        [System.Runtime.InteropServices.DllImport("kernel32.dll",CharSet=System.Runtime.InteropServices.CharSet.Unicode,SetLastError=true)]
        private static extern bool QueryFullProcessImageNameW(System.IntPtr process,uint flags,System.Text.StringBuilder image,ref uint length);
        [System.Runtime.InteropServices.DllImport("kernel32.dll",SetLastError=true)]
        private static extern bool GetProcessTimes(System.IntPtr process,out long created,out long exited,out long kernel,out long user);
        [System.Runtime.InteropServices.DllImport("kernel32.dll",SetLastError=true)]
        private static extern bool GetExitCodeProcess(System.IntPtr process,out uint code);
        [System.Runtime.InteropServices.DllImport("kernel32.dll",SetLastError=true)]
        private static extern uint WaitForSingleObject(System.IntPtr handle,uint timeout);
        [System.Runtime.InteropServices.DllImport("kernel32.dll",SetLastError=true)]
        private static extern bool CloseHandle(System.IntPtr handle);
        private static void Need(bool value) { if(!value) throw new System.InvalidOperationException("A147_JOB_SNAPSHOT_PROFILE"); }
        public static uint[] DecodeIds(byte[] bytes,int pointerSize)
        {
            Need(bytes != null && bytes.Length >= 8 && (pointerSize == 4 || pointerSize == 8));
            uint assigned=System.BitConverter.ToUInt32(bytes,0),count=System.BitConverter.ToUInt32(bytes,4);
            Need(assigned == count && count <= 32 && bytes.Length >= 8+(long)count*pointerSize);
            uint[] ids=new uint[count];var seen=new System.Collections.Generic.HashSet<uint>();
            for(int i=0;i<ids.Length;i++)
            {
                ulong id=pointerSize == 8 ? System.BitConverter.ToUInt64(bytes,8+i*8) : System.BitConverter.ToUInt32(bytes,8+i*4);
                Need(id > 0 && id <= uint.MaxValue && seen.Add((uint)id));ids[i]=(uint)id;
            }
            return ids;
        }
        private static JobMember Observe(System.IntPtr job,uint id,ref bool handlesClosed)
        {
            var result=new JobMember {ProcessId=id,Image="UNAVAILABLE",CreatedUtc="",WaitResult=uint.MaxValue};
            // QUERY_LIMITED_INFORMATION | SYNCHRONIZE, no control rights.
            System.IntPtr process=OpenProcess(0x00101000U,false,id);
            if(process == System.IntPtr.Zero) { result.Error=System.Runtime.InteropServices.Marshal.GetLastWin32Error();return result; }
            try
            {
                bool member;
                if(!IsProcessInJob(process,job,out member)) { result.Error=System.Runtime.InteropServices.Marshal.GetLastWin32Error();return result; }
                result.MembershipChecked=true;result.InOwnedJob=member;
                if(!member) return result; // PID may have exited/reused; do not inspect a nonmember.
                long created,exited,kernel,user;uint code;
                if(!GetProcessTimes(process,out created,out exited,out kernel,out user)) { result.Error=System.Runtime.InteropServices.Marshal.GetLastWin32Error();return result; }
                result.CreatedUtc=System.DateTime.FromFileTimeUtc(created).ToString("o");
                var image=new System.Text.StringBuilder(1024);uint length=1024;
                if(!QueryFullProcessImageNameW(process,0,image,ref length)) { result.Error=System.Runtime.InteropServices.Marshal.GetLastWin32Error();return result; }
                result.Image=image.ToString();
                if(!GetExitCodeProcess(process,out code)) { result.Error=System.Runtime.InteropServices.Marshal.GetLastWin32Error();return result; }
                result.ExitCode=code;result.WaitResult=WaitForSingleObject(process,0);
                if(result.WaitResult == uint.MaxValue) result.Error=System.Runtime.InteropServices.Marshal.GetLastWin32Error();
                return result;
            }
            finally
            {
                if(!CloseHandle(process)) { handlesClosed=false;throw new System.InvalidOperationException("A147_JOB_QUERY_HANDLE_CLOSE_FAILED"); }
            }
        }
        public static JobSnapshot Capture(System.IntPtr job,string phase,uint active)
        {
            var result=new JobSnapshot {Phase=phase,AccountingActive=active,Failure="",Members=new JobMember[0]};
            System.IntPtr buffer=System.IntPtr.Zero;bool handlesClosed=true;
            try
            {
                int size=8+32*System.IntPtr.Size;buffer=System.Runtime.InteropServices.Marshal.AllocHGlobal(size);
                uint returned;
                if(!QueryIds(job,3,buffer,(uint)size,out returned))
                    throw new System.ComponentModel.Win32Exception(System.Runtime.InteropServices.Marshal.GetLastWin32Error());
                byte[] data=new byte[size];System.Runtime.InteropServices.Marshal.Copy(buffer,data,0,size);
                uint[] ids=DecodeIds(data,System.IntPtr.Size);
                var members=new System.Collections.Generic.List<JobMember>();
                foreach(uint id in ids) members.Add(Observe(job,id,ref handlesClosed));
                result.Members=members.ToArray();result.Captured=true;
                return result;
            }
            catch(System.Exception error)
            {
                result.Failure=error is System.ComponentModel.Win32Exception ? "WIN32_"+((System.ComponentModel.Win32Exception)error).NativeErrorCode.ToString() : error.GetType().Name;
                return result;
            }
            finally
            {
                if(buffer != System.IntPtr.Zero) System.Runtime.InteropServices.Marshal.FreeHGlobal(buffer);
                result.QueryHandlesClosedBeforeReturn=handlesClosed;
            }
        }
    }
}

namespace VmangosA147
{
    // This policy is for the external CMake build tools only. It is never
    // applied to the bootstrap, portable policy tester or Windows fixture.
    public static class TelemetryCleanupRules
    {
        public static readonly string X86Image = @"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx86\x64\vctip.exe";
        public static readonly string X64Image = @"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64\vctip.exe";
        public static bool QualifiedImages(string[] paths)
        {
            return paths != null && paths.Length == 2 &&
                string.Equals(paths[0],X86Image,System.StringComparison.OrdinalIgnoreCase) &&
                string.Equals(paths[1],X64Image,System.StringComparison.OrdinalIgnoreCase);
        }
        public static bool Eligible(string phase,string[] paths,JobSnapshot snapshot,
            bool natural,int rootExit,int rootId,uint currentActive,System.DateTime startedUtc,System.DateTime observedUtc)
        {
            if((phase != "CONFIGURE" && phase != "BUILD") || !QualifiedImages(paths) ||
               !natural || rootExit != 0 || rootId <= 0 || snapshot == null ||
               !snapshot.Captured || !snapshot.QueryHandlesClosedBeforeReturn ||
               !string.IsNullOrEmpty(snapshot.Failure) ||
               snapshot.Phase != "AFTER_GRACE_BEFORE_OWNED_TERMINATION" ||
               snapshot.Members == null || snapshot.Members.Length == 0 || snapshot.Members.Length > 32 ||
               snapshot.AccountingActive != snapshot.Members.Length || currentActive != snapshot.AccountingActive ||
               startedUtc.Kind != System.DateTimeKind.Utc || observedUtc.Kind != System.DateTimeKind.Utc || observedUtc < startedUtc)
                return false;
            var ids=new System.Collections.Generic.HashSet<uint>();
            foreach(JobMember member in snapshot.Members)
            {
                if(member == null || member.ProcessId == 0 || member.ProcessId == rootId || !ids.Add(member.ProcessId) ||
                   !member.MembershipChecked || !member.InOwnedJob || member.Error != 0 ||
                   member.ExitCode != 259 || member.WaitResult != 258) return false;
                bool matches=false;
                foreach(string path in paths) if(string.Equals(member.Image,path,System.StringComparison.OrdinalIgnoreCase)) matches=true;
                if(!matches) return false;
                System.DateTime created;
                if(!System.DateTime.TryParseExact(member.CreatedUtc,"o",System.Globalization.CultureInfo.InvariantCulture,
                   System.Globalization.DateTimeStyles.RoundtripKind,out created) || created.Kind != System.DateTimeKind.Utc ||
                   created < startedUtc || created > observedUtc) return false;
            }
            return true;
        }
    }
    // Keep the two reviewed images open read-only without WRITE/DELETE sharing
    // for the whole command. Pin validation happens before starting CMake.
    public sealed class TelemetryCleanupLease : System.IDisposable
    {
        [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
        private struct FileInfo
        {
            public uint Attributes,CreatedLow,CreatedHigh,AccessLow,AccessHigh,WrittenLow,WrittenHigh;
            public uint VolumeSerial,SizeHigh,SizeLow,Links,IndexHigh,IndexLow;
        }
        [System.Runtime.InteropServices.DllImport("kernel32.dll",EntryPoint="CreateFileW",CharSet=System.Runtime.InteropServices.CharSet.Unicode,SetLastError=true)]
        private static extern Microsoft.Win32.SafeHandles.SafeFileHandle OpenImage(string path,uint access,uint share,
            System.IntPtr security,uint disposition,uint flags,System.IntPtr template);
        [System.Runtime.InteropServices.DllImport("kernel32.dll",SetLastError=true)]
        private static extern bool GetFileInformationByHandle(Microsoft.Win32.SafeHandles.SafeFileHandle handle,out FileInfo info);
        private readonly System.Collections.Generic.List<System.IO.FileStream> streams=new System.Collections.Generic.List<System.IO.FileStream>();
        private readonly string phase;
        private readonly string[] paths;
        private bool disposed;
        public TelemetryCleanupLease(string phase,string[] paths,long[] lengths,string[] hashes)
        {
            Need((phase == "CONFIGURE" || phase == "BUILD") && TelemetryCleanupRules.QualifiedImages(paths));
            Need(lengths != null && lengths.Length == 2 && hashes != null && hashes.Length == 2);
            this.phase=phase;this.paths=(string[])paths.Clone();
            try
            {
                for(int i=0;i<2;i++)
                {
                    Need(lengths[i] > 0 && lengths[i] <= 1048576 && hashes[i] != null &&
                        System.Text.RegularExpressions.Regex.IsMatch(hashes[i],"\\A[0-9A-F]{64}\\z"));
                    // OPEN_EXISTING, OPEN_REPARSE_POINT, SEQUENTIAL_SCAN.
                    var handle=OpenImage(this.paths[i],0x80000000U,1U,System.IntPtr.Zero,3U,0x08200000U,System.IntPtr.Zero);
                    if(handle.IsInvalid) { int error=System.Runtime.InteropServices.Marshal.GetLastWin32Error();handle.Dispose();throw new System.ComponentModel.Win32Exception(error); }
                    System.IO.FileStream stream=null;
                    try
                    {
                        FileInfo info;
                        if(!GetFileInformationByHandle(handle,out info)) throw new System.ComponentModel.Win32Exception(System.Runtime.InteropServices.Marshal.GetLastWin32Error());
                        long length=((long)info.SizeHigh<<32)|info.SizeLow;
                        Need((info.Attributes & 0x410U) == 0 && length == lengths[i]);
                        stream=new System.IO.FileStream(handle,System.IO.FileAccess.Read,4096,false);
                        string actual;
                        using(var hash=System.Security.Cryptography.SHA256.Create())
                            actual=System.BitConverter.ToString(hash.ComputeHash(stream)).Replace("-","");
                        Need(actual == hashes[i]);streams.Add(stream);stream=null;
                    }
                    finally
                    {
                        if(stream != null) stream.Dispose();
                        // FileStream owns the handle only after it is in streams.
                        if(!streams.Exists(s => object.ReferenceEquals(s.SafeFileHandle,handle))) handle.Dispose();
                    }
                }
            }
            catch { Dispose();throw; }
        }
        private static void Need(bool value) { if(!value) throw new System.InvalidOperationException("A147_TELEMETRY_IMAGE_LEASE_PROFILE"); }
        public bool Eligible(JobSnapshot snapshot,bool natural,int exit,int root,uint active,System.DateTime startedUtc)
        {
            return !disposed && streams.Count == 2 && TelemetryCleanupRules.Eligible(phase,paths,snapshot,natural,exit,root,active,startedUtc,System.DateTime.UtcNow);
        }
        public void Dispose()
        {
            if(disposed)return;disposed=true;
            System.Exception failure=null;
            foreach(var stream in streams) try{stream.Dispose();}catch(System.Exception error){failure=error;}
            streams.Clear();
            if(failure != null) throw new System.InvalidOperationException("A147_TELEMETRY_IMAGE_LEASE_CLOSE_FAILED",failure);
        }
    }
}

namespace VmangosA147
{
    // No process-token adjustment. Privilege is enabled only on a duplicate,
    // impersonated synchronously inside one native object-creation call.
    public static class OwnedIo
    {
        [StructLayout(LayoutKind.Sequential)] private struct Attributes { internal int Length;internal IntPtr Descriptor;internal int Inherit; }
        [StructLayout(LayoutKind.Sequential)] private struct Luid { internal uint Low; internal int High; }
        [StructLayout(LayoutKind.Sequential)] private struct Privileges { internal uint Count; internal Luid Id; internal uint Attributes; }
        [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
        [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentThread();
        [DllImport("kernel32.dll", SetLastError=true)] private static extern bool CloseHandle(IntPtr value);
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] private static extern uint GetFileAttributesW(string path);
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] private static extern bool CreateDirectoryW(string path,ref Attributes security);
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] private static extern SafeFileHandle CreateFileW(string path,uint access,uint share,ref Attributes security,uint disposition,uint flags,IntPtr template);
        [DllImport("advapi32.dll", SetLastError=true)] private static extern bool OpenThreadToken(IntPtr thread,uint access,bool asSelf,out IntPtr token);
        [DllImport("advapi32.dll", SetLastError=true)] private static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
        [DllImport("advapi32.dll", SetLastError=true)] private static extern bool DuplicateTokenEx(IntPtr token,uint access,IntPtr attributes,int level,int kind,out IntPtr duplicate);
        [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] private static extern bool LookupPrivilegeValueW(string system,string name,out Luid value);
        [DllImport("advapi32.dll", SetLastError=true)] private static extern bool AdjustTokenPrivileges(IntPtr token,bool disable,ref Privileges state,uint length,IntPtr old,IntPtr returned);
        [DllImport("advapi32.dll", SetLastError=true)] private static extern bool GetTokenInformation(IntPtr token,int kind,byte[] bytes,int length,out int returned);
        [DllImport("advapi32.dll", SetLastError=true)] private static extern bool ImpersonateLoggedOnUser(IntPtr token);
        [DllImport("advapi32.dll", SetLastError=true)] private static extern bool RevertToSelf();
        private static void Need(bool value,string code) { if(!value) throw new InvalidOperationException("A147_"+code+"_WIN32_"+Marshal.GetLastWin32Error()); }
        private static byte[] Information(IntPtr token,int kind)
        {
            int length;
            bool first=GetTokenInformation(token,kind,null,0,out length);
            Need(!first && Marshal.GetLastWin32Error()==122 && length>0 && length<=65536,"TOKEN_INFORMATION_SIZE");
            byte[] bytes=new byte[length];int actual;
            Need(GetTokenInformation(token,kind,bytes,bytes.Length,out actual) && actual==length,"TOKEN_INFORMATION");
            return bytes;
        }
        private static string Snapshot(IntPtr token)
        {
            // Privileges and TOKEN_STATISTICS are self-contained (no pointers).
            return Package.Hash(Information(token,3))+Package.Hash(Information(token,10));
        }
        public static void NoImpersonation()
        {
            IntPtr token=IntPtr.Zero;
            bool opened=OpenThreadToken(GetCurrentThread(),8,true,out token);int error=Marshal.GetLastWin32Error();
            if(token!=IntPtr.Zero) CloseHandle(token);
            if(opened || error!=1008) throw new InvalidOperationException("A147_THREAD_TOKEN_PRESENT_OR_UNOBSERVABLE");
        }
        private sealed class RestoreScope : IDisposable
        {
            private IntPtr source,duplicate;private string before;private bool active;
            internal RestoreScope()
            {
                try
                {
                    NoImpersonation();
                    Need(OpenProcessToken(GetCurrentProcess(),0xA,out source),"OPEN_SOURCE_TOKEN_QUERY_DUPLICATE");
                    before=Snapshot(source);
                    Need(DuplicateTokenEx(source,0x2C,IntPtr.Zero,2,2,out duplicate),"DUPLICATE_IMPERSONATION_TOKEN");
                    Luid id;Need(LookupPrivilegeValueW(null,"SeRestorePrivilege",out id),"RESTORE_PRIVILEGE_LUID");
                    Privileges change=new Privileges { Count=1,Id=id,Attributes=2 };
                    Need(AdjustTokenPrivileges(duplicate,false,ref change,0,IntPtr.Zero,IntPtr.Zero),"ENABLE_DUPLICATE_RESTORE_PRIVILEGE");
                    Need(Marshal.GetLastWin32Error()==0,"DUPLICATE_RESTORE_PRIVILEGE_NOT_ASSIGNED");
                    byte[] present=Information(duplicate,3);
                    uint count=BitConverter.ToUInt32(present,0);bool enabled=false;
                    Need(count<=1024 && 4L+12L*count==present.Length,"PRIVILEGE_ARRAY");
                    for(int n=0;n<count;n++)
                    {
                        int at=4+12*n;
                        if(BitConverter.ToUInt32(present,at)==id.Low && BitConverter.ToInt32(present,at+4)==id.High)
                            enabled=(BitConverter.ToUInt32(present,at+8)&2)!=0;
                    }
                    Need(enabled,"DUPLICATE_RESTORE_NOT_ENABLED");
                    Need(ImpersonateLoggedOnUser(duplicate),"IMPERSONATE_OWN_DUPLICATE");active=true;
                }
                catch { Dispose();throw; }
            }
            public void Dispose()
            {
                try
                {
                    if(active)
                    {
                        // Never return control to PowerShell with an uncertain thread token.
                        if(!RevertToSelf()) Environment.FailFast("A147_REVERT_TO_SELF_FAILED");
                        active=false;
                    }
                    NoImpersonation();
                    if(source!=IntPtr.Zero && before!=null && before!=Snapshot(source))
                        throw new InvalidOperationException("A147_SOURCE_PROCESS_TOKEN_CHANGED");
                }
                finally
                {
                    if(duplicate!=IntPtr.Zero) { CloseHandle(duplicate);duplicate=IntPtr.Zero; }
                    if(source!=IntPtr.Zero) { CloseHandle(source);source=IntPtr.Zero; }
                }
            }
        }
        private const string Root=@"C:\VMANGOS-Accounts-Fixture-A139-1f07880aecf4453d8e77d99dc8fa3f7d";
        public static void AssertAbsent(string path)
        {
            // This read-only probe accepts only the two original installer
            // locations and the one fixed diagnostic task used by A149.
            if(path!=Root && path!=@"C:\Windows\System32\Tasks\VMANGOS-ACCOUNTS-A139-1f07880aecf4453d8e77d99dc8fa3f7d-VERIFY-INSTALLED" &&
                path!=@"C:\Windows\System32\Tasks\VMANGOS-ACCOUNTS-A153-NATIVE-VERIFY")
                throw new InvalidOperationException("A147_ABSENCE_PATH_REFUSED");
            uint attributes=GetFileAttributesW(path);int error=Marshal.GetLastWin32Error();
            if(attributes!=0xFFFFFFFFU || (error!=2 && error!=3))
                throw new InvalidOperationException("A147_ROOT_OR_TASK_FILE_EXISTS_OR_UNOBSERVABLE");
        }
        private static void Scope(string path,byte[] descriptor,bool directory)
        {
            bool allowed=path==Root;
            foreach(string name in new string[] {"worker","client","launcher","bootstrap","system-temp","client-temp"})
                if(directory ? path==Root+"\\"+name : path.StartsWith(Root+"\\"+name+"\\",StringComparison.Ordinal) && path.Substring(Root.Length+name.Length+2).IndexOf('\\')<0) allowed=true;
            if(!directory && path==Root+"\\run-spec.json") allowed=true;
            if(!allowed || path.Length>=240 || path.IndexOf(':',2)>=0 || path.IndexOf("..",StringComparison.Ordinal)>=0)
                throw new InvalidOperationException("A147_NEW_OWNED_PATH_REFUSED");
            RawSecurityDescriptor raw=new RawSecurityDescriptor(descriptor,0);
            if(raw.Owner==null || raw.Owner.Value!="S-1-5-18" || (raw.ControlFlags&ControlFlags.DiscretionaryAclProtected)==0)
                throw new InvalidOperationException("A147_NEW_OWNED_DESCRIPTOR_REFUSED");
        }
        public static void Directory(string path,byte[] descriptor)
        {
            Scope(path,descriptor,true);
            using(new RestoreScope())
            {
                GCHandle pin=GCHandle.Alloc(descriptor,GCHandleType.Pinned);
                try
                {
                    Attributes security=new Attributes { Length=Marshal.SizeOf(typeof(Attributes)),Descriptor=pin.AddrOfPinnedObject(),Inherit=0 };
                    Need(CreateDirectoryW(path,ref security),"CREATE_SYSTEM_OWNED_DIRECTORY");
                }
                finally { pin.Free(); }
            }
        }
        public static FileStream NewFile(string path,byte[] descriptor)
        {
            Scope(path,descriptor,false);FileStream stream=null;
            try
            {
                using(new RestoreScope())
                {
                    GCHandle pin=GCHandle.Alloc(descriptor,GCHandleType.Pinned);
                    try
                    {
                        Attributes security=new Attributes { Length=Marshal.SizeOf(typeof(Attributes)),Descriptor=pin.AddrOfPinnedObject(),Inherit=0 };
                        SafeFileHandle handle=CreateFileW(path,0x40000000,1,ref security,1,0x80000080,IntPtr.Zero);
                        if(handle.IsInvalid) { int error=Marshal.GetLastWin32Error();handle.Dispose();throw new InvalidOperationException("A147_CREATE_SYSTEM_OWNED_FILE_WIN32_"+error); }
                        try { stream=new FileStream(handle,FileAccess.Write,4096,false); } catch { handle.Dispose();throw; }
                    }
                    finally { pin.Free(); }
                }
                return stream;
            }
            catch { if(stream!=null) stream.Dispose();throw; }
        }
        public static void ProbePrivilege() { using(new RestoreScope()) { } }
    }

    // Retains all source/parent handles before any installation. Source files
    // deny write/delete, directory ancestors deny delete; no target is followed.
    public sealed class InstallLease : IDisposable
    {
        [StructLayout(LayoutKind.Sequential)] private struct Info
        {
            internal uint Attributes,CreateLow,CreateHigh,AccessLow,AccessHigh,WriteLow,WriteHigh;
            internal uint Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow;
        }
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern SafeFileHandle CreateFileW(string path,uint access,uint share,IntPtr attributes,uint disposition,uint flags,IntPtr template);
        [DllImport("kernel32.dll",SetLastError=true)] private static extern bool GetFileInformationByHandle(SafeFileHandle handle,out Info info);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle,StringBuilder path,uint count,uint flags);
        [DllImport("kernel32.dll",SetLastError=true)] private static extern uint GetFileType(SafeFileHandle handle);
        [DllImport("advapi32.dll",SetLastError=true)] private static extern bool GetKernelObjectSecurity(SafeFileHandle handle,uint kind,byte[] buffer,uint count,out uint needed);
        private sealed class Held : IDisposable
        {
            internal readonly string Path;internal readonly bool Directory;internal SafeFileHandle Handle;internal FileStream Stream;
            internal Info Identity;internal string Descriptor;internal string Hash;internal long Length;internal string Modified;
            internal Held(string path,bool directory)
            {
                Path=path;Directory=directory;
                try
                {
                    Handle=CreateFileW(path,0x120080U|(directory?0U:1U),directory?3U:1U,IntPtr.Zero,3,0x00200000U|(directory?0x02000000U:0U),IntPtr.Zero);
                    Need(!Handle.IsInvalid && GetFileType(Handle)==1 && GetFileInformationByHandle(Handle,out Identity),"LEASE_OPEN");
                    Need((Identity.Attributes&0x400)==0 && ((Identity.Attributes&0x10)!=0)==directory && (directory || Identity.Links==1),"LEASE_REPARSE_KIND_OR_LINKS");
                    Need(String.Equals(Final(),path,StringComparison.OrdinalIgnoreCase),"LEASE_FINAL_PATH");Descriptor=Security();
                    if(!directory) Stream=new FileStream(Handle,FileAccess.Read,65536,false);
                }
                catch { Dispose();throw; }
            }
            private string Final()
            {
                StringBuilder value=new StringBuilder(1024);uint count=GetFinalPathNameByHandleW(Handle,value,1024,0);
                Need(count>4 && count<1024 && value.ToString().StartsWith(@"\\?\",StringComparison.Ordinal),"LEASE_FINAL_PATH_QUERY");
                return value.ToString().Substring(4);
            }
            private string Security()
            {
                uint length;bool first=GetKernelObjectSecurity(Handle,7,null,0,out length);
                Need(!first && Marshal.GetLastWin32Error()==122 && length>=20 && length<=65536,"LEASE_SECURITY_SIZE");
                byte[] value=new byte[length];uint actual;
                Need(GetKernelObjectSecurity(Handle,7,value,length,out actual) && actual==length,"LEASE_SECURITY_READ");
                return Package.Hash(value);
            }
            internal void Check()
            {
                Info now;Need(GetFileInformationByHandle(Handle,out now),"LEASE_RECHECK");
                Need(now.Volume==Identity.Volume && now.IndexHigh==Identity.IndexHigh && now.IndexLow==Identity.IndexLow && now.Attributes==Identity.Attributes && now.Links==Identity.Links && String.Equals(Final(),Path,StringComparison.OrdinalIgnoreCase) && Security()==Descriptor,"LEASE_IDENTITY_OR_SECURITY_CHANGED");
                if(!Directory) Need(now.SizeHigh==Identity.SizeHigh && now.SizeLow==Identity.SizeLow && now.WriteHigh==Identity.WriteHigh && now.WriteLow==Identity.WriteLow,"LEASE_FILE_CHANGED");
            }
            internal void Validate(string expected,long length,string modified)
            {
                Need(!Directory && length>=0 && length<=16777216 && Stream.Length==length,"LEASE_LENGTH");
                long filetime=((long)Identity.WriteHigh<<32)|Identity.WriteLow;
                string actual=DateTime.FromFileTimeUtc(filetime).ToString("o",System.Globalization.CultureInfo.InvariantCulture);
                Need(modified==actual,"LEASE_MTIME");
                Stream.Position=0;string hash;
                using(SHA256 digest=SHA256.Create()) hash=BitConverter.ToString(digest.ComputeHash(Stream)).Replace("-","");
                Need(hash==expected,"LEASE_SHA256");Check();Hash=hash;Length=length;Modified=actual;
            }
            internal byte[] Bytes()
            {
                Validate(Hash,Length,Modified);Stream.Position=0;byte[] bytes=new byte[checked((int)Length)];int read=0;
                while(read<bytes.Length) { int count=Stream.Read(bytes,read,bytes.Length-read);Need(count>0,"LEASE_COPY_SHORT_READ");read+=count; }
                Need(Package.Hash(bytes)==Hash,"LEASE_COPY_HASH");Check();return bytes;
            }
            public void Dispose() { if(Stream!=null) { Stream.Dispose();Stream=null; } if(Handle!=null) { Handle.Dispose();Handle=null; } }
        }
        private readonly Dictionary<string,Held> objects=new Dictionary<string,Held>(StringComparer.Ordinal);
        private readonly List<Held> order=new List<Held>();private bool disposed;
        private static void Need(bool value,string code) { if(!value) throw new InvalidOperationException("A147_"+code); }
        private static void PathGuard(string path)
        {
            Need(!String.IsNullOrEmpty(path) && path.StartsWith(@"C:\",StringComparison.Ordinal) && path.Length<240 && path.IndexOf(':',2)<0 && path.IndexOf("..",StringComparison.Ordinal)<0 && System.IO.Path.GetFullPath(path)==path,"LEASE_PATH_PROFILE");
        }
        public void Directory(string path)
        {
            Need(!disposed,"LEASE_DISPOSED");PathGuard(path);
            Held prior;if(objects.TryGetValue(path,out prior)) { Need(prior.Directory,"LEASE_DUPLICATE_KIND");prior.Check();return; }
            Need(order.Count<96,"LEASE_OBJECT_CAP");
            if(path.Length>3) Directory(System.IO.Path.GetDirectoryName(path));
            Held next=new Held(path,true);objects.Add(path,next);order.Add(next);
        }
        public void Add(string path,string hash,long length,string modified)
        {
            Need(!disposed && !objects.ContainsKey(path) && hash!=null && hash.Length==64,"LEASE_DUPLICATE_OR_HASH");PathGuard(path);
            Directory(System.IO.Path.GetDirectoryName(path));Need(order.Count<96,"LEASE_OBJECT_CAP");
            Held next=new Held(path,false);
            try { next.Validate(hash,length,modified);objects.Add(path,next);order.Add(next); }
            catch { next.Dispose();throw; }
        }
        public byte[] Read(string path) { Need(!disposed && objects.ContainsKey(path),"LEASE_NOT_FOUND");return objects[path].Bytes(); }
        public void Revalidate()
        {
            Need(!disposed,"LEASE_DISPOSED");foreach(Held held in order) { held.Check();if(!held.Directory) held.Validate(held.Hash,held.Length,held.Modified); }
        }
        public int Count { get { return order.Count; } }
        public void Dispose()
        {
            if(disposed) return;disposed=true;
            for(int n=order.Count-1;n>=0;n--) order[n].Dispose();order.Clear();objects.Clear();
        }
    }
}
