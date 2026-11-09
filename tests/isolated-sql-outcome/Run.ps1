param(
    [string]$SourceRoot=([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))),
    [Parameter(Mandatory=$true)][string]$OutputDirectory,
    [string]$VisualStudioRoot,
    [string]$WindowsSdkVersion
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Require([bool]$Value,[string]$Message){if(!$Value){throw $Message}}
function SHA([string]$Path){(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash}
function JSON([string]$Name,$Data){[IO.File]::WriteAllText((Join-Path $OutputDirectory $Name),(ConvertTo-Json -InputObject $Data -Depth 15),[Text.UTF8Encoding]::new($true))}
Require ($PSVersionTable.PSEdition -ceq 'Desktop' -and $PSVersionTable.PSVersion.Major -eq 5 -and [Environment]::Is64BitProcess) 'Windows PowerShell 5.1 Desktop x64 required'
Require (![IO.Directory]::Exists($OutputDirectory)) 'Output must be a new directory; never overwrite a prior result'
[void][IO.Directory]::CreateDirectory($OutputDirectory)
function Child([string]$Exe,[string[]]$Tokens,[string]$Tag,[int]$Timeout=30000){
    $p=[Diagnostics.Process]::new()
    $r=[ordered]@{Tag=$Tag;Started=$false;NativeExit=$null;State='LAUNCH_ERROR';Error=$null;Stdout=(Join-Path $OutputDirectory ($Tag+'.stdout.log'));Stderr=(Join-Path $OutputDirectory ($Tag+'.stderr.log'))}
    try{
        foreach($t in $Tokens){Require (!$t.Contains('"') -and !$t.Contains("`n") -and !$t.EndsWith('\')) 'Unsupported argument quoting'}
        $p.StartInfo=[Diagnostics.ProcessStartInfo]::new();$p.StartInfo.FileName=$Exe
        $p.StartInfo.Arguments=($Tokens|ForEach-Object {'"'+$_+'"'}) -join ' '
        $p.StartInfo.WorkingDirectory=$OutputDirectory;$p.StartInfo.UseShellExecute=$false;$p.StartInfo.CreateNoWindow=$true
        $p.StartInfo.RedirectStandardOutput=$true;$p.StartInfo.RedirectStandardError=$true
        Require ($p.Start()) 'Process.Start false';$r.Started=$true;$retained=$p.Handle
        $stdout=$p.StandardOutput.ReadToEndAsync();$stderr=$p.StandardError.ReadToEndAsync()
        $r.State='UNKNOWN'
        Require ($p.WaitForExit($Timeout)) 'Timeout: no kill and no retry'
        $p.WaitForExit();$r.NativeExit=$p.ExitCode
        [IO.File]::WriteAllText($r.Stdout,$stdout.GetAwaiter().GetResult(),[Text.UTF8Encoding]::new($true))
        [IO.File]::WriteAllText($r.Stderr,$stderr.GetAwaiter().GetResult(),[Text.UTF8Encoding]::new($true))
        $r.State='MEASURED'
    }catch{$r.Error=$_.Exception.ToString()}finally{JSON ($Tag+'.process.json') $r;$p.Dispose()}
    [pscustomobject]$r
}
function Extract([string]$Path,[string]$Signature){
    $s=[IO.File]::ReadAllText($Path);$a=$s.IndexOf($Signature)
    Require ($a -ge 0 -and $s.IndexOf($Signature,$a+1) -lt 0) ('Unique function required: '+$Signature)
    $open=$s.IndexOf('{',$a);$level=0;$end=-1
    for($i=$open;$i -lt $s.Length;$i++){if($s[$i] -eq '{'){$level++}elseif($s[$i] -eq '}'){$level--;if($level -eq 0){$end=$i+1;break}}}
    Require ($end -gt $open) 'Function boundary not found'
    $s.Substring($a,$end-$a)
}
try{
    if(!$VisualStudioRoot){
        $vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
        Require (Test-Path -LiteralPath $vswhere) 'vswhere or explicit VisualStudioRoot required'
        $probe=Child $vswhere @('-latest','-products','*','-property','installationPath') 'vswhere'
        Require ($probe.NativeExit -eq 0) 'vswhere failed'
        $VisualStudioRoot=[IO.File]::ReadAllText($probe.Stdout).Trim()
        Require (![string]::IsNullOrWhiteSpace($VisualStudioRoot)) 'vswhere returned no installation; supply VisualStudioRoot explicitly'
    }
    $vc=Join-Path $VisualStudioRoot 'VC\Tools\MSVC'
    $vc=(Get-ChildItem -LiteralPath $vc -Directory|Sort-Object {[version]$_.Name} -Descending|Select-Object -First 1).FullName
    $sdk=Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10'
    if(!$WindowsSdkVersion){$WindowsSdkVersion=(Get-ChildItem (Join-Path $sdk 'Include') -Directory|Sort-Object {[version]$_.Name} -Descending|Select-Object -First 1).Name}
    $cl=Join-Path $vc 'bin\Hostx64\x64\cl.exe';Require (Test-Path $cl) 'MSVC x64 missing'
    $include=(Join-Path $vc 'include')+';'+(Join-Path $sdk ('Include\'+$WindowsSdkVersion+'\ucrt'))+';'+(Join-Path $sdk ('Include\'+$WindowsSdkVersion+'\shared'))+';'+(Join-Path $sdk ('Include\'+$WindowsSdkVersion+'\um'))
    $lib=(Join-Path $vc 'lib\x64')+';'+(Join-Path $sdk ('Lib\'+$WindowsSdkVersion+'\ucrt\x64'))+';'+(Join-Path $sdk ('Lib\'+$WindowsSdkVersion+'\um\x64'))
    $mysql=Join-Path $SourceRoot 'src\shared\Database\DatabaseMysql.cpp'
    $ops=Join-Path $SourceRoot 'src\shared\Database\SqlOperations.cpp'
    $methods=@('#include "DatabaseEnv.h"','#include "Database/SqlOperations.h"',(Extract $mysql 'bool IsHandledStatementError('))
    foreach($sig in @('bool MySQLConnection::_Query(','bool MySQLConnection::Execute(','bool MySQLConnection::HandleMySQLError(','bool MySQLConnection::_TransactionCmd(','bool MySQLConnection::BeginTransaction(','bool MySQLConnection::CommitTransaction(','bool MySQLConnection::RollbackTransaction(','bool MySqlPreparedStatement::execute(')){$methods+=Extract $mysql $sig}
    foreach($sig in @('bool SqlPlainRequest::Execute(','SqlTransaction::~SqlTransaction(','bool SqlTransaction::Execute(')){$methods+=Extract $ops $sig}
    [IO.File]::WriteAllText((Join-Path $OutputDirectory 'Actual.SqlMethods.cpp'),($methods -join "`n"),[Text.UTF8Encoding]::new($false))
    foreach($pair in @(@('src\shared\Database\SqlDelayThread.cpp','Actual.Worker.cpp'),@('src\shared\ServiceWin32.cpp','Actual.ServiceWin32.cpp'))){[IO.File]::Copy((Join-Path $SourceRoot $pair[0]),(Join-Path $OutputDirectory $pair[1]),$false)}
    $exe=Join-Path $OutputDirectory 'NativeTests.exe'
    $flags=@('/nologo','/std:c++14','/EHsc','/MD','/Od','/DWIN32','/D_WIN32',('/I"'+$OutputDirectory+'"'),('/I"'+$PSScriptRoot+'"'),('/I"'+(Join-Path $SourceRoot 'src\shared')+'"'),('/I"'+(Join-Path $SourceRoot 'dep\windows\include\mysql')+'"'),('/Fo"'+$OutputDirectory+'/"'),('/Fd"'+$OutputDirectory+'/tests.pdb"'),('/Fe"'+$exe+'"'),('"'+(Join-Path $PSScriptRoot 'Harness.cpp')+'"'),('"'+(Join-Path $OutputDirectory 'Actual.SqlMethods.cpp')+'"'),('"'+(Join-Path $OutputDirectory 'Actual.Worker.cpp')+'"'),'/link','advapi32.lib')
    $rsp=Join-Path $OutputDirectory 'test.rsp';[IO.File]::WriteAllLines($rsp,[string[]]$flags,[Text.Encoding]::ASCII)
    $cmd=Join-Path $OutputDirectory 'compile.cmd'
    [IO.File]::WriteAllLines($cmd,[string[]]@('@echo off',('set "INCLUDE='+$include+'"'),('set "LIB='+$lib+'"'),('"'+$cl+'" @"'+$rsp+'"'),'exit /b %errorlevel%'),[Text.Encoding]::ASCII)
    $build=Child (Join-Path $env:SystemRoot 'System32\cmd.exe') @('/d','/c',$cmd) 'compile' 120000
    Require ($build.NativeExit -eq 0 -and $build.State -ceq 'MEASURED') 'Test compilation failed: inspect compile stdout/stderr'
    $cases=@('worker-success','stop-before-loop','late-during-drain','late-after-run','init-failed','worker-exception','worker-unknown','worker-1053','worker-1053-stop','write-lost-no-replay','handled-duplicate','handled-deadlock','commit-1053','commit-deadlock','query-success','query-1053-first','query-1053-last','query-reconnect-success','query-retry-exhausted','query-duplicate','query-deadlock','prepared-duplicate','prepared-deadlock','prepared-1053')
    $expectedFailure=@('late-after-run','init-failed','worker-exception','worker-unknown','worker-1053','worker-1053-stop','write-lost-no-replay','commit-1053','query-1053-first','query-1053-last','query-retry-exhausted','prepared-1053')
    $rows=@(foreach($caseName in $cases){
        $expected=0;if($caseName -cin $expectedFailure){$expected=1}
        $result=Child $exe @($caseName) $caseName 10000
        $data=$null;if(Test-Path $result.Stdout){$data=[IO.File]::ReadAllText($result.Stdout)|ConvertFrom-Json}
        $pass=$result.State -ceq 'MEASURED' -and $result.NativeExit -eq $expected -and $null -ne $data -and $data.Case -ceq $caseName -and $data.Pass -eq $true
        [pscustomobject]@{Case=$caseName;Pass=$pass;ExpectedNativeExit=$expected;Capture=$result;Data=$data}
    })
    $pins=@(foreach($path in @($mysql,$ops,(Join-Path $SourceRoot 'src\shared\Database\SqlDelayThread.cpp'),(Join-Path $SourceRoot 'src\shared\Database\SqlDelayThread.h'),(Join-Path $SourceRoot 'src\shared\Database\SqlOutcome.h'),(Join-Path $SourceRoot 'src\shared\ServiceWin32.cpp'))){[pscustomobject]@{Path=$path;SHA256=(SHA $path)}})
    $bad=@($rows|Where-Object {!$_.Pass})
    JSON 'RESULT.json' @{Result=$(if($bad.Count){'FAIL'}else{'PASS'});Count=$rows.Count;BuildNativeExit=$build.NativeExit;Cases=$rows;ProductionSourcePins=$pins;TestPins=@(Get-ChildItem $PSScriptRoot -Recurse -File|ForEach-Object {[pscustomobject]@{Path=$_.FullName.Substring($PSScriptRoot.Length+1);SHA256=(SHA $_.FullName)}});MSVC=$cl;SDK=$WindowsSdkVersion;RealSQLConnections=0;RealSCMCalls=0;FullServerBuild='NOT_RUN';Substitutions='Fake MySQL C API, connection reconnect, framework database/log/clock; SCM dispatcher/register/status/current-directory. Actual full SQL functions, exact worker and ServiceWin32 source. See README.'}
    Require ($bad.Count -eq 0) 'One or more cases failed; no automatic retry'
    Write-Output ('ISOLATED_TESTS=PASS cases='+$rows.Count+' compileNative=0');exit 0
}catch{JSON 'FAILURE.json' @{Result='FAIL';Error=$_.Exception.ToString();Stack=$_.ScriptStackTrace};Write-Error $_;exit 1}
