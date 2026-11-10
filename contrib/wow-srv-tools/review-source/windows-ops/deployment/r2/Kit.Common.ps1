. (Join-Path $PSScriptRoot 'Evidence.Common.ps1')
. (Join-Path $PSScriptRoot 'Process.Identity.Fix2.ps1')
. (Join-Path $PSScriptRoot 'Dev.Setup.Binding.Fix2.ps1')
. (Join-Path $PSScriptRoot 'Dev.Acceptance.Binding.Fix4.ps1')
Import-Module (Join-Path $PSScriptRoot 'Workflow.psm1') -Force
function GetJson([string]$Path){ReadJson $Path}
function NoReparse([string]$Path){$p=[IO.Path]::GetFullPath($Path);while($p){if(Test-Path $p){Need (-not ((Get-Item -LiteralPath $p -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) ('REPARSE '+$p)};$p=[IO.Path]::GetDirectoryName($p.TrimEnd('\'))}}
function AssertPrivate([string]$Path){
 NoReparse $Path;$a=Get-Acl -LiteralPath $Path;Need ($a.GetOwner([Security.Principal.SecurityIdentifier]).Value -cin @('S-1-5-18','S-1-5-32-544')) ('PRIVATE_OWNER '+$Path)
 foreach($r in $a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){Need ($r.IdentityReference.Value -cin @('S-1-5-18','S-1-5-32-544') -and $r.AccessControlType -eq 'Allow') ('PRIVATE_DACL '+$Path)}
}
function NewPrivate([string]$Path){Need (!(Test-Path $Path)) ('NEW_PRIVATE_ONLY '+$Path);$a=[Security.AccessControl.DirectorySecurity]::new();$a.SetSecurityDescriptorSddlForm('O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)');[void][IO.Directory]::CreateDirectory($Path,$a);AssertPrivate $Path}
function PutJson([string]$Path,$Value){[IO.File]::WriteAllText($Path,(ConvertTo-Json -InputObject $Value -Depth 25),[Text.UTF8Encoding]::new($true))}
function DurableJson([string]$Path,$Value){
 $temp=$Path+'.'+[guid]::NewGuid().ToString('N')+'.tmp';$bytes=[Text.UTF8Encoding]::new($false).GetBytes((ConvertTo-Json -InputObject $Value -Depth 25 -Compress));$s=[IO.FileStream]::new($temp,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough)
 try{$s.Write($bytes,0,$bytes.Length);$s.Flush($true)}finally{$s.Dispose()}
 if(Test-Path $Path){[IO.File]::Replace($temp,$Path,[System.Management.Automation.Language.NullString]::Value)}else{[IO.File]::Move($temp,$Path)}
}
function NewKitRun([string]$Kind,[string]$Mode){
 $p=GetJson (Join-Path $PSScriptRoot 'KIT-PLAN.json');$id=[guid]::NewGuid().ToString('N');$dir=Join-Path $Out ('runs\'+$Kind+'-'+$id);if($Mode -ceq 'Plan'){[void][IO.Directory]::CreateDirectory($dir)}else{NewPrivate $dir}
 [pscustomobject]@{Kind=$Kind;Mode=$Mode;Id=$id;Out=$dir;Plan=$p;Log=(Join-Path $dir 'STAGE.log');Receipt=[ordered]@{Schema=1;Kind=$Kind;Mode=$Mode;Operation=$id;PlanSHA256=(Hash (Join-Path $PSScriptRoot 'KIT-PLAN.json'));Result='PREPARED';Phase='Guard';Completed=@();MutationBegun=$false;Error=$null;BarrierError=$null;ObservationError=$null;WrittenHashes=@{}};Mutex=$null;OwnMutex=$false;GlobalMutex=$null;OwnGlobal=$false;Lock=$null;State=@{}}
}
function LogKit($Run,[string]$Text){$line=[DateTimeOffset]::Now.ToString('o')+' '+$Text;[IO.File]::AppendAllText($Run.Log,$line+"`r`n",[Text.UTF8Encoding]::new($true));Write-Host $line}
function NativeKit($Run,[string]$Exe,[string[]]$Tokens,[string]$Tag,[int]$Timeout=120000){
 $relative=$Run.Out.Substring($Out.Length+1)+'\'+$Tag
 $r=Capture $Exe $Tokens $relative $Timeout
 Need ($r.Started -and $r.StreamsCaptured -and $null -ne $r.ExitCode) ('NATIVE_UNKNOWN '+$Tag)
 Need ($r.ExitCode -eq 0) ('NATIVE_FAIL '+$Tag+' Exit='+$r.ExitCode)
 return $r
}
function AssertKitPins {
 foreach($row in Import-Csv (Join-Path $PSScriptRoot 'EXECUTION-PINS.tsv') -Delimiter "`t"){$path=Join-Path $PSScriptRoot $row.Path;NoReparse $path;Need ((Hash $path) -ceq $row.SHA256) ('KIT_CODE_CHANGED '+$path)}
}
function AssertApproval($Run,[string]$Path,[string]$Scope){
 AssertKitPins;Need (![string]::IsNullOrWhiteSpace($Path)) 'EXPLICIT_APPROVAL_RECEIPT_REQUIRED';AssertPrivate $Path;$a=GetJson $Path
 Need ($a.Schema -eq 1 -and $a.Approved -is [bool] -and $a.Approved -and $a.Host -ceq 'WOW-SRV' -and $a.Scope -ceq $Scope -and $a.PlanSHA256 -ceq $Run.Receipt.PlanSHA256 -and $a.ExecutionPinsSHA256 -ceq (Hash (Join-Path $PSScriptRoot 'EXECUTION-PINS.tsv'))) 'APPROVAL_BINDING'
 $expiry=([DateTimeOffset]::Parse($a.ExpiresUtc)).ToUniversalTime();Need ($expiry -gt [DateTimeOffset]::UtcNow -and $expiry -le [DateTimeOffset]::UtcNow.AddDays(1)) 'APPROVAL_EXPIRY'
 $Run.State.Approval=$a
}
function EnterKitLocks($Run,[bool]$Production){
 $Run.Mutex=[Threading.Mutex]::new($false,'Global\WOW-SRV-R3-Operation');$Run.OwnMutex=$Run.Mutex.WaitOne(0);Need $Run.OwnMutex 'HOST_OPERATION_BUSY'
 if($Production){$Run.GlobalMutex=[Threading.Mutex]::new($false,'Global\VMANGOS-AdminPanel-Control');$Run.OwnGlobal=$Run.GlobalMutex.WaitOne(0);Need $Run.OwnGlobal 'PANEL_OPERATION_BUSY';$p=Join-Path $Run.Plan.Maintenance 'operation.lock';AssertPrivate $p;$Run.Lock=[IO.File]::Open($p,'Open','ReadWrite','None')}
}
function LeaveKitLocks($Run){if($Run.Lock){$Run.Lock.Dispose()};if($Run.GlobalMutex){if($Run.OwnGlobal){$Run.GlobalMutex.ReleaseMutex()};$Run.GlobalMutex.Dispose()};if($Run.Mutex){if($Run.OwnMutex){$Run.Mutex.ReleaseMutex()};$Run.Mutex.Dispose()}}
function AssertBaseline($Run){
 foreach($row in $Run.Plan.FixedInputs){Need ((Hash $row.Path) -ceq $row.SHA256 -and (Get-Acl -LiteralPath $row.Path).Sddl -ceq $row.SDDL) ('ACTIVE_BASELINE_CHANGED '+$row.Path)}
 foreach($row in $Run.Plan.Artifacts){Need ((Hash $row.Path) -ceq $row.SHA256) ('R3_ARTIFACT_CHANGED '+$row.Path)}
 foreach($b in $Run.Plan.ServiceBaseline){$s=Get-CimInstance Win32_Service -Filter ("Name='"+$b.Name+"'");Need ($null -ne $s -and $s.PathName -ceq $b.ImagePath -and $s.StartMode -ceq $b.StartMode -and $s.StartName -ceq $b.Account) 'SERVICE_CONFIG_DRIFT';$v=Get-ItemProperty ('HKLM:\SYSTEM\CurrentControlSet\Services\'+$b.Name);Need ((@($(if($null -ne $v.PSObject.Properties['DependOnService']){$v.DependOnService})|Where-Object {$null -ne $_}|Sort-Object) -join '|') -ceq (@($b.Dependencies|Sort-Object) -join '|')) 'SERVICE_DEPENDENCY_DRIFT';$actual=$null;if($null -ne $v.PSObject.Properties['FailureActions']){$sha=[Security.Cryptography.SHA256]::Create();try{$actual=([BitConverter]::ToString($sha.ComputeHash($v.FailureActions))).Replace('-','')}finally{$sha.Dispose()}};Need ($actual -ceq $b.FailureActionsSHA256) 'SCM_POLICY_DRIFT'}
 $ptr=GetJson $Run.Plan.CollectorPointer;Need ($ptr.collectorVersion -ceq $Run.Plan.CollectorVersion -and $ptr.codeManifestSHA256 -ceq $Run.Plan.CollectorCodeSHA256) 'COLLECTOR_VERSION_CHANGED'
}
function GetPlanProjection($Run){
 [pscustomobject]@{Mode='Plan';Kind=$Run.Kind;PlanSHA256=$Run.Receipt.PlanSHA256;Steps=@(Get-KitSteps $Run.Kind);Dev=$Run.Plan.Dev;Files=$Run.Plan.Files;Required=$Run.Plan.Required;Execute='Separate approval receipt + concrete required inputs; no approval issued by preparation';DBRollback='NEVER_AUTOMATIC';Reboot='Separate later Request/Verify script; never called by migration'}
}
function InvokeInputFile($Run,[string]$Exe,[string[]]$Tokens,[string]$InputPath,[string]$Tag,[int]$Timeout=600000){
 # New gap only: approved capture has no stdin parameter. Retain its exit-code rule.
 Need (!(Test-Path (Join-Path $Run.Out ($Tag+'.process.json')))) 'STDIN_NO_DUPLICATE_CAPTURE'
 foreach($token in $Tokens){Need (!$token.Contains('"') -and !$token.EndsWith('\')) 'STDIN_QUOTING'}
 $record=[ordered]@{State='LAUNCH_ERROR';Started=$false;StreamsCaptured=$false;PID=$null;CreatedUtc=$null;Executable=$Exe;ExitCode=$null;Stdout=(Join-Path $Run.Out ($Tag+'.stdout.log'));Stderr=(Join-Path $Run.Out ($Tag+'.stderr.log'));Error=$null}
 $p=[Diagnostics.Process]::new();$p.StartInfo=[Diagnostics.ProcessStartInfo]::new();$p.StartInfo.FileName=$Exe;$p.StartInfo.Arguments=($Tokens|ForEach-Object {'"'+$_+'"'}) -join ' ';$p.StartInfo.UseShellExecute=$false;$p.StartInfo.CreateNoWindow=$true;$p.StartInfo.RedirectStandardInput=$true;$p.StartInfo.RedirectStandardOutput=$true;$p.StartInfo.RedirectStandardError=$true
 try{
  [void]$p.Start();$record.Started=$true;$record.PID=$p.Id;$record.CreatedUtc=$p.StartTime.ToUniversalTime().ToString('o');$handle=$p.Handle;$o=$p.StandardOutput.ReadToEndAsync();$e=$p.StandardError.ReadToEndAsync();$stdinFileStream=[IO.File]::OpenRead($InputPath)
  try{$copy=$stdinFileStream.CopyToAsync($p.StandardInput.BaseStream);Need ($copy.Wait($Timeout)) 'STDIN_TIMEOUT_NO_KILL';[void]$copy.GetAwaiter().GetResult();$p.StandardInput.Close()}finally{$stdinFileStream.Dispose()}
  Need ($p.WaitForExit($Timeout)) 'PROCESS_TIMEOUT_NO_KILL';$p.WaitForExit();$code=[uint32]0;Need ([AfterBootRepairR2.Native]::GetExitCodeProcess($handle,[ref]$code)) 'NATIVE_EXIT_UNKNOWN';$record.ExitCode=[long]$code;$record.State=if($code -eq 0){'EXECUTED_PASS'}else{'EXECUTED_FAIL'}
  [IO.File]::WriteAllText($record.Stdout,$o.GetAwaiter().GetResult(),[Text.UTF8Encoding]::new($true));[IO.File]::WriteAllText($record.Stderr,$e.GetAwaiter().GetResult(),[Text.UTF8Encoding]::new($true));$record.StreamsCaptured=$true
 }catch{$record.Error=$_.Exception.Message;if($record.Started -and $null -eq $record.ExitCode){$record.State='UNKNOWN_NO_RETRY'}}finally{PutJson (Join-Path $Run.Out ($Tag+'.process.json')) $record;$p.Dispose()}
 Need ($record.State -ceq 'EXECUTED_PASS' -and $record.StreamsCaptured) ('INPUT_PROCESS_'+$record.State);return [pscustomobject]$record
}
function FinishKit($Run,[bool]$Okay,[string]$Next){
 PutJson (Join-Path $Run.Out 'RECEIPT.json') $Run.Receipt
 foreach($line in @('OK='+$Okay,'CHANGE_SCOPE='+$(if($Run.Mode -ceq 'Plan'){'READ_ONLY_WITH_OWN_LOG'}else{$Run.Kind}),'LOG='+$Run.Log,'NEXT_STEP='+$Next)){LogKit $Run $line}
}
