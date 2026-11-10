[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Receipt,[Parameter(Mandatory=$true)][string]$ProcessRecord,[Parameter(Mandatory=$true)][string]$Defaults)
. (Join-Path $PSScriptRoot 'FullProduction.ps1')
$run=NewKitRun 'IndependentVerify' 'Execute';$okay=$false;$v=[ordered]@{Result='FAIL';Deployment='UNKNOWN';Error=$null}
try{
 AssertKitPins;Assert-FullCandidate $run;AssertPrivate $Receipt;Assert-FullPrivateDefaults $run $Defaults;$r=GetJson $Receipt;$p=GetJson $ProcessRecord
 Need ($p.Started -and $p.StreamsCaptured -and $null -ne $p.ExitCode -and $p.ExitCode -eq 0 -and $p.Executable -ceq 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -and $p.Arguments.Contains((Join-Path $PSScriptRoot 'Deploy-FullCandidate.ps1')) -and $p.Arguments.Contains('Execute')) 'MAIN_NATIVE_UNKNOWN_OR_NONZERO'
 Need ($p.PID -eq $r.MainProcess.PID -and ([DateTimeOffset]::Parse($p.CreatedUtc)).UtcTicks -eq ([DateTimeOffset]::Parse($r.MainProcess.CreatedUtc)).UtcTicks) 'MAIN_PROCESS_GENERATION_BINDING'
 Need ($r.Kind -ceq 'Migrate' -and $r.Mode -ceq 'Execute' -and $r.Result -ceq 'PASS' -and $r.Phase -ceq 'Complete' -and $r.PlanSHA256 -ceq $run.Receipt.PlanSHA256 -and ($r.Completed -join '|') -ceq ((Get-FullSteps) -join '|')) 'ALL_PHASES_REQUIRED'
 Need ($null -eq $r.Error -and $null -eq $r.BarrierError -and $null -eq $r.ObservationError) 'EXECUTION_ERRORS'
 LoadProduction $run
 Assert-DependencyStopResult $r.WorldMaintenanceProof.Completion.Outcome 'mangosd'
 foreach($name in @('realmd','VMANGOS-MySQL')){Assert-DependencyStopResult $r.BackendStopProofs.$name $name}
 Need (@($r.BackendStopProofs.'VMANGOS-MySQL'.ProcessExits).Count -eq 2) 'TWO_MYSQL_MEASUREMENTS_REQUIRED'
 foreach($row in $r.FileBackup.Files){if($row.BeforeExists){Need ((Hash $row.Backup) -ceq $row.BeforeSHA256) 'FILE_BACKUP_HASH'}}
 Need ((Hash $r.LogicalBackup.Path) -ceq $r.LogicalBackup.SHA256 -and $r.LogicalBackup.NativeExit -eq 0 -and $r.BackupVerification.Result -ceq 'PASS') 'FRESH_BACKUP_REQUIRED'
 Need ((Hash $r.SQLIndependent.Path) -ceq $r.SQLIndependent.SHA256 -and $r.SQLIndependent.NativeExit -eq 0) 'SQL_INDEPENDENT_HASH'
 $sql=GetJson $r.SQLIndependent.Path;Need ($sql.Result -ceq 'PASS' -and $sql.Operation -ceq $r.Operation) 'SQL_INDEPENDENT_ACCEPTANCE'
 foreach($a in $run.Plan.Artifacts|Where-Object Role -notlike '*.pdb'){Need ((Hash (Join-Path $run.Plan.Runtime ([IO.Path]::GetFileName($a.Path)))) -ceq $a.SHA256) 'ACTIVE_EXE_DLL_HASH'}
 foreach($a in $r.Symbols){Need ((Hash $a.Path) -ceq $a.SHA256) 'SYMBOL_HASH'}
 foreach($c in $run.Plan.FullCandidate.Protection){Need ((Hash $c.Path) -ceq $c.SHA256 -and (Get-Acl $c.Path).Sddl -ceq $c.SDDL) 'CONFIG_PROTECTION'}
 foreach($b in $run.Plan.ServiceBaseline){$s=Get-CimInstance Win32_Service -Filter ("Name='"+$b.Name+"'");Need ($s.PathName -ceq $b.ImagePath -and $s.StartName -ceq $b.Account -and $s.StartMode -ceq $b.StartMode) 'SCM_CONFIG_DRIFT';$reg=Get-ItemProperty ('HKLM:\SYSTEM\CurrentControlSet\Services\'+$b.Name);$h=$null;if($null -ne $reg.PSObject.Properties['FailureActions']){$sha=[Security.Cryptography.SHA256]::Create();try{$h=([BitConverter]::ToString($sha.ComputeHash($reg.FailureActions))).Replace('-','')}finally{$sha.Dispose()}};Need ($h -ceq $b.FailureActionsSHA256) 'SCM_POLICY_DRIFT';$deps=@();if($null -ne $reg.PSObject.Properties['DependOnService']){$deps=@($reg.DependOnService|Sort-Object)};Need (($deps -join '|') -ceq (@($b.Dependencies|Sort-Object) -join '|')) 'SCM_DEPENDENCY_DRIFT'}
 $status=Get-CurrentStatus;Need ($status.Ready -and $status.Services.Mangosd.Generation -cne $r.BeforeIntent.Generation) 'NEW_WORLD_GENERATION_READY'
 $state=Read-ControlState $run.Plan.Maintenance 'mangosd';Need ($state.Phase -ceq 'Stable' -and $state.Generation -ceq $status.Services.Mangosd.Generation) 'MAINTENANCE_NOT_STABLE'
 $run.Receipt.TaskStatesBefore=$r.TaskStatesBefore;AssertControlTasksRestoredR2 $run;AssertTaskBaseline $run;Assert-FullDEVStopped
 foreach($pin in $run.Plan.VersionPins){Need ((Hash $pin.Target) -ceq $pin.SHA256) 'INSTALLED_CONTROLLER_HASH'}
 $bundle=AssertLiveBundle $run;Need ($bundle.Release.id -ceq $run.Plan.CandidateReference.id) 'BUNDLE_RELEASE'
 $run.Receipt.StartedUtc=[DateTimeOffset]::UtcNow.ToString('o');WaitKitSamples $run $run.Plan.CandidateReference
 $run.State.MigrationDefaults=@{Path=$Defaults;SHA256=(Hash $Defaults)};Assert-FullSQLSets $run $true
 $v.Result='PASS';$v.Deployment='DEPLOYED';$v.Operation=$r.Operation;$v.ReceiptSHA256=Hash $Receipt;$v.MainNativeExit=$p.ExitCode;$v.Runtime=$status;$v.SQLProof=$sql;$v.ClientSmoke='NOT_RUN';$v.WindowsReboot='NOT_RUN';$v.SCMRecovery='NOT_PROVEN';$okay=$true
}catch{$v.Error=$_.Exception.ToString()}
finally{PutJson (Join-Path $run.Out 'INDEPENDENT-VERIFIER.json') $v;FinishKit $run $okay 'Review result; no automatic repair or extra service cycle'}
if(!$okay){exit 1}
