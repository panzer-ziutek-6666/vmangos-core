[CmdletBinding()]
param([switch]$Issue,[switch]$UserApproved,[switch]$NoDDLWindow)
. (Join-Path $PSScriptRoot 'FullProduction.ps1')
AssertKitPins
$dir='C:\ProgramData\VMANGOS\R3Approvals';AssertPrivate $dir
$paths=@((Join-Path $dir 'inputs-core-full-production-r2.json'),(Join-Path $dir 'MigrateFull-core-full-production-r2.json'))
if(!$Issue){Write-Host ('PREPARED_ONLY; Approved=False; NoDDLWindow=False; future files='+($paths -join ';'));exit 0}
Need ($UserApproved -and $NoDDLWindow) 'SEPARATE_EXPLICIT_USER_APPROVAL_AND_FRESH_NODDL_REQUIRED'
foreach($p in $paths){Need (!(Test-Path $p)) ('NO_OVERWRITE '+$p)}
$run=NewKitRun 'InputPreparation' 'Plan';Assert-FullCandidate $run
$now=[DateTimeOffset]::UtcNow
$inputs=GetJson (Join-Path $PSScriptRoot 'INPUTS.template.json')
$approval=GetJson (Join-Path $PSScriptRoot 'APPROVAL.template.json')
$approval.Approved=$true;$approval.NoDDLWindow=$true;$approval.AllowPrivateAuditSchema=$true;$approval.PlanSHA256=Hash (Join-Path $PSScriptRoot 'KIT-PLAN.json');$approval.ExecutionPinsSHA256=Hash (Join-Path $PSScriptRoot 'EXECUTION-PINS.tsv');$approval.IssuedUtc=$now.ToString('o');$approval.ExpiresUtc=$now.AddHours(4).ToString('o')
$acl=[Security.AccessControl.FileSecurity]::new();$acl.SetSecurityDescriptorSddlForm('O:BAG:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)')
$values=@($inputs,$approval)
for($i=0;$i -lt 2;$i++){$s=[IO.File]::Create($paths[$i],4096,[IO.FileOptions]::WriteThrough,$acl);try{$bytes=[Text.UTF8Encoding]::new($true).GetBytes((ConvertTo-Json -InputObject $values[$i] -Depth 20));$s.Write($bytes,0,$bytes.Length);$s.Flush($true)}finally{$s.Dispose()};AssertPrivate $paths[$i]}
Write-Host ('INPUTS='+$paths[0]);Write-Host ('APPROVAL='+$paths[1]);Write-Host 'No service action, SQL mutation or backup was performed by this input preparation.'
