Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Assert-KitAck($Value,[string]$Step){
 if($null -eq $Value -or @($Value).Count -ne 1 -or $Value.OK -isnot [bool] -or !$Value.OK){throw ('UNKNOWN_OR_FAILED_STEP '+$Step)}
}
function Invoke-KitSequence([string[]]$Steps,[hashtable]$Driver,$Receipt){
 foreach($name in @('Save','Observe','Barrier')+$Steps){if(!$Driver.ContainsKey($name) -or $Driver[$name] -isnot [scriptblock]){throw ('DRIVER_MISSING '+$name)}}
 $Receipt.Result='IN_PROGRESS';$Receipt.MutationBegun=$false;$barrierAttempted=$false
 try{
  foreach($step in $Steps){
   if($step -ceq 'Gate'){$Receipt.MutationBegun=$true}
   $Receipt.Phase=$step;& $Driver.Save $Receipt
   $ack=& $Driver[$step]
   Assert-KitAck $ack $step
   $Receipt.Completed+=@($step);& $Driver.Save $Receipt
  }
  $Receipt.Result='PASS';$Receipt.Phase='Complete'
 }catch{
  $Receipt.Result='FAIL_CLOSED';$Receipt.Error=$_.Exception.Message
  if($Receipt.MutationBegun){$barrierAttempted=$true;try{& $Driver.Barrier $Receipt}catch{$Receipt.BarrierError=$_.Exception.Message}}
  throw
  }finally{
  try{& $Driver.Observe $Receipt}catch{
   $Receipt.Result='UNKNOWN_OBSERVATION';$Receipt.ObservationError=$_.Exception.Message
   if($Receipt.MutationBegun -and !$barrierAttempted){$barrierAttempted=$true;try{& $Driver.Barrier $Receipt}catch{$Receipt.BarrierError=$_.Exception.Message}}
  }
  try{& $Driver.Save $Receipt}catch{
   $Receipt.Result='UNKNOWN_RECEIPT';$Receipt['ReceiptError']=$_.Exception.Message
   if($Receipt.MutationBegun -and !$barrierAttempted){$barrierAttempted=$true;try{& $Driver.Barrier $Receipt}catch{$Receipt.BarrierError=$_.Exception.Message}}
   throw
  }
 }
 if($Receipt.Result -cne 'PASS'){throw 'FINAL_OBSERVATION_NOT_CONFIRMED'}
 return $Receipt
}
function Get-KitSteps([string]$Kind){
 switch($Kind){
  'DevSetup' {@('Guard','ValidateInputs','Gate','LogicalBackup','DevDirectories','DevArtifacts','DevConfigs','InitializeDevData','CreateDevServices','StartDevMySQL','AttestDevEndpoint','ImportDevCopy','RestrictDevRealm','VerifyDevEnvironment')}
  'DevAccept' {@('Guard','ValidateInputs','AttestDevEnvironment','Gate','StartMySQL','StartRealm','StartWorld','DevReady','StopWorld','StopRealm','DevFinalWrites','StopMySQL','VerifyDevAcceptance')}
  'Migrate' {@('Guard','ValidateInputs','Gate','BackupFiles','StageController','RegisterRelease','BeginTransition','StopWorld','StopRealm','LogicalBackup','StopMySQL','WriteBinaries','VerifyPair','WriteReceipts','WriteRoutes','StartMySQL','StartRealm','StartWorld','Ready','RequestCommit','Samples','PublishBundle','RestoreTasks','VerifyMigration')}
  'Rollback' {@('Guard','ValidateInputs','Gate','BackupCurrent','RevokeCapability','BeginRollback','StopWorld','StopRealm','LogicalBackup','StopMySQL','RestoreFiles','VerifyRollbackPair','RestoreRoutes','RequestCommit','RestoreTasksStopped','VerifyRollbackStopped')}
  'Lifecycle' {@('Guard','ValidateInputs','Gate','StopWorld','StopRealm','StopMySQL','StartMySQL','StartRealm','StartWorld','Ready','Samples','RestoreTasks','VerifyLifecycle')}
  default {throw ('UNSUPPORTED_WORKFLOW '+$Kind)}
 }
}
Export-ModuleMember -Function Invoke-KitSequence,Get-KitSteps,Assert-KitAck
