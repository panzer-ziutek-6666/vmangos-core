[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidateSet('Verify','Fixture')][string]$Phase,
    [string]$VerifyReceipt='',
    [switch]$Execute
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$base=$PSScriptRoot
. (Join-Path $base 'Boundary.Common.ps1')
. (Join-Path $base 'NativeVerifyProtocol.ps1')
. (Join-Path $base 'Attempt.Journal.ps1')
$attempt=$null;$contract=$null
$operation=if($Phase -ceq 'Verify'){'NativeVerify'}else{'Fixture'}
if(-not $Execute){
    Write-Output ('PREPARED_ONLY Phase='+$Phase+'; no task/native/fixture started. Requires separately reviewed A154 one-EXE fixture update and -Execute.')
    exit 0
}
$root='C:\VMANGOS-Accounts-Boundary-R4-20261027-2355-'+$Phase
$taskName='VMANGOS-BOUNDARY-R4-20261027-2355-'+$Phase
$runId=[Guid]::NewGuid().ToString('N')
$task=$null;$folder=$null;$scheduler=$null;$taskCreated=$false;$requested=$false;$ok=$false;$result=$null;$before=$null;$installBefore=$null;$runRootCreated=$false;$writer=$null;$stage='PREFLIGHT';$failure=$null;$locked=$false
$log='C:\GRY\wow\diagnostics\ACCOUNTS-BOUNDARY-R4-'+$Phase+'-'+[DateTime]::Now.ToString('yyyyMMdd-HHmmss-ffffff')+'.log'
function Audit([string]$Text){if($null -ne $script:attempt){Write-AttemptLog $script:attempt $Text}else{Write-Host $Text}}
try{
    $attempt=Begin-Attempt -Operation $operation -Root $root -LogPath $log -SourceScript $PSCommandPath;$runRootCreated=$true
    CheckHost
    $contract=JsonFile (Join-Path $base 'Boundary.Contract.json');CheckContract $contract
    # Compile an unchanged retained IO/capture helper only. No native candidate entrypoint here.
    CheckPayloadPins $contract $base
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $base 'OwnedCapture.cs'))) -Language CSharp -ReferencedAssemblies 'System.dll','System.Core.dll','System.Xml.dll','System.Security.dll','System.IO.Compression.dll'
    Audit ('SCRIPT='+$PSCommandPath+' SHA256='+(Hash $PSCommandPath)+' PHASE='+$Phase+' MODE=ISOLATED_BOUNDARY')
    Audit 'No production install, old-task enable, SOAP/SQL/HTTP, service/IIS control or account operation. Only new private task/own processes and synthetic storage in the existing isolated fixture.'
    Need ($PSCommandPath -ceq (Join-Path $base 'Invoke-AccountsBoundary.ps1')) 'ACTUAL_SCRIPT_PATH'
    CheckPins $contract.InstallPins
    CheckPins (JsonFile (Join-Path $base 'DotnetPins.json')) -Mtime
    # A154 pins its one existing synthetic root, not an arbitrary relocated copy.
    Need ($contract.InstalledExe -ceq 'C:\VMANGOS-Accounts-Fixture-A139-1f07880aecf4453d8e77d99dc8fa3f7d\bootstrap\Vmangos.Accounts.Bootstrap.exe') 'FIXED_NATIVE_PATH'
    Need ($contract.BootstrapSHA256 -ceq '280D22B56A54962221AFBDB4039D53C1BB25E29EBA0BCB529A90FF08716EA621') 'APPROVED_A154_ONLY'
    if($Phase -ceq 'Fixture'){
        Need ($VerifyReceipt -ceq 'C:\VMANGOS-Accounts-Boundary-R4-20261027-2355-Verify\RECEIPT.json') 'SEPARATE_VERIFY_RECEIPT_REQUIRED'
        AssertPrivate ([IO.Path]::GetDirectoryName($VerifyReceipt)) -Directory;AssertPrivate $VerifyReceipt
        $null=Assert-AttemptSuccess ([IO.Path]::GetDirectoryName($VerifyReceipt)) 'NativeVerify'; $previous=JsonFile $VerifyReceipt
        Need ($previous.Ok -and $previous.Phase -ceq 'Verify' -and $previous.BootstrapSHA256 -ceq $contract.BootstrapSHA256 -and $previous.ContractSHA256 -ceq (Hash (Join-Path $base 'Boundary.Contract.json'))) 'VERIFY_RECEIPT_NOT_PASS_OR_DIFFERENT_INPUTS'
        $verifyResult=Join-Path ([IO.Path]::GetDirectoryName($VerifyReceipt)) 'SYSTEM-RESULT.json'
        AssertPrivate $verifyResult;Need ((Hash $verifyResult) -ceq $previous.SystemResultSHA256) 'VERIFY_RESULT_CHANGED'
        $vr=JsonFile $verifyResult;Need ($vr.Ok -and $vr.RunId -ceq $previous.RunId -and $vr.UserSid -ceq 'S-1-5-18' -and $vr.SessionId -eq 0) 'VERIFY_SYSTEM_RESULT'
        $null=ReadCapture 'Verify' $vr.Native
        foreach($relative in @('private','ready.json')){Need (-not (Test-Path -LiteralPath (Join-Path $contract.FixtureRoot $relative))) ('FIXTURE_ALREADY_INITIALIZED_OR_PARTIAL '+$relative)}
    }
    $before=Snapshot -Operation $operation;$installBefore=SnapshotInstall $contract
    PutJson (Join-Path ([IO.Path]::GetDirectoryName($log)) ([IO.Path]::GetFileNameWithoutExtension($log)+'-PRE.json')) $before
    $scheduler=New-Object -ComObject Schedule.Service;$scheduler.Connect();$folder=$scheduler.GetFolder('\')
    foreach($candidateTask in @($folder.GetTasks(1))){Need ($candidateTask.Name -cne $taskName) 'TASK_ALREADY_EXISTS_NO_RETRY'}
    # Exclusive root creation is the durable attempt marker. No overwrite/deletion/retry.
    $copied=@()
    foreach($name in @('Boundary.Common.ps1','Registry.Pins.ps1','Release.Native.cs','NativeVerifyProtocol.ps1','OwnedCapture.cs','SYSTEM-BOUNDARY.ps1','Boundary.Contract.json','DotnetPins.json','Task.Security.ps1','Task.Token.cs')){
        $destination=Join-Path $root $name;PutPrivate $destination ([IO.File]::ReadAllBytes((Join-Path $base $name)));AssertPrivate $destination
        Need ((Hash $destination) -ceq (Hash (Join-Path $base $name))) ('COPY_VERIFY '+$name);$copied+=Pin $destination
    }
    $config=[pscustomobject]@{Root=$root;TaskName=$taskName;RunId=$runId;Phase=$Phase;RequiredAppPool=$before.Invariant.RequiredAppPool;PayloadPins=$copied;DeadlineUtc=[DateTime]::UtcNow.AddSeconds(480).ToString('o')}
    PutJson (Join-Path $root 'RUN.json') $config;PutJson (Join-Path $root 'PRE-INSTALL.json') $installBefore;PutJson (Join-Path $root 'PRE-HOST.json') $before
    $stage='REGISTER_NEW_DISABLED_TASK'
    $definition=$scheduler.NewTask(0);$definition.RegistrationInfo.Description=$runId;$definition.RegistrationInfo.Author='WOW-SRV boundary review'
    $definition.Principal.UserId='S-1-5-18';$definition.Principal.LogonType=5;$definition.Principal.RunLevel=1
    $settings=$definition.Settings;$settings.Enabled=$false;$settings.AllowDemandStart=$true;$settings.Hidden=$true;$settings.MultipleInstances=2
    $settings.StartWhenAvailable=$false;$settings.WakeToRun=$false;$settings.DisallowStartIfOnBatteries=$false;$settings.StopIfGoingOnBatteries=$false
    $settings.AllowHardTerminate=$true;$settings.ExecutionTimeLimit='PT10M';Need ($settings.RestartCount -eq 0 -and $definition.Triggers.Count -eq 0) 'NEW_TASK_NO_RESTART'
    $action=$definition.Actions.Create(0);$action.Path='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
    $action.Arguments='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$root+'\SYSTEM-BOUNDARY.ps1"';$action.WorkingDirectory=$root
    $task=Register-BoundaryTask -Folder $folder -Name $taskName -Definition $definition -RunId $runId -Mode Create -EvidenceRoot $root;$taskCreated=$true
    Need (-not $task.Enabled -and $task.GetInstances(0).Count -eq 0 -and $task.LastTaskResult -eq 267011) 'TASK_NOT_FRESH'
    AssertPrivate ('C:\Windows\System32\Tasks\'+$taskName)
    PutJson (Join-Path $root 'TASK-BEFORE.json') @{Xml=[string]$task.Xml;Sddl=$task.GetSecurityDescriptor(7)}
    AssertSnapshotSame $before (Snapshot -Operation $operation);CheckPins $contract.InstallPins
    $stage='REQUEST_ONCE';$task.Enabled=$true;$requested=$true;$running=$task.Run($null)
    Audit ('REQUESTED_ONCE Task='+$taskName+' Root='+$root)
    $timer=[Diagnostics.Stopwatch]::StartNew();$lastProgress=-30
    while($timer.Elapsed.TotalSeconds -lt 520){
        $task=$folder.GetTask($taskName)
        if($task.GetInstances(0).Count -eq 0 -and $task.LastTaskResult -notin @(267011,267009) -and ([datetime]$task.LastRunTime).Year -ge 2026){break}
        if($timer.Elapsed.TotalSeconds-$lastProgress -ge 30){Audit ('WAIT seconds='+[int]$timer.Elapsed.TotalSeconds);$lastProgress=$timer.Elapsed.TotalSeconds}
        Start-Sleep -Milliseconds 500
    }
    Need ($task.GetInstances(0).Count -eq 0 -and $task.LastTaskResult -eq 0) ('TASK_FAIL_OR_TIMEOUT Code='+$task.LastTaskResult)
    $stage='INDEPENDENT_RESULT_VERIFIER'
    $resultPath=Join-Path $root 'SYSTEM-RESULT.json';AssertPrivate $resultPath;$result=JsonFile $resultPath
    Audit ('SYSTEM_RESULT='+(ConvertTo-Json -InputObject $result -Depth 12 -Compress))
    Need ($result.Schema -ceq 'ACCOUNTS-BOUNDARY-1' -and $result.RunId -ceq $runId -and $result.Phase -ceq $Phase -and $result.Ok -and
        $result.SelfDisabled -and $result.NativeAttempted -and $result.UserSid -ceq 'S-1-5-18' -and $result.SessionId -eq 0 -and $result.LiveConnections -eq 0 -and -not $result.IisPipelineTested -and -not $result.CreateAccountLiveReady) 'SYSTEM_RESULT_INVALID'
    $null=ReadCapture $Phase $result.Native
    CheckPins $contract.InstallPins;CheckPins (JsonFile (Join-Path $base 'DotnetPins.json')) -Mtime
    $postHost=Snapshot -Operation $operation;$postInstall=SnapshotInstall $contract
    PutJson (Join-Path $root 'POST-HOST.json') $postHost;PutJson (Join-Path $root 'POST-INSTALL.json') $postInstall
    AssertSnapshotSame $before $postHost;AssertSame $installBefore $postInstall
    $ok=$true
}catch{$failure=[pscustomobject]@{Stage=$stage;Message=$_.Exception.Message;Line=$_.InvocationInfo.ScriptLineNumber};Audit ('FAIL='+(ConvertTo-Json -InputObject $failure -Compress))}
finally{
    if($runRootCreated -and $null -eq $result -and (Test-Path (Join-Path $root 'SYSTEM-RESULT.json'))){
        try{$result=JsonFile (Join-Path $root 'SYSTEM-RESULT.json');Audit ('SYSTEM_RESULT_AFTER_FAILURE='+(ConvertTo-Json -InputObject $result -Depth 12 -Compress))}catch{Audit ('READ_RESULT_FAIL='+$_.Exception.Message)}
    }
    if($taskCreated){
        try{
            $task=$folder.GetTask($taskName);Need ($task.Definition.RegistrationInfo.Description -ceq $runId) 'FINAL_TASK_IDENTITY'
            $task.Enabled=$false
            Need ($task.GetInstances(0).Count -eq 0) 'OWN_TASK_STILL_RUNNING_PRESERVE_NO_RETRY'
            $d=$task.Definition;$d.Settings.Enabled=$false;$d.Settings.AllowDemandStart=$false
            $task=Register-BoundaryTask -Folder $folder -Name $taskName -Definition $d -RunId $runId -Mode Lock -EvidenceRoot $root
            Need (-not $task.Enabled -and -not $task.Definition.Settings.AllowDemandStart) 'FINAL_LOCK';$locked=$true
        }catch{$ok=$false;Audit ('FINAL_TASK_FAIL='+$_.Exception.Message)}
    }
    if($null -ne $before){try{AssertSnapshotSame $before (Snapshot -Operation $operation);AssertSame $installBefore (SnapshotInstall $contract)}catch{$ok=$false;Audit ('FINAL_INVARIANT_FAIL='+$_.Exception.Message)}}
    if($runRootCreated){
        try{PutJson (Join-Path $root 'RECEIPT.json') ([pscustomobject]@{Schema='ACCOUNTS-BOUNDARY-RECEIPT-1';Ok=($ok -and $locked);Phase=$Phase;RunId=$runId;TaskName=$taskName;RequestedOnce=$requested;TaskDisabledNoDemand=$locked;BootstrapSHA256=$contract.BootstrapSHA256;ContractSHA256=(Hash (Join-Path $base 'Boundary.Contract.json'));SystemResultSHA256=$(if(Test-Path (Join-Path $root 'SYSTEM-RESULT.json')){Hash (Join-Path $root 'SYSTEM-RESULT.json')}else{''});Failure=$failure;Log=$log;CompletedUtc=[DateTime]::UtcNow.ToString('o');IisPipelineTested=$false;LiveReady=$false})}catch{$ok=$false;Audit ('RECEIPT_FAIL='+$_.Exception.Message)}
    }
    Audit ('OK='+($ok -and $locked)+' LOG='+$log+'; no automatic retry/delete/rollback.')
    if($null -ne $attempt){Complete-Attempt $attempt ($ok -and $locked) $failure @{Phase=$Phase;TaskCreated=$taskCreated;NativeRequested=$requested;TaskLocked=$locked;ReceiptCreated=(Test-Path (Join-Path $root 'RECEIPT.json'))}}
}
if($ok -and $locked){exit 0}else{exit 1}
