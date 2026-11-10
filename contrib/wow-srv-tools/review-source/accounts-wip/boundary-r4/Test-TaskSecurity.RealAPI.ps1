[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Boundary.Common.ps1')
CheckHost
$qaRoot='C:\VMANGOS-Accounts-Boundary-R4-TaskSecurity-QA-20261027-2355'
$taskName='VMANGOS-BOUNDARY-R4-20261027-2355-SECURITY-QA'
$runId=[Guid]::NewGuid().ToString('N')
$log='C:\GRY\wow\diagnostics\ACCOUNTS-BOUNDARY-PREP-R4-TASK-QA-'+[DateTime]::Now.ToString('yyyyMMdd-HHmmss-ffffff')+'.log'
Need (-not (Test-Path -LiteralPath $qaRoot)) 'QA_ALREADY_ATTEMPTED_NO_RETRY'
$scheduler=New-Object -ComObject Schedule.Service;$scheduler.Connect();$folder=$scheduler.GetFolder('\')
Need (@($folder.GetTasks(1)|Where-Object Name -CEQ $taskName).Count -eq 0) 'QA_TASK_ALREADY_EXISTS_NO_RETRY'
Initialize-RegistrySecurity
[WowReleaseV1.Secure]::NewDirectory($qaRoot,$false)
Add-Type -AssemblyName System.IO.Compression
Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'OwnedCapture.cs'))) -Language CSharp -ReferencedAssemblies 'System.dll','System.Core.dll','System.Xml.dll','System.Security.dll','System.IO.Compression.dll'
Start-Transcript -LiteralPath $log -NoClobber|Out-Null
$ok=$false;$failure=$null;$before=$null;$installBefore=$null;$post=$null;$final=$null
try{
    PutJson (Join-Path $qaRoot 'CLAIM.json') @{Name=$taskName;RunId=$runId;Purpose='Disabled-only real Task Scheduler security API; never Run/Enabled=True';RequestedUtc=[DateTime]::UtcNow.ToString('o')}
    $contract=JsonFile (Join-Path $PSScriptRoot 'Boundary.Contract.json');CheckContract $contract;CheckPayloadPins $contract $PSScriptRoot;CheckPins $contract.InstallPins
    $tokenBefore=Get-BoundaryTaskToken;Assert-BoundaryTaskOwnerLegal $tokenBefore
    PutJson (Join-Path $qaRoot 'TOKEN-BEFORE.json') $tokenBefore
    $before=Snapshot -Operation NativeVerify;$installBefore=SnapshotInstall $contract
    PutJson (Join-Path $qaRoot 'PRE-HOST.json') $before;PutJson (Join-Path $qaRoot 'PRE-INSTALL.json') $installBefore
    $history=@(foreach($root in @('C:\VMANGOS-Accounts-Boundary-R3-20261027-1555-Verify','C:\VMANGOS-Accounts-Bootstrap-Update-R3-20261027-1555')){foreach($file in @(Get-ChildItem -LiteralPath $root -File -Recurse|Sort-Object FullName)){Pin $file.FullName}})
    PutJson (Join-Path $qaRoot 'HISTORY-PINS.json') $history
    $definition=$scheduler.NewTask(0)
    $definition.RegistrationInfo.Description=$runId;$definition.RegistrationInfo.Author='WOW-SRV R4 disabled-only Task Security QA'
    $definition.Principal.UserId='S-1-5-18';$definition.Principal.LogonType=5;$definition.Principal.RunLevel=1
    $settings=$definition.Settings;$settings.Enabled=$false;$settings.AllowDemandStart=$true;$settings.Hidden=$true;$settings.MultipleInstances=2
    $settings.StartWhenAvailable=$false;$settings.WakeToRun=$false;$settings.DisallowStartIfOnBatteries=$false;$settings.StopIfGoingOnBatteries=$false
    $settings.AllowHardTerminate=$true;$settings.ExecutionTimeLimit='PT2M'
    $action=$definition.Actions.Create(0);$action.Path='C:\Windows\System32\cmd.exe';$action.Arguments='/d /c exit 0';$action.WorkingDirectory='C:\Windows\System32'
    Write-Output 'CREATE_DISABLED_ONLY: no triggers, restart=0, flags58, SYSTEM ServiceAccount; harmless action NEVER RUN.'
    $task=Register-BoundaryTask -Folder $folder -Name $taskName -Definition $definition -RunId $runId -Mode Create -EvidenceRoot $qaRoot
    $created=Get-BoundaryTaskSecurityEvidence ($folder.GetTask($taskName)) $taskName $runId $true
    Need ($created.LastTaskResult -eq 267011 -and ([datetime]$created.LastRunTime).Year -lt 2026) 'QA_HAS_RUN'
    PutJson (Join-Path $qaRoot 'TASK-CREATED.json') $created
    PutPrivate (Join-Path $qaRoot 'TASK-CREATED.xml') ([Text.Encoding]::UTF8.GetBytes($created.Xml))
    $updated=$task.Definition;$updated.Settings.Enabled=$false;$updated.Settings.AllowDemandStart=$false
    Write-Output 'UPDATE_DISABLED_ONLY: same shared registration helper flags60, AllowDemandStart=False; no Run.'
    $task=Register-BoundaryTask -Folder $folder -Name $taskName -Definition $updated -RunId $runId -Mode Lock -EvidenceRoot $qaRoot
    $final=Get-BoundaryTaskSecurityEvidence ($folder.GetTask($taskName)) $taskName $runId $false
    Need ($final.LastTaskResult -eq 267011 -and ([datetime]$final.LastRunTime).Year -lt 2026) 'QA_HAS_RUN_AFTER_UPDATE'
    PutJson (Join-Path $qaRoot 'TASK-FINAL.json') $final
    PutPrivate (Join-Path $qaRoot 'TASK-FINAL.xml') ([Text.Encoding]::UTF8.GetBytes($final.Xml))
    $tokenAfter=Get-BoundaryTaskToken;AssertSame $tokenBefore $tokenAfter
    PutJson (Join-Path $qaRoot 'TOKEN-AFTER.json') $tokenAfter
    foreach($pin in $history){$actual=Pin $pin.Path;AssertSame $pin $actual}
    $ok=$true
}catch{
    $failure=[pscustomobject]@{Message=$_.Exception.Message;Line=$_.InvocationInfo.ScriptLineNumber;Detail=$_.Exception.ToString()}
    Write-Output ('QA_FAIL='+($failure|ConvertTo-Json -Compress))
}finally{
    try{
        if($null -ne $before){$post=Snapshot -Operation NativeVerify;PutJson (Join-Path $qaRoot 'POST-HOST.json') $post;AssertSnapshotSame $before $post; $afterInstall=SnapshotInstall $contract;PutJson (Join-Path $qaRoot 'POST-INSTALL.json') $afterInstall;AssertSame $installBefore $afterInstall}
    }catch{$ok=$false;Write-Output ('FINAL_INVARIANT_FAIL='+$_.Exception.Message)}
    $result=[pscustomobject]@{Result=$(if($ok){'PASS'}else{'FAIL'});Host=$env:COMPUTERNAME;PowerShell=$PSVersionTable.PSVersion.ToString();RunId=$runId;Name=$taskName;Root=$qaRoot;Log=$log;Failure=$failure;FinalTask=$final;TaskRetainedDisabled=$ok;CallsToRun=0;EnabledTrueAssignments=0;TokenModified=$false;NativeVerify='NOT_RUN';Fixture='NOT_RUN';AccountOperations='NOT_RUN';CompletedUtc=[DateTime]::UtcNow.ToString('o')}
    PutJson (Join-Path $qaRoot 'QA-RESULT.json') $result
    Write-Output ($result|ConvertTo-Json -Depth 8)
    Stop-Transcript|Out-Null
}
if($ok){exit 0}else{exit 1}
