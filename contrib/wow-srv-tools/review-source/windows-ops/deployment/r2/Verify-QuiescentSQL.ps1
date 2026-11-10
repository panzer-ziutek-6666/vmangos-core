[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Receipt,[Parameter(Mandatory=$true)][string]$Defaults,[Parameter(Mandatory=$true)][string]$Output)
. (Join-Path $PSScriptRoot 'FullProduction.ps1')
$run=NewKitRun 'SQLVerify' 'Execute';$okay=$false;$result=[ordered]@{Result='FAIL';Operation=$null;ReceiptSHA256=$null;Error=$null}
try{
 AssertKitPins;Assert-FullCandidate $run;AssertPrivate $Receipt;Assert-FullPrivateDefaults $run $Defaults;Need (!(Test-Path $Output)) 'VERIFIER_OUTPUT_EXISTS'
 $prior=GetJson $Receipt;$result.Operation=$prior.Operation;$result.ReceiptSHA256=Hash $Receipt
 Need ($prior.PlanSHA256 -ceq $run.Receipt.PlanSHA256 -and $prior.Phase -ceq 'IndependentSQL' -and $prior.CandidateManifestSHA256 -ceq $run.Plan.FullCandidate.SHA256 -and $prior.SQLAttempted.'20261025125310'.Result -ceq 'DATA_VERIFIED' -and $prior.SQLAttempted.'20261025125408'.Result -ceq 'DATA_VERIFIED') 'EXACT_QUIESCENT_PHASE'
 LoadProduction $run
 # Own operation's world-disabled permit is required, rather than permitting Disabled globally.
 # Read-only verifier borrows only this exact parent's immutable stop proof.
 $proof=$prior.WorldMaintenanceProof
 Need ($proof.Operation -ceq $prior.Operation -and $proof.Action -ceq 'Migrate' -and $proof.Root -ceq $run.Plan.Maintenance -and $proof.Name -ceq 'mangosd') 'EXACT_PARENT_MAINTENANCE_PROOF'
 $run.State.MaintenanceScope.Operation=$prior.Operation;$run.State.MaintenanceScope.Action='Migrate';$run.State.MaintenanceScope.Permit=$proof
 Assert-DependencyStopResult $prior.WorldMaintenanceProof.Completion.Outcome 'mangosd';Assert-DependencyStopResult $prior.BackendStopProofs.realmd 'realmd'
 Assert-BackendQuiescent 'mangosd';Assert-BackendQuiescent 'realmd'
 $run.State.MigrationDefaults=@{Path=$Defaults;SHA256=(Hash $Defaults)};$run.Receipt.AuditSchema=$prior.AuditSchema
 Need ((Hash $prior.LogicalBackup.Path) -ceq $prior.LogicalBackup.SHA256 -and (Hash $prior.PreimageExport.Path) -ceq $prior.PreimageExport.SHA256 -and $prior.PreimageExport.NativeExit -eq 0) 'PRIVATE_BACKUP_PREIMAGE_HASH'
 Assert-FullAuditSchema $run;Verify-FullWorld $run;Verify-FullCharacters $run;Assert-FullSQLSets $run $true
 $result.Result='PASS';$result.World=$run.Receipt.WorldEffect;$result.Characters=$run.Receipt.CharactersEffect;$result.MigrationSets=$run.Receipt.MigrationSets;$result.WorldRealmStillStopped=$true;$okay=$true
}catch{$result.Error=$_.Exception.ToString()}
finally{PutJson $Output $result;FinishKit $run $okay 'Parent sequence may continue only on measured native0 and this PASS'}
if(!$okay){exit 1}
