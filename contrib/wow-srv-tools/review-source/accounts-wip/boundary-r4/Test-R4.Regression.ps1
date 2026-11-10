[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ResultDirectory)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Boundary.Common.ps1')
. (Join-Path $PSScriptRoot 'NativeVerifyProtocol.ps1')
CheckHost
Need (-not (Test-Path -LiteralPath $ResultDirectory)) 'NEW_REGRESSION_DIRECTORY_REQUIRED'
Need ($ResultDirectory.StartsWith('C:\Scripts\ACCOUNTS-BOUNDARY-PREP-R4-WOW-SRV-20261027-2355-', [StringComparison]::Ordinal) -and $ResultDirectory.EndsWith('-REGRESSION',[StringComparison]::Ordinal)) 'ISOLATED_REGRESSION_PATH'
Initialize-RegistrySecurity
[WowReleaseV1.Secure]::NewDirectory($ResultDirectory,$false)
$script:HarnessRoot=$ResultDirectory
$ResultPath=Join-Path $ResultDirectory 'RESULT.json'
$cases=[Collections.Generic.List[object]]::new()
function Case([string]$Name,[scriptblock]$Body,[bool]$Accept){
    $accepted=$true;$message=''
    try{& $Body|Out-Null}catch{$accepted=$false;$message=$_.Exception.Message}
    $cases.Add([pscustomobject]@{Name=$Name;Pass=($accepted -eq $Accept);ExpectedAccept=$Accept;ActualAccept=$accepted;Diagnostic=$message})
}
foreach($file in @(Get-ChildItem -LiteralPath $PSScriptRoot -File -Filter '*.ps1')){Case ('PS51_PARSE_'+$file.Name) {$t=$null;$e=$null;[void][Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$t,[ref]$e);Need (@($e).Count -eq 0) 'PS51_PARSE'} $true}
$contract=JsonFile (Join-Path $PSScriptRoot 'Boundary.Contract.json')
Case 'R4_CONTRACT_AND_ALL_PAYLOAD_PINS' {CheckContract $contract;CheckPayloadPins $contract $PSScriptRoot} $true
Case 'INSTALLED_A154_READONLY_PINS' {CheckPins $contract.InstallPins} $true
$token=Get-BoundaryTaskToken
Case 'REAL_TOKEN_LEGAL_BA_OWNER' {Assert-BoundaryTaskOwnerLegal $token} $true
foreach($attrs in @(0,4,8,28)){
    Case ('TOKEN_REFUSE_ILLEGAL_BA_ATTRIBUTES_'+$attrs) {Assert-BoundaryTaskOwnerLegal ([pscustomobject]@{TokenType=1;Elevated=1;Groups=@([pscustomobject]@{Sid='S-1-5-32-544';Attributes=$attrs})})} $false
}
Case 'TOKEN_REFUSE_NON_ELEVATED' {Assert-BoundaryTaskOwnerLegal ([pscustomobject]@{TokenType=1;Elevated=0;Groups=@([pscustomobject]@{Sid='S-1-5-32-544';Attributes=15})})} $false
Case 'TOKEN_REFUSE_MISSING_BA' {Assert-BoundaryTaskOwnerLegal ([pscustomobject]@{TokenType=1;Elevated=1;Groups=@()})} $false
$policy=Get-BoundaryTaskPolicy
Case 'DESCRIPTOR_EXACT_BA_OWNER_SY_BA_DACL' {Assert-BoundaryTaskDescriptor $policy.SDDL} $true
Case 'DESCRIPTOR_COM_AUTOINHERITED_FLAG_ACCEPTED_WITH_PROTECTED_DACL' {Assert-BoundaryTaskDescriptor 'O:BAG:BAD:PAI(A;;FA;;;SY)(A;;FA;;;BA)'} $true
foreach($badSddl in @('O:SYG:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)','O:BAG:BAD:(A;;FA;;;SY)(A;;FA;;;BA)','O:BAG:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FR;;;BU)','O:BAG:BAD:P(A;;FR;;;SY)(A;;FA;;;BA)','O:BAG:BAD:P(A;ID;FA;;;SY)(A;;FA;;;BA)','O:BAG:BAD:P(A;;FA;;;SY)')){
    Case ('DESCRIPTOR_REFUSE_'+$badSddl) {Assert-BoundaryTaskDescriptor $badSddl} $false
}
Case 'PARENT_BOTH_REGISTRATIONS_USE_SHARED_HELPER' {
    $text=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'Invoke-AccountsBoundary.ps1'))
    Need ([regex]::Matches($text,'Register-BoundaryTask -Folder').Count -eq 2 -and -not $text.Contains('.RegisterTaskDefinition(') -and $text.Contains('-Mode Create') -and $text.Contains('-Mode Lock')) 'BOTH_REGISTRATION_SITES'
    Need ($text.Contains("'Task.Security.ps1','Task.Token.cs'") -and -not $text.Contains('R3-20261027-1555')) 'R4_NAMES_AND_SYSTEM_DEPENDENCIES'
} $true
Case 'QA_HAS_NO_RUN_OR_ENABLED_TRUE' {
    $t=$null;$e=$null;$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Test-TaskSecurity.RealAPI.ps1'),[ref]$t,[ref]$e)
    $calls=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.InvokeMemberExpressionAst] -and $n.Member.Value -cin @('Run','RunEx')},$true))
    Need ($calls.Count -eq 0) 'QA_RUN_CALL'
    $assignments=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -match '\.Enabled$' -and $n.Right.Extent.Text -cne '$false'},$true))
    Need ($assignments.Count -eq 0) 'QA_ENABLE_ASSIGNMENT'
} $true
Case 'TOKEN_HELPER_QUERY_ONLY' {
    $text=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'Task.Token.cs'))
    Need ($text.Contains('OpenProcessToken(GetCurrentProcess(),8,out t)') -and $text -notmatch 'AdjustToken|SetToken|DuplicateToken|Impersonate|RevertToSelf') 'TOKEN_MUTATION_API'
} $true
Case 'VERIFY_EXACT_NATIVE_PROTOCOL_MODEL' {ReadCapture Verify ([pscustomobject]@{NaturalExit=$true;WasTerminated=$false;ReadersCompleted=$true;ReaderFailure=$null;OutputLimitExceeded=$false;JobQuiescent=$true;JobFinalActive=0;Stderr='';Stdout="A142_INSTALLED_SEAL_VERIFIED=True CLR_STARTED=False LIVE_CONNECTIONS=0`r`n";ExitCode=0})} $true
Case 'VERIFY_EXTRA_LINE_REFUSED_MODEL' {ReadCapture Verify ([pscustomobject]@{NaturalExit=$true;WasTerminated=$false;ReadersCompleted=$true;ReaderFailure=$null;OutputLimitExceeded=$false;JobQuiescent=$true;JobFinalActive=0;Stderr='';Stdout="A142_INSTALLED_SEAL_VERIFIED=True CLR_STARTED=False LIVE_CONNECTIONS=0`r`nEXTRA`r`n";ExitCode=0})} $false
# Relocated synthetic registry only. The actual Get-CollectorProtection/registry/ACL/Snapshot functions run unchanged.
$parent=Join-Path $script:HarnessRoot 'collector';[WowReleaseV1.Secure]::NewDirectory($parent,$false)
$reg=Join-Path $parent 'release-registry';[WowReleaseV1.Secure]::NewDirectory($reg,$false)
foreach($d in @('manifests','proofs','approvals')){[WowReleaseV1.Secure]::NewDirectory((Join-Path $reg $d),$false);[WowReleaseV1.Secure]::NewFile((Join-Path $reg ($d+'\release-a.json')),[Text.Encoding]::UTF8.GetBytes('{"fixture":"'+$d+'"}'),$false)}
foreach($name in @('state.json','last-sample.json','collector-diagnostic.json','registry.lock')){[WowReleaseV1.Secure]::NewFile((Join-Path $reg $name),[Text.Encoding]::UTF8.GetBytes('{"active":"release-a","sequence":1}'),$false)}
[WowReleaseV1.Secure]::Atomic((Join-Path $reg 'state.json'),'{"schemaVersion":1,"phase":"stable","transaction":null,"active":"release-a","sequence":1}',$false)
$versions=Join-Path $parent 'versions';[WowReleaseV1.Secure]::NewDirectory($versions,$false)
$code=Join-Path $versions 'synthetic-r4';[WowReleaseV1.Secure]::NewDirectory($code,$false)
$codeFiles=@(foreach($name in @('Collect-Telemetry.Core.ps1','Release.Contract.psm1','Release.Native.cs','Run-TelemetryWorker.ps1','Transport.Helpers.cs','collector-policy.json')){$p=Join-Path $code $name;[WowReleaseV1.Secure]::NewFile($p,[Text.Encoding]::UTF8.GetBytes('synthetic never-executed code'),$false);[pscustomobject]@{name=$name;bytes=(Get-Item $p).Length;sha256=(Hash $p)}})
$catalog=[ordered]@{schemaVersion=1;contractVersion=1;collectorVersion='synthetic-r4';files=$codeFiles}
[WowReleaseV1.Secure]::NewFile((Join-Path $code 'collector-code.json'),[Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $catalog -Depth 5)),$false)
$pointer=[ordered]@{schemaVersion=1;contractVersion=1;collectorVersion='synthetic-r4';codeManifestSHA256=(Hash (Join-Path $code 'collector-code.json'))}
[WowReleaseV1.Secure]::NewFile((Join-Path $parent 'collector-current.json'),[Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $pointer)),$false)
$savedHost=(Get-Item Function:\Get-BoundaryHostSnapshot).ScriptBlock
$savedPool=(Get-Item Function:\Get-AppPoolProcessCandidates).ScriptBlock
function Get-BoundaryHostSnapshot {[pscustomobject]@{Purpose='Synthetic only'}}
function Get-AppPoolProcessCandidates {return @()}
try{
    $baseline=Snapshot -Operation NativeVerify -CollectorRoot $parent
    [WowReleaseV1.Secure]::Atomic((Join-Path $reg 'last-sample.json'),'{"sample":2}',$false)
    [WowReleaseV1.Secure]::Atomic((Join-Path $reg 'collector-diagnostic.json'),'{"stage":"published"}',$false)
    $locked=[IO.File]::Open((Join-Path $reg 'registry.lock'),[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    try{Case 'SAMPLE_DIAGNOSTIC_EXCLUSIVE_LOCK_ACCEPTED' {AssertSnapshotSame $baseline (Snapshot -Operation NativeVerify -CollectorRoot $parent)} $true}finally{$locked.Dispose()}
    foreach($relative in @('state.json','manifests\release-a.json','proofs\release-a.json','approvals\release-a.json')){
        $p=Join-Path $reg $relative;$saved=[IO.File]::ReadAllText($p)
        $changed=if($relative -ceq 'state.json'){'{"schemaVersion":1,"phase":"stable","transaction":null,"active":"release-b","sequence":2}'}else{'{"changed":true}'}
        [WowReleaseV1.Secure]::Atomic($p,$changed,$false)
        Case ('PROTECTED_REGISTRY_CHANGE_REFUSED_'+$relative) {AssertSnapshotSame $baseline (Snapshot -Operation NativeVerify -CollectorRoot $parent)} $false
        [WowReleaseV1.Secure]::Atomic($p,$saved,$false)
    }
    . (Join-Path $PSScriptRoot 'Test-SnapshotProfiles.ps1')
}finally{Set-Item Function:\Get-BoundaryHostSnapshot -Value $savedHost;Set-Item Function:\Get-AppPoolProcessCandidates -Value $savedPool}
$report=[pscustomobject]@{Host=$env:COMPUTERNAME;PowerShell=$PSVersionTable.PSVersion.ToString();Cases=$cases.ToArray();Count=$cases.Count;Failed=@($cases|Where-Object {-not $_.Pass}).Count;RealTaskAPI='Separate retained QA evidence; not mocked by this test';Models='Only host/AppPool probes and protocol captures substituted; real Snapshot, private registry code and ACL functions used';NativeVerify='NOT_RUN';Fixture='NOT_RUN';AccountOperations='NOT_RUN';CompletedUtc=[DateTime]::UtcNow.ToString('o')}
[IO.File]::WriteAllText($ResultPath,($report|ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($true))
$report|Select-Object Count,Failed,NativeVerify,Fixture|ConvertTo-Json
if($report.Failed){exit 1}else{exit 0}
