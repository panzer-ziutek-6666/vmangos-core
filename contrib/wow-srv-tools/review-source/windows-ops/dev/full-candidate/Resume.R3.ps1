. (Join-Path $PSScriptRoot 'Comparison.R3.ps1')
$script:R3BaseSteps=(Get-Command Get-KitSteps).ScriptBlock
$script:R3BaseStep=(Get-Command InvokeNativeStep).ScriptBlock
function Get-KitSteps([string]$Kind){if($Kind -ceq 'DevMigrations'){@('Guard','ValidateInputs','Gate','VerifyRetainedWorld','VerifyCharactersUnchanged','ApplyCharacters','VerifyCharacters','VerifyMigrations')}else{& $script:R3BaseSteps $Kind}}
function Assert-ResumeR3($Run){
 $b=GetJson (Join-Path $PSScriptRoot 'RESUME-BINDING.json')
 Need ((Hash $b.InterruptedReceipt) -ceq $b.InterruptedReceiptSHA256 -and $b.InterruptedReceiptSHA256 -ceq '03AE46BCCDDEAB5AF72E008F6B39834927F7EFDA7907E976A5B069032A54EBD6' -and (Hash $b.OriginalBindingPath) -ceq $b.OriginalBindingSHA256 -and (Hash $b.CloneBackup.Path) -ceq $b.CloneBackup.SHA256) 'RESUME_HISTORY_BACKUP_CHANGED'
 $r=GetJson $b.InterruptedReceipt;Need ($r.Result -ceq 'FAIL_CLOSED' -and $r.Phase -ceq 'VerifyWorld' -and $r.Operation -ceq $b.Operation -and $r.DevUUID -ceq $b.UUID -and $r.PlanSHA256 -ceq $b.PlanSHA256 -and $r.CandidateManifestSHA256 -ceq $b.CandidateManifestSHA256 -and $Run.Receipt.PlanSHA256 -ceq $b.PlanSHA256) 'RESUME_IDENTITY_BINDING'
 $Run.Receipt.ResumeBindingSHA256=Hash (Join-Path $PSScriptRoot 'RESUME-BINDING.json');$Run.Receipt.StepsExecutedEarlier=$r.Completed;$Run.Receipt.InterruptedOperation=$b.Operation;$Run.Receipt.PreMigrationBackup=$b.CloneBackup
}
function Get-VerifiedPrior($Run,$Inputs,[string]$Kind){
 $ref=$Inputs.Priors.$Kind;AssertPrivate $ref.Receipt;AssertPrivate $ref.Verifier
 $b=GetJson (Join-Path $PSScriptRoot 'RESUME-BINDING.json')
 if($Kind -ceq 'DevSetup'){$s=$b.OriginalBinding.DevSetup;Need ($ref.Receipt -ceq $s.Receipt -and $ref.ReceiptSHA256 -ceq $s.ReceiptSHA256 -and $ref.Verifier -ceq $b.SetupVerifier -and $ref.VerifierSHA256 -ceq $b.SetupVerifierSHA256 -and (Hash $b.OriginalBindingPath) -ceq $b.OriginalBindingSHA256) 'EXACT_RETAINED_SETUP'}
 else{Need ($Kind -ceq 'DevMigrations' -and $ref.Receipt.StartsWith($script:Out+'\runs\DevMigrations-',[StringComparison]::OrdinalIgnoreCase) -and $ref.Verifier -ceq (Join-Path (Split-Path $ref.Receipt) 'INDEPENDENT-VERIFIER.json')) 'NEW_MIGRATION_RECEIPT_ONLY'}
 Need ((Hash $ref.Receipt) -ceq $ref.ReceiptSHA256 -and (Hash $ref.Verifier) -ceq $ref.VerifierSHA256) 'PRIOR_FILES_CHANGED'
 $r=GetJson $ref.Receipt;$v=GetJson $ref.Verifier
 Need ($r.Result -ceq 'PASS' -and $r.Kind -ceq $Kind -and $r.Phase -ceq 'Complete' -and $r.Operation -ceq $ref.Operation -and $r.PlanSHA256 -ceq $Run.Receipt.PlanSHA256 -and $r.CandidateManifestSHA256 -ceq $b.CandidateManifestSHA256 -and $r.DevUUID -ceq $b.UUID -and $v.Result -ceq 'PASS' -and $v.Operation -ceq $r.Operation -and $v.ReceiptSHA256 -ceq $ref.ReceiptSHA256 -and $v.VerifiedUUID -ceq $b.UUID) 'PRIOR_PROVENANCE_OR_RESULT'
 if($Kind -ceq 'DevSetup'){Need ($v.ContinuationBindingSHA256 -ceq $b.OriginalBindingSHA256) 'SETUP_VERIFIER_BINDING'}else{Need ($r.ResumeBindingSHA256 -ceq (Hash (Join-Path $PSScriptRoot 'RESUME-BINDING.json')) -and $v.ResumeBindingSHA256 -ceq $r.ResumeBindingSHA256) 'CONTINUED_MIGRATION_BINDING'}
 return $r
}
function Assert-WorldProofR3($Run){
 $p=Join-Path $script:Out 'WORLD-VERIFICATION.json';$v=GetJson $p;$n=GetJson (Join-Path $script:Out 'WORLD-VERIFY.process.json')
 Need ($v.Result -ceq 'PASS' -and $v.ResumeBindingSHA256 -ceq (Hash (Join-Path $PSScriptRoot 'RESUME-BINDING.json')) -and $n.Started -and $n.StreamsCaptured -and $null -ne $n.ExitCode -and $n.ExitCode -eq 0) 'WORLD_INDEPENDENT_PASS_REQUIRED'
 $Run.Receipt.RetainedWorldVerification=@{Path=$p;SHA256=(Hash $p);NativeExit=$n.ExitCode}
}
function InvokeNativeStep($Run,$Inputs,[string]$Step){
 Need ($Run.Kind -cin @('DevMigrations','DevAccept')) 'ONLY_REMAINING_PHASES'
 Need ($Step -cnotin @('ApplyWorld','CapturePreimages','DevPreMigrationBackup','LogicalBackup','InitializeDevData','ImportDevCopy','CreateDevServices','DevDirectories','DevArtifacts','DevConfigs','BootstrapDevCredentials')) 'FORBIDDEN_REPLAY'
 switch($Step){
  'Guard'{[void](& $script:R3BaseStep $Run $Inputs $Step);Assert-ResumeR3 $Run}
  'VerifyRetainedWorld'{Assert-WorldProofR3 $Run;Assert-AuditSchemaR3 $Run;VerifyDevWorld $Run;$proof=Export-AuditProofR3 $Run 'AUDIT-BEFORE-CHARACTERS';$base=GetJson (Join-Path $script:Out 'PREIMAGES-BASELINE.json');Need ($proof.SHA256 -ceq $base.SHA256) 'RETAINED_PREIMAGES_CHANGED'}
  'VerifyCharactersUnchanged'{Assert-CharactersUnchangedR3 $Run}
  default{[void](& $script:R3BaseStep $Run $Inputs $Step)}
 };Ack
}
