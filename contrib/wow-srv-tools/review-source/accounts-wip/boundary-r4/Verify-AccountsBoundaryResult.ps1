[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateSet('Verify','Fixture')][string]$Phase)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Boundary.Common.ps1')
. (Join-Path $PSScriptRoot 'NativeVerifyProtocol.ps1')
. (Join-Path $PSScriptRoot 'Attempt.Journal.ps1')
CheckHost
$root='C:\VMANGOS-Accounts-Boundary-R4-20261027-2355-'+$Phase
$operation=if($Phase -ceq 'Verify'){'NativeVerify'}else{'Fixture'}
$null=Assert-AttemptSuccess $root $operation
AssertPrivate $root -Directory
foreach($name in @('RECEIPT.json','SYSTEM-RESULT.json','PRE-HOST.json','POST-HOST.json','PRE-INSTALL.json','POST-INSTALL.json','RUN.json')){AssertPrivate (Join-Path $root $name)}
$receipt=JsonFile (Join-Path $root 'RECEIPT.json');$result=JsonFile (Join-Path $root 'SYSTEM-RESULT.json');$run=JsonFile (Join-Path $root 'RUN.json')
$contract=JsonFile (Join-Path $PSScriptRoot 'Boundary.Contract.json')
CheckContract $contract
CheckPayloadPins $contract $PSScriptRoot
Need ($receipt.Schema -ceq 'ACCOUNTS-BOUNDARY-RECEIPT-1' -and $receipt.Ok -and $receipt.Phase -ceq $Phase -and $receipt.RequestedOnce -and $receipt.TaskDisabledNoDemand -and
    $receipt.ContractSHA256 -ceq (Hash (Join-Path $PSScriptRoot 'Boundary.Contract.json')) -and $receipt.BootstrapSHA256 -ceq $contract.BootstrapSHA256 -and
    $receipt.SystemResultSHA256 -ceq (Hash (Join-Path $root 'SYSTEM-RESULT.json'))) 'RECEIPT_CONTRACT'
Need ($result.Ok -and $result.Phase -ceq $Phase -and $result.RunId -ceq $receipt.RunId -and $run.RunId -ceq $receipt.RunId -and $run.Root -ceq $root -and
    $result.UserSid -ceq 'S-1-5-18' -and $result.SessionId -eq 0 -and $result.SelfDisabled -and $result.NativeAttempted -and $result.LiveConnections -eq 0 -and
    -not $result.IisPipelineTested -and -not $result.CreateAccountLiveReady) 'SYSTEM_IDENTITY_RESULT'
$null=ReadCapture $Phase $result.Native
AssertSnapshotSame (JsonFile (Join-Path $root 'PRE-HOST.json')) (JsonFile (Join-Path $root 'POST-HOST.json'))
AssertSnapshotSame (JsonFile (Join-Path $root 'POST-HOST.json')) (Snapshot -Operation $operation)
AssertSame (JsonFile (Join-Path $root 'PRE-INSTALL.json')) (JsonFile (Join-Path $root 'POST-INSTALL.json'))
CheckPins $contract.InstallPins
$service=New-Object -ComObject Schedule.Service;$service.Connect();$task=$service.GetFolder('\').GetTask($receipt.TaskName)
Need ($task.Definition.RegistrationInfo.Description -ceq $receipt.RunId -and -not $task.Enabled -and -not $task.Definition.Settings.AllowDemandStart -and
    $task.GetInstances(0).Count -eq 0 -and $task.LastTaskResult -eq 0) 'TASK_FINAL_STATE'
$null=Get-BoundaryTaskSecurityEvidence $task $receipt.TaskName $receipt.RunId $false
[pscustomobject]@{Verification='PASS';Phase=$Phase;Receipt=(Join-Path $root 'RECEIPT.json');SystemResultSHA256=$receipt.SystemResultSHA256;IisPipelineTested=$false;LiveReady=$false} | ConvertTo-Json
