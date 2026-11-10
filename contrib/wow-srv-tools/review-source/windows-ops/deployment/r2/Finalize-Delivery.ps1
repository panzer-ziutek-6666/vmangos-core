[CmdletBinding()]
param([ValidateSet('Pins','Package')][string]$Mode='Pins')
$root='C:\Scripts\CORE-FULL-PRODUCTION-PREP-R2-WOW-SRV-20261109-2225-PAYLOAD'
. (Join-Path $root 'Kit.Common.ps1')
$combined='C:\GRY\wow\diagnostics\CORE-FULL-RECOVERY-PREP-R2-WOW-SRV-20261109-2225'
$stage='CORE-FULL-PRODUCTION-PREP-R2-WOW-SRV-20261109-2225'
if(!(Test-Path $Out)){NewPrivate $Out}
if($Mode -ceq 'Pins'){
 $base='C:\Scripts\CORE-FULL-PRODUCTION-PREP-R1-WOW-SRV-20261109-1305-PAYLOAD'
 $names=@(foreach($f in Import-Csv (Join-Path $base 'DELIVERY-FILES.tsv') -Delimiter "`t"){
  if($f.Path -like 'preparation\*' -or $f.Path -cin @('Audit-Migrations.ps1','Audit.Common.ps1','Audit-Keys-Grants.ps1','Run-Audit.ps1')){continue}
  $f.Path.Replace('CORE-FULL-PRODUCTION-PREP-R1-WOW-SRV-20261109-1305',$stage)
 })+@('BUILD-BUDGET.md','R2-VALIDATION-SCOPE.md')
 $names=@($names|Sort-Object -Unique)
 $a=GetJson (Join-Path $root 'APPROVAL.template.json');$a.Approved=$false;$a.NoDDLWindow=$false;$a.PlanSHA256=Hash (Join-Path $root 'KIT-PLAN.json');$a.ExecutionPinsSHA256='READ_SHA256_OF_EXECUTION-PINS.tsv_AT_ISSUE_TIME';PutJson (Join-Path $root 'APPROVAL.template.json') $a
 $names|ForEach-Object {[pscustomobject]@{Path=$_}}|Export-Csv (Join-Path $root 'DELIVERY-FILES.tsv') -Delimiter "`t" -NoTypeInformation -Encoding UTF8
 @($names|Where-Object {$_ -cne 'EXECUTION-PINS.tsv'}|ForEach-Object {[pscustomobject]@{Path=$_;SHA256=(Hash (Join-Path $root $_))}})|Export-Csv (Join-Path $root 'EXECUTION-PINS.tsv') -Delimiter "`t" -NoTypeInformation -Encoding UTF8
 $syntax=@(foreach($n in $names|Where-Object {$_ -match '\.ps(m)?1$'}){$path=Join-Path $root $n;$t=$null;$e=$null;[void][Management.Automation.Language.Parser]::ParseFile($path,[ref]$t,[ref]$e);Need ($e.Count -eq 0) ('SYNTAX '+$n);@{Path=$n;SHA256=(Hash $path);Errors=0}})
 PutJson (Join-Path $combined 'R2-FINAL-SYNTAX.json') @{Result='PASS';PS=$PSVersionTable.PSVersion.ToString();Files=$syntax}
 Write-Host 'R2_PINS_AND_PS51_PARSER=PASS';exit 0
}
AssertKitPins
Need ((GetJson (Join-Path $combined 'R2-REAL-MYSQL-TEST.json')).Result -ceq 'PASS' -and (GetJson (Join-Path $combined 'RECOVERY-INDEPENDENT-VERIFIER.json')).Result -ceq 'PASS') 'MANDATORY_PASS_PROOFS'
$syn=GetJson (Join-Path $combined 'R2-FINAL-SYNTAX.json');foreach($f in $syn.Files){Need ((Hash (Join-Path $root $f.Path)) -ceq $f.SHA256) 'FINAL_PARSER_BYTES_DIFFER'}
$map=[Collections.Generic.List[object]]::new()
foreach($f in Import-Csv (Join-Path $root 'DELIVERY-FILES.tsv') -Delimiter "`t"){$map.Add(@{Source=(Join-Path $root $f.Path);Name=('payload/'+$f.Path.Replace('\','/'))})}
$public=Join-Path $combined 'delivery';foreach($f in Get-ChildItem $public -File -Recurse){$map.Add(@{Source=$f.FullName;Name=('evidence/'+$f.FullName.Substring($public.Length+1).Replace('\','/'))})}
$manifest=@($map|Sort-Object Name|ForEach-Object {[pscustomobject]@{Path=$_.Name;SHA256=(Hash $_.Source);Bytes=(Get-Item $_.Source).Length}})
Need (@($manifest.Path|Sort-Object -Unique).Count -eq $manifest.Count) 'DUPLICATE_ZIP_ENTRY'
$mf=Join-Path $combined 'FINAL-ZIP-CONTENTS.tsv';$manifest|Export-Csv $mf -Delimiter "`t" -NoTypeInformation -Encoding UTF8
Add-Type -AssemblyName System.IO.Compression;Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=Join-Path 'C:\Scripts' ($stage+'.zip');Need (!(Test-Path $zip)) 'ZIP_ALREADY_EXISTS'
$fs=[IO.File]::Open($zip,'CreateNew','ReadWrite','None');$z=[IO.Compression.ZipArchive]::new($fs,[IO.Compression.ZipArchiveMode]::Create,$false);$when=[DateTimeOffset]::Now
try{foreach($item in @($map)+@(@{Source=$mf;Name='SHA256.tsv'})){Need ([IO.Path]::GetExtension($item.Source) -notin @('.exe','.dll','.pdb','.dmp','.ini','.bin','.sql')) 'PRIVATE_OR_BINARY_EXPORT';$entry=$z.CreateEntry($item.Name,[IO.Compression.CompressionLevel]::Optimal);$entry.LastWriteTime=$when;$s=[IO.File]::OpenRead($item.Source);$d=$entry.Open();try{$s.CopyTo($d)}finally{$d.Dispose();$s.Dispose()}}}finally{$z.Dispose();$fs.Dispose()}
$z=[IO.Compression.ZipFile]::OpenRead($zip)
try{foreach($f in $manifest){$e=$z.GetEntry($f.Path);Need ($null -ne $e -and $e.Length -eq $f.Bytes) 'ZIP_ENTRY_SIZE';$s=$e.Open();$h=[Security.Cryptography.SHA256]::Create();try{$hash=([BitConverter]::ToString($h.ComputeHash($s))).Replace('-','')}finally{$h.Dispose();$s.Dispose()};Need ($hash -ceq $f.SHA256) 'ZIP_HASH'};Need ($z.Entries.Count -eq $manifest.Count+1) 'ZIP_ENTRY_SET'}finally{$z.Dispose()}
PutJson (Join-Path $combined 'FINAL-DELIVERY.json') @{Result='PASS';ZIP=$zip;SHA256=(Hash $zip);Entries=$manifest.Count+1;Recovery='PASS_NATIVE0';R2='PREPARED_REAL_MYSQL_TEST_PASS';R2ProductionDeployment='NOT_RUN';ApprovalIssued=$false;NoDDLWindow=$false;PlanSHA256=(Hash (Join-Path $root 'KIT-PLAN.json'));ExecutionPinsSHA256=(Hash (Join-Path $root 'EXECUTION-PINS.tsv'));AtUtc=$when.ToUniversalTime().ToString('o')}
Write-Host ('ZIP='+$zip);Write-Host ('SHA256='+(Hash $zip))
