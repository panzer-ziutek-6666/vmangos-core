[CmdletBinding()]
param([ValidateSet('Status','Start-All','Stop-All','Restart-World','Planned-Reboot')][string]$Action='Status',[switch]$Json,[switch]$Boot,[switch]$Execute,[string]$RebootApprovalReceipt)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Need([bool]$Value,[string]$Text){if(!$Value){throw $Text}}
function Hash([string]$Path){(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash}
function Private([string]$Path){$p=[IO.Path]::GetFullPath($Path);$next=$p;while($next){if(Test-Path $next){Need (-not ((Get-Item -LiteralPath $next).Attributes -band [IO.FileAttributes]::ReparsePoint)) 'ROUTE_REPARSE'};$next=[IO.Path]::GetDirectoryName($next.TrimEnd('\'))};$a=Get-Acl $p;Need ($a.GetOwner([Security.Principal.SecurityIdentifier]).Value -cin @('S-1-5-18','S-1-5-32-544')) 'ROUTE_OWNER';foreach($r in $a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){Need ($r.IdentityReference.Value -cin @('S-1-5-18','S-1-5-32-544') -and $r.AccessControlType -eq 'Allow') 'ROUTE_DACL'}}
Need ($env:COMPUTERNAME -ceq 'WOW-SRV' -and $PSVersionTable.PSEdition -ceq 'Desktop' -and $PSVersionTable.PSVersion.ToString() -like '5.1.*' -and [Environment]::Is64BitProcess -and ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) 'ROUTE_HOST_TOKEN_PS51'
if(!$Execute){[pscustomobject]@{Mode='Plan';Action=$Action;Boot=[bool]$Boot;Pointer='C:\ProgramData\VMANGOS\AdminPanelBridge\r3-bundle-current.json';Mutations=0}|ConvertTo-Json;'OK=True';'CHANGE_SCOPE=READ_ONLY_PLAN';'LOG=stdout captured by caller';'NEXT_STEP=Separate approved deployment required';return}

Need ($PSCommandPath -ceq 'C:\ProgramData\VMANGOS\AdminPanelBridge\Invoke-R3Bundle.ps1') 'ROUTE_INSTALLED_PATH'
$mutex=[Threading.Mutex]::new($false,'Global\VMANGOS-AdminPanel-Control');$owned=$false
try{
 $owned=$mutex.WaitOne(0);Need $owned 'ROUTE_OPERATION_BUSY'
 $pointer='C:\ProgramData\VMANGOS\AdminPanelBridge\r3-bundle-current.json';Private $pointer;$bundle=[IO.File]::ReadAllText($pointer)|ConvertFrom-Json
 Need ($bundle.Schema -eq 1 -and $bundle.Phase -ceq 'Live' -and $bundle.VersionRoot -ceq 'C:\ProgramData\VMANGOS\AdminPanelBridge\shutdown1053-r3-v2-fix5') 'ROUTE_BUNDLE_NOT_LIVE'
 Private $bundle.VersionRoot
 Need ((@($bundle.CodePins.Name|Sort-Object) -join '|') -ceq 'Maintenance.psm1|Production.Driver.ps1|VMANGOS-Control.ps1|World.Markers.ps1') 'ROUTE_PIN_SET'
 foreach($pin in $bundle.CodePins){$p=Join-Path $bundle.VersionRoot $pin.Name;Private $p;Need ((Hash $p) -ceq $pin.SHA256) 'ROUTE_CODE_PIN'}
 $collector='C:\ProgramData\VMANGOS\AdminPanelCollector';$cp=[IO.File]::ReadAllText((Join-Path $collector 'collector-current.json'))|ConvertFrom-Json
 Need ($cp.collectorVersion -ceq $bundle.CollectorVersion -and $cp.codeManifestSHA256 -ceq $bundle.CollectorCodeSHA256) 'ROUTE_COLLECTOR_VERSION'
 $collectorRoot=Join-Path $collector ('versions\'+$cp.collectorVersion);Private $collectorRoot;$codePath=Join-Path $collectorRoot 'collector-code.json';Need ((Hash $codePath) -ceq $cp.codeManifestSHA256) 'ROUTE_COLLECTOR_MANIFEST';$definition=[IO.File]::ReadAllText($codePath)|ConvertFrom-Json;foreach($pin in $definition.files){Need ($pin.name -cmatch '^[A-Za-z0-9_.-]+$') 'COLLECTOR_PATH';$file=Join-Path $collectorRoot $pin.name;Private $file;Need ((Hash $file) -ceq $pin.sha256 -and (Get-Item $file).Length -eq $pin.bytes) 'ROUTE_COLLECTOR_CODE'};$reg=Join-Path $collector 'release-registry';$state=[IO.File]::ReadAllText((Join-Path $reg 'state.json'))|ConvertFrom-Json
 Need ($state.phase -ceq 'stable' -and $state.active.id -ceq $bundle.Release.id -and $state.active.sha256 -ceq $bundle.Release.sha256) 'ROUTE_RELEASE_NOT_COMMITTED'
 $manifestPath=Join-Path $reg ('manifests\'+$bundle.Release.id+'.json');Need ((Hash $manifestPath) -ceq $bundle.Release.sha256) 'ROUTE_MANIFEST_HASH';$m=[IO.File]::ReadAllText($manifestPath)|ConvertFrom-Json
 $aPath=Join-Path $reg ('approvals\'+$bundle.Release.id+'.json');$pPath=Join-Path $reg ('proofs\'+$bundle.Release.id+'.json');Private $aPath;Private $pPath;$approved=[IO.File]::ReadAllText($aPath)|ConvertFrom-Json;Need ($approved.manifestSHA256 -ceq $bundle.Release.sha256 -and $approved.buildProofSHA256 -ceq $m.origin.buildProofSHA256 -and (Hash $pPath) -ceq $m.origin.buildProofSHA256) 'ROUTE_RELEASE_APPROVAL';foreach($role in @('mangosd','realmd')){Need ((Hash ('C:\GRY\wow\serwer-dev\'+$role+'.exe')) -ceq $m.binaries.$role.sha256) 'ROUTE_RUNTIME_PAIR'}
 $cap=Join-Path $bundle.VersionRoot 'REBOOT-CAPABILITY.json';Private $cap;Need ((Hash $cap) -ceq $bundle.CapabilitySHA256) 'ROUTE_CAPABILITY_PIN';$capBody=[IO.File]::ReadAllText($cap)|ConvertFrom-Json;Need ($capBody.Approved -is [bool] -and $capBody.Approved -and $capBody.SqlOutcomeVersion -eq 2) 'ROUTE_CAPABILITY_NOT_APPROVED'
 if($Action -ceq 'Planned-Reboot'){
  Private $RebootApprovalReceipt;$a=[IO.File]::ReadAllText($RebootApprovalReceipt)|ConvertFrom-Json
  Need ($a.Approved -is [bool] -and $a.Approved -and $a.Host -ceq 'WOW-SRV' -and $a.Scope -ceq 'RebootRequest' -and $a.PlanSHA256 -ceq $bundle.PlanSHA256 -and [DateTimeOffset]::Parse($a.ExpiresUtc) -gt [DateTimeOffset]::UtcNow) 'SEPARATE_OS_REBOOT_APPROVAL_REQUIRED'
 }
 $capture='C:\Scripts\MANGOS-AFTERBOOT-VERIFY-R2-WOW-SRV-20261101-0110-PAYLOAD\Process.Capture.ps1';Need ((Hash $capture) -ceq '91D7A3E1CA6E0B430C338566A2B01C273AE41F8314160ECBDD649067409D1534') 'ROUTE_CAPTURE_PIN';. $capture
 $controller=Join-Path $bundle.VersionRoot 'VMANGOS-Control.ps1';$argsText='-NoProfile -ExecutionPolicy Bypass -File "'+$controller+'" -Action '+$Action+' -Execute';if($Boot){$argsText+=' -Boot'};if($Json){$argsText+=' -Json'}
 $evidence='C:\GRY\wow\diagnostics\R3-BUNDLE-CONTROL-'+[DateTimeOffset]::Now.ToString('yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N')
 $r=Invoke-CapturedProcessR2 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' $argsText $evidence -TimeoutMilliseconds 3600000
 if(Test-Path $r.Stdout){Write-Output ([IO.File]::ReadAllText($r.Stdout))};Need ($r.Started -and $r.StreamsCaptured -and $null -ne $r.ExitCode) 'ROUTE_NATIVE_RESULT_UNKNOWN';'OK='+($r.ExitCode -eq 0);'CHANGE_SCOPE=EXPLICIT_R3_CONTROL';'LOG='+$evidence;'NEXT_STEP=Review actual child result';exit [int]$r.ExitCode
}catch{Write-Error $_;exit 1}finally{if($owned){$mutex.ReleaseMutex()};$mutex.Dispose()}
