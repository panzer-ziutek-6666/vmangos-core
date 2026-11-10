param([Parameter(Mandatory=$true)][ValidateSet('DevMigrations','DevAccept')][string]$Kind)
. (Join-Path $PSScriptRoot 'Candidate.Core.ps1')
AssertKitPins
Need ((GetJson (Join-Path $Out 'SQL-COMPARISON-TESTS.json')).Result -ceq 'PASS' -and (GetJson (Join-Path $Out 'SQL-TESTS.process.json')).ExitCode -eq 0 -and (GetJson (Join-Path $Out 'WORLD-VERIFICATION.json')).Result -ceq 'PASS') 'ACTUAL_SQL_TESTS_AND_WORLD_ACCEPTANCE_REQUIRED'
$ledgerPath=Join-Path $Out 'PHASE-LEDGER.json';$ledger=[ordered]@{}
if(Test-Path $ledgerPath){$read=GetJson $ledgerPath;foreach($p in $read.PSObject.Properties){$ledger[$p.Name]=$p.Value}}
$required=switch($Kind){'Backup'{@()};'DevSetup'{@('Backup')};'DevMigrations'{@('DevSetup')};'DevAccept'{@('DevSetup','DevMigrations')}}
foreach($p in $required){Need ($ledger.Contains($p) -and (GetJson $ledger[$p].Verifier).Result -ceq 'PASS' -and (Hash $ledger[$p].Verifier) -ceq $ledger[$p].VerifierSHA256 -and (Hash $ledger[$p].Receipt) -ceq $ledger[$p].ReceiptSHA256) ('PREVIOUS_PHASE_INDEPENDENT_PASS '+$p)}
$private='C:\ProgramData\VMANGOS\R3Approvals';AssertPrivate $private
$prefix='coreupdate-dev-continue-r3-20261109-0850';$secretPath=Join-Path $private 'coreupdate-dev-r1-20261109-0712-secrets.json'
function WriteNewPrivateJSON([string]$Path,$Value){Need (!(Test-Path $Path)) 'PRIVATE_NO_OVERWRITE';$b=[Text.UTF8Encoding]::new($true).GetBytes((ConvertTo-Json -InputObject $Value -Depth 15));$s=[IO.FileStream]::new($Path,[IO.FileMode]::CreateNew);try{$s.Write($b,0,$b.Length)}finally{$s.Dispose()};AssertPrivate $Path}
if($Kind -ceq 'Backup'){
 Need (!(Test-Path $secretPath)) 'NEW_DEV_CREDENTIALS_ONLY'
 $rng=[Security.Cryptography.RandomNumberGenerator]::Create();try{$a=New-Object byte[] 48;$b=New-Object byte[] 48;$rng.GetBytes($a);$rng.GetBytes($b);WriteNewPrivateJSON $secretPath @{DevAdminPassword=([Convert]::ToBase64String($a).TrimEnd('=').Replace('+','-').Replace('/','_'));DevCorePassword=([Convert]::ToBase64String($b).TrimEnd('=').Replace('+','-').Replace('/','_'))}}finally{$rng.Dispose();$a=$null;$b=$null}
}
AssertPrivate $secretPath
$inputPath=Join-Path $private ($prefix+'-'+$Kind+'-inputs.json');$approvalPath=Join-Path $private ($prefix+'-'+$Kind+'-approval.json')
$priors=[ordered]@{};foreach($p in $required){$priors[$p]=$ledger[$p]}
$inputs=[ordered]@{Schema=1;SourceDefaults=(Join-Path $private 'source-backup-candidate.ini');DevSecrets=$secretPath;Priors=$priors;DevEnvironmentReceipt=$(if($ledger.Contains('DevSetup')){$ledger.DevSetup.Receipt}else{$null})}
$now=[DateTimeOffset]::UtcNow
$approval=@{Schema=1;Host='WOW-SRV';Scope=$Kind;Approved=$true;IssuedUtc=$now.ToString('o');ExpiresUtc=$now.AddHours(12).ToString('o');PlanSHA256=(Hash (Join-Path $PSScriptRoot 'KIT-PLAN.json'));ExecutionPinsSHA256=(Hash (Join-Path $PSScriptRoot 'EXECUTION-PINS.tsv'));CandidateManifestSHA256='D3FD840BFDC65D5852612DA64005F2945689D3A66308525CD8B7B059878A4DBB';DevPlanSHA256='F46981486C5069A477BC107A6E6DCC57FCCFD351BC4085B27708D21F3116EBC0';NoDDLWindow=($Kind -ceq 'Backup');SnapshotStrategy='AllInnoDB';AllowGlobalReadLock=$false;Authority='Current user explicitly approves this isolated DEV cycle; no production controls/SQL writes/deployment/reboot.'}
WriteNewPrivateJSON $inputPath $inputs;WriteNewPrivateJSON $approvalPath $approval
$claim=Join-Path $Out ($Kind+'-EXECUTE-CLAIM.json');Need (!(Test-Path $claim)) 'PHASE_ALREADY_CLAIMED_NO_RETRY';PutJson $claim @{Kind=$Kind;AtUtc=$now.ToString('o');InputsSHA256=(Hash $inputPath);ApprovalSHA256=(Hash $approvalPath);OneAttempt=$true}
$ps51='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$r=Capture $ps51 @('-NoProfile','-File',(Join-Path $PSScriptRoot 'Run-Phase.ps1'),'-Kind',$Kind,'-InputsPath',$inputPath,'-ApprovalPath',$approvalPath) ($Kind+'-EXECUTE') 5400000
Need ($r.Started -and $r.StreamsCaptured -and $null -ne $r.ExitCode) 'PHASE_NATIVE_UNKNOWN_NO_RETRY'
Write-Host ('PHASE_NATIVE='+$r.ExitCode)
$text=[IO.File]::ReadAllText($r.Stdout);$match=[regex]::Match($text,'(?m)^RECEIPT=(.+)$');Need $match.Success 'PHASE_RECEIPT_NOT_REPORTED';$receipt=$match.Groups[1].Value.Trim()
Need ($r.ExitCode -eq 0) ('PHASE_FAILED_NO_DEPENDENT_EXECUTION '+$receipt)
$verifier=Join-Path (Split-Path $receipt) 'INDEPENDENT-VERIFIER.json'
$v=Capture $ps51 @('-NoProfile','-File',(Join-Path $PSScriptRoot 'Verify-Phase.ps1'),'-ReceiptPath',$receipt,'-ProcessRecord',(Join-Path $Out ($Kind+'-EXECUTE.process.json')),'-ResultPath',$verifier) ($Kind+'-VERIFY') 600000
Need ($v.Started -and $v.StreamsCaptured -and $null -ne $v.ExitCode -and $v.ExitCode -eq 0 -and (GetJson $verifier).Result -ceq 'PASS') 'INDEPENDENT_VERIFICATION_FAILED_NO_NEXT_PHASE'
$rr=GetJson $receipt;$ledger[$Kind]=[ordered]@{Operation=$rr.Operation;Receipt=$receipt;ReceiptSHA256=(Hash $receipt);Verifier=$verifier;VerifierSHA256=(Hash $verifier);NativeExit=$r.ExitCode;VerifierNativeExit=$v.ExitCode}
PutJson $ledgerPath $ledger;Write-Host ('VERIFIED_PHASE='+$Kind);Write-Host ('RECEIPT='+$receipt)
exit 0
