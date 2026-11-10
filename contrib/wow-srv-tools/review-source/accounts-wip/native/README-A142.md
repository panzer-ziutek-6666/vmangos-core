# A142 — native pre-entry SYSTEM bootstrap candidate

Source candidate for the exact successful A141 package from WOW-SRV, 2026-10-22
07:59 Europe/Warsaw. A142 writes source files only; it neither compiles nor
installs/executes this executable on WOW-SRV. The existing panel remains
DisabledAccountGateway, CreateAccount/reset disabled, all 15 live gaps open.

## Binding and purpose

The generated sealed_a141.hpp binds the exact A141 generation, spec SHA256 and
length, 18 bundle hashes/lengths, and 190 .NET 10.0.12/fxr runtime file hashes,
lengths and observed modification FILETIMEs. It intentionally does not parse
untrusted JSON, accept replacement paths/versions, fetch packages or repair ACLs.
The unchanged A139 spec is verified as bytes before the managed parser sees it.
ProcessAccessPolicy remains A135-PRIVATE-TOKEN-QUERY-1. The original A130–A141
sources, binaries, receipts and failures are retained unchanged.

Only two eventual modes: --verify-installed checks installed assets without CLR;
--fixture-launch starts the fixed pinned managed fixture launcher. An arbitrary
command, install flag, argument, directory, generation or alternative runtime is
refused. The generation/root/schema stay A139; A142 is the bootstrap source stage.

## Native implementation

Requires WOW-SRV, native x64, SYSTEM primary process in session 0, no thread token,
a private process/token descriptor, and the exact installed bootstrap image path
under the fixed A139 root. Bootstrap directory/executable are SYSTEM-owned and
have protected SYSTEM/Administrators-only ACLs. Only that executable may exist in
its directory. A separate protected installer must establish this trust before
the executable loads; checks in wmain cannot establish trust in its own loader.
The build uses the static MSVC CRT, explicit Windows imports and no CLR/hostfxr
hosting library. The sealed header is part of the native executable, not a
replaceable external policy file.

Before creating a managed process, native code retains non-inheritable read
handles denying write/delete for the spec, all 18 bundle files, its own image and
190 runtime files. Directory handles retain every ancestor without share-delete;
reparse objects, unexpected bundle files/directories and changed final paths,
file identities, descriptors, lengths, hashes or runtime mtimes are refused.
The root and asset directories are SYSTEM-owned, protected and grant only the
existing exact client read/execute mask 0x1200A9; system-temp is private and
client-temp has exactly 0x1301BF for the target pool. Existing runtime/ancestor
write masks remain 0x500D0156/0x500D0152, with SYSTEM/Administrators/TrustedInstaller
as the only trusted writers. Runtime registration uses Registry32 and is checked
for REG_SZ, exact InstallLocation and trusted owner/writers; both runtime version
sets and the full runtime inventory are checked again before resume and at end.

The launcher starts suspended with a duplicated SYSTEM primary token, explicit
protected process/thread/token descriptors, a new unnamed private job with kill
on close and active-process limit 4 (launcher plus its managed 3-child contract),
fixed arguments/cwd, an explicit seven-variable Unicode environment, diagnostics
disabled, EOF stdin and exactly three inherited pipe handles. Source token
descriptor, default DACL, identity, groups, privileges and session are preserved;
there is no source-token mutation API. The suspended image, token, process/thread
descriptors, token identity and job assignment are checked before final seal
revalidation and the single resume. The pool receives only the unchanged
process-query/synchronize mask 0x101000 and token query mask 8 on the managed child.

Output is bounded to 65536 bytes, stderr is refused, launcher exit must be 0 and
its exact single synthetic fixture result must match. Execution wait is 330 s;
all retained input handles outlive the child and own job. No process is killed by
name/PID. Failure terminates only retained owned handles/job. If OS cleanup cannot
reach quiescence, A142_CLEANUP_PENDING is emitted and handles stay retained while
cleanup continues without a deadline. This exceptional retention is intentional:
there is no PASS or release of sealed inputs while an owned job remains active.
File I/O is synchronous; timing limits are not cancellation of blocked kernel I/O.

## Prerequisites for a later installation

Separate Windows Release build/test and PE/import/CLR verification must pass.
Then separately review/prepare installation and a protected SYSTEM entry point.
The installer must pin the approved native executable, create an unused final
generation exclusively with SYSTEM ownership/protected ACLs before publishing
any files, copy the exact pinned A141 spec/bundles, and create the required temp
directories. Its publication/ACL/identity checks and task/process creation must
be verified independently. A142 implements no installation and creates no SYSTEM
task. Do not launch this executable from the writable dev tree or put it in the
A141 package; its installed fixed path and ownership checks will refuse that.

The native-only verify mode and later synthetic fixture execution each need
their own reviewed Windows log. No actual SYSTEM/AppPool/pipe/desktop/Job result,
IIS pipeline result or live feature coverage is established by this source stage.

## Validation and build contract

bootstrap_tests.cpp exercises the exact shared guarded_launch control flow with
failure injection at every call, including create/assign/verify/pre-resume
revalidation, wait and finalization; failures must abort owned work and cannot
resume early. It also checks masks/inherit-only behavior, paths, root generation,
hash format and command refusal. These are portable policy/control-flow tests,
not Windows native tests. A later CMake Windows MSVC x64 Release stage builds
only this independent native project with /MT, /W4 /WX, CFG, ASLR and DEP.
This project does not run the VMaNGOS core CMake configuration or touch
src/shared/Progression.h; the existing EOL note remains applicable to core builds.

Primary Win32 contracts consulted:
- https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessasuserw
- https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw
- https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew
- https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute
- https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-duplicatetokenex

A151: diagnostics-only native variant; every original guard is retained. Build is not installation or SYSTEM verification. WIN32_OBSERVED can be stale for policy checks.

A154 supersedes the A151 policy at exactly one narrow kernel-object case:
after the existing SYSTEM/Administrators owner check, an OWNER RIGHTS
(S-1-3-4) allow ACE with exactly READ_CONTROL (0x00020000) and flags0 is
accepted. This is the specific entry recorded by A153-R1 at PROCESS_SELF.
Other rights for OWNER RIGHTS are rejected. No Windows security descriptor,
source token, installed file, service or task is modified by this policy.
File, runtime, registry and child-descriptor policies remain unchanged.

The synthetic --diagnostic-contract mode belongs only to the test executable.
It emits the same diagnostic and generic marker as the native catch path.
On Windows its stdout uses binary mode to preserve the emitter's raw CRLF.
NativeVerifyProtocol.ps1 accepts exactly verified, generic refusal, or the
two-line specific refusal. A valid refusal remains a failure, not a success.
The build script tests the actual C++ formatter through that PowerShell parser.
The parser source is included for reuse in the later verifier; A154 does not
change or run any installed verifier or native bootstrap.

Evidence boundary: portable tests and compiler success do not establish
Windows/SYSTEM execution, CLR startup, managed fixture success or live account
creation. Build, installation, verify and fixture are separate stages.

Primary references reviewed for A154:
https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-dtyp/81d92bba-d22b-4a8c-908a-554ab29148ab
https://learn.microsoft.com/en-us/cpp/c-runtime-library/reference/setmode?view=msvc-170
