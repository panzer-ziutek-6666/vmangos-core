#requires -Version 5.1
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if($env:COMPUTERNAME -cne 'WOW-SRV' -or $PSVersionTable.PSEdition -cne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or -not [Environment]::Is64BitProcess){throw 'WORKER_CONTEXT_INVALID'}
$id=[Security.Principal.WindowsIdentity]::GetCurrent();try{if($id.User.Value -cne 'S-1-5-18'){throw 'WORKER_REQUIRES_SYSTEM'}}finally{$id.Dispose()}
function BootstrapPrivate([string]$Path,[bool]$Directory){
    $full=[IO.Path]::GetFullPath($Path);if($full -cne $Path){throw 'BOOTSTRAP_CANONICAL'};$p=$Path
    while($p){if(Test-Path -LiteralPath $p){if((Get-Item -LiteralPath $p -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'BOOTSTRAP_REPARSE'}};$p=[IO.Path]::GetDirectoryName($p)}
    $acl=Get-Acl -LiteralPath $Path;$owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value;$rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
    if(-not $acl.AreAccessRulesProtected -or $owner -notin @('S-1-5-18','S-1-5-32-544') -or $rules.Count -ne 2){throw 'BOOTSTRAP_PRIVATE_ACL'}
    $sids=@();foreach($r in $rules){$expected=[Security.AccessControl.InheritanceFlags]::None;if($Directory){$expected=[Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit};if($r.IsInherited -or $r.AccessControlType -ne 'Allow' -or $r.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl -or $r.InheritanceFlags -ne $expected -or $r.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None){throw 'BOOTSTRAP_PRIVATE_ACL'};$sids+=$r.IdentityReference.Value}
    if((@($sids|Sort-Object) -join ',') -cne 'S-1-5-18,S-1-5-32-544'){throw 'BOOTSTRAP_PRIVATE_ACL'}
}
BootstrapPrivate $PSScriptRoot $true;$codePath=Join-Path $PSScriptRoot 'collector-code.json';BootstrapPrivate $codePath $false
$code=Get-Content -LiteralPath $codePath -Raw|ConvertFrom-Json
if($code.schemaVersion -ne 1 -or $code.contractVersion -ne 1 -or $PSScriptRoot -cne ('C:\ProgramData\VMANGOS\AdminPanelCollector\versions\'+$code.collectorVersion)){throw 'WORKER_CODE_CONTRACT'}
$expectedNames='Collect-Telemetry.Core.ps1,Release.Contract.psm1,Release.Native.cs,Run-TelemetryWorker.ps1,Transport.Helpers.cs,collector-policy.json'
if((@($code.files.name|Sort-Object) -join ',') -cne (@($expectedNames.Split(',')|Sort-Object) -join ',')){throw 'WORKER_CODE_FILE_SET'}
foreach($row in @($code.files)){if($row.name -cnotmatch '^[A-Za-z0-9_.-]+$'){throw 'WORKER_CODE_PATH'};$f=Join-Path $PSScriptRoot $row.name;BootstrapPrivate $f $false;if((Get-Item -LiteralPath $f).Length -ne $row.bytes -or (Get-FileHash -LiteralPath $f).Hash -cne $row.sha256){throw 'WORKER_CODE_HASH'}}
Import-Module (Join-Path $PSScriptRoot 'Release.Contract.psm1') -DisableNameChecking
[void][WowReleaseV1.Secure]::Read($codePath,$false)
$policy=([WowReleaseV1.Secure]::Read((Join-Path $PSScriptRoot 'collector-policy.json'),$false)|ConvertFrom-Json)
if($policy.schemaVersion -ne 1 -or $policy.contractVersion -ne 1){throw 'WORKER_POLICY'}
if('VmangosPackageA73.Boundary' -as [type]){throw 'WORKER_REQUIRES_FRESH_PROCESS'}
Add-Type -Path (Join-Path $PSScriptRoot 'Transport.Helpers.cs') -ReferencedAssemblies 'System.dll','System.Core.dll','System.Xml.dll','System.Security.dll'
$ctx=New-ReleaseContext $policy.registryRoot $policy.runtimeRoot $policy.snapshotPath
[VmangosPackageA73.Boundary]::Verify($policy.stateRoot,$true,$false)
$lockPath=Join-Path $policy.stateRoot 'collector.lock';if(-not [IO.File]::Exists($lockPath)){[VmangosPackageA73.Boundary]::NewFile($lockPath,[byte[]]@(),$false)}
[VmangosPackageA73.Boundary]::Verify($lockPath,$false,$false)
$workerLock=[IO.File]::Open($lockPath,'Open','ReadWrite','None')
$engine=Join-Path $PSScriptRoot 'Collect-Telemetry.Core.ps1'
try{while(-not [IO.File]::Exists((Join-Path $policy.stateRoot 'stop.request'))){
    $began=[DateTimeOffset]::UtcNow;$outcome='error';$failure=$null;$script:WorkerStage='release-collector';$cause=$null
    try{
        $result=Invoke-ManifestCollector $ctx -GetProcesses {Get-CoreProcessPair} -ReadSample {
            param($manifest)
            $plain=$null;$secret=$null;$secure=$null
            try{
                # This is the only SOAP decryption path, reached only by the future
                # installed SYSTEM worker. Preparation/tests never invoke it.
                $script:WorkerStage='credential-boundary';$plain=[VmangosPackageA73.Boundary]::Unprotect($policy.secretPath);$secret=ConvertFrom-Json -InputObject $plain
                if(@($secret.PSObject.Properties).Count -ne 3 -or $secret.schemaVersion -ne 1 -or $secret.username -isnot [string] -or $secret.password -isnot [string] -or $secret.username.Length -lt 1 -or $secret.username.Length -gt 128 -or $secret.password.Length -lt 1 -or $secret.password.Length -gt 512 -or $secret.username -match '[\x00\r\n]' -or $secret.password -match '[\x00\r\n]'){throw 'WORKER_CREDENTIAL_SHAPE'}
                $secure=New-Object Security.SecureString;foreach($c in $secret.password.ToCharArray()){$secure.AppendChar($c)};$secure.MakeReadOnly();$credential=New-Object Management.Automation.PSCredential($secret.username,$secure)
                $secret.password='';$secret.username='';$plain=$null;$secret=$null
                $script:WorkerStage='engine';$r=& $engine -OutputPath $policy.snapshotPath -SoapCredential $credential -ReleaseManifest $manifest -RegistryContext $ctx -CollectorPolicy $policy
                if($null -eq $r -or -not $r.PrivateCredentialsRemoved -or $r.SqlAttempts -gt 3){throw 'WORKER_TRANSPORT_RESULT'}
                $script:WorkerStage='validation-publication';return $r.Snapshot
            }finally{if($null -ne $secure){$secure.Dispose()};if($null -ne $secret){$secret.password='';$secret.username=''};$plain=$null;$secret=$null;$credential=$null}
        }
        $outcome=$result.State;$script:WorkerStage='complete'
    }catch{$failure=$_.Exception.GetType().Name;$cause='UNCLASSIFIED_SUPPRESSED';if($_.Exception.Message -cmatch '^(RELEASE|BUILD|COLLECTOR|WORLD|SOAP|MYSQL|WORKER)_[A-Z0-9_]{1,90}$'){$cause=$_.Exception.Message};try{Set-ReleaseUnavailable $ctx}catch{}}
    [VmangosPackageA73.Boundary]::AtomicWrite((Join-Path $policy.stateRoot 'worker-diagnostic.json'),(ConvertTo-Json -InputObject ([ordered]@{schemaVersion=1;collectorVersion=$code.collectorVersion;stage=$script:WorkerStage;cause=$cause;exceptionClass=$failure;observedUtc=[DateTimeOffset]::UtcNow.ToString('o')}) -Compress),$false)
    $last=[ordered]@{schemaVersion=1;workerState='running';sampleState=$outcome;collectorVersion=$code.collectorVersion;contractVersion=1;startedUtc=$began.ToString('o');completedUtc=[DateTimeOffset]::UtcNow.ToString('o');failureClass=$failure;detailsSuppressed=$true}
    [VmangosPackageA73.Boundary]::AtomicWrite((Join-Path $policy.stateRoot 'last-run.json'),(ConvertTo-Json -InputObject $last -Compress),$false)
    for($tick=0;$tick -lt 10;$tick++){if([IO.File]::Exists((Join-Path $policy.stateRoot 'stop.request'))){break};Start-Sleep -Seconds 1}
}}finally{$workerLock.Dispose()}
