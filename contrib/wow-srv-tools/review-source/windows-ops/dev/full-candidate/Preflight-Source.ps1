. (Join-Path $PSScriptRoot 'Candidate.Core.ps1')
$script:Plan=GetJson (Join-Path $PSScriptRoot 'KIT-PLAN.json');$script:Options='C:\ProgramData\VMANGOS\R3Approvals\source-backup-candidate.ini';$script:QueryCount=0
$script:PrivateRaw=Join-Path $Out 'private-source-preflight';NewPrivate $script:PrivateRaw
Add-Type -Path (Join-Path $PSScriptRoot 'dependencies\Release.Native.cs')
$helper='C:\Scripts\DEV-INPUTS-PREP-R1-WOW-SRV-20261105-0206-PAYLOAD\Inputs.Common.ps1'
Need ((Hash $helper) -ceq '8F8A42CEEA8FEF0AEE251ABC79BDEC2C91CA944CCAD7358EF78A0F02569DB41A') 'READ_QUERY_HELPER_PIN'
$t=$null;$e=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($helper,[ref]$t,[ref]$e);Need ($e.Count -eq 0) 'HELPER_SYNTAX'
foreach($n in @('InvokeReadQuery','AssertSourceInstance')){$fn=@($ast.EndBlock.Statements|Where-Object {$_ -is [Management.Automation.Language.FunctionDefinitionAst] -and $_.Name -ceq $n});Need ($fn.Count -eq 1) 'HELPER_FUNCTION';. ([scriptblock]::Create($fn[0].Extent.Text))}
AssertPrivate $Options
$probe=[pscustomobject]@{Plan=$Plan;Kind='Backup'};AssertDevNamespace $probe;AssertCandidateInputs $probe;AssertBaseline $probe;AssertKitPins
$binding=AssertSourceInstance $Plan
$identity=InvokeReadQuery 'SOURCE-IDENTITY' 'SELECT /*+ MAX_EXECUTION_TIME(5000) */ @@hostname,@@port,@@datadir,@@server_uuid,@@version,CURRENT_USER(),@@global.skip_replica_start;'
$parts=$identity.Trim().Split([char]9)
Need ($parts.Count -eq 7 -and $parts[0] -ceq 'WOW-SRV' -and $parts[1] -ceq '3306' -and $parts[3] -ceq $Plan.CandidateBinding.SourceUUID -and [IO.Path]::GetFullPath($parts[2].Replace('/','\')).TrimEnd('\') -ieq $Plan.CandidateBinding.SourceDatadir.TrimEnd('\')) 'SOURCE_IDENTITY'
$names=($Plan.DatabaseNames|ForEach-Object {"'"+$_+"'"}) -join ','
$text=InvokeReadQuery 'ENGINES' ('SELECT /*+ MAX_EXECUTION_TIME(5000) */ TABLE_SCHEMA,ENGINE,COUNT(*),COALESCE(SUM(DATA_LENGTH+INDEX_LENGTH),0) FROM information_schema.TABLES WHERE TABLE_SCHEMA IN ('+$names+") AND TABLE_TYPE='BASE TABLE' GROUP BY TABLE_SCHEMA,ENGINE ORDER BY TABLE_SCHEMA,ENGINE;")
$engines=@(foreach($line in ($text.Trim() -split "`r?`n")){$p=$line.Split([char]9);Need ($p.Count -eq 4 -and $p[1] -ceq 'InnoDB') 'ALL_INNODB_REQUIRED';[pscustomobject]@{Database=$p[0];Engine=$p[1];Tables=[long]$p[2];Bytes=[long]$p[3]}})
Need ($engines.Count -eq 4) 'FOUR_DATABASES'
$ddl=InvokeReadQuery 'DDL' ("SELECT /*+ MAX_EXECUTION_TIME(5000) */ COUNT(*) FROM information_schema.PROCESSLIST WHERE ID<>CONNECTION_ID() AND COMMAND<>'Sleep' AND COALESCE(INFO,'') REGEXP '(^|[[:space:];])(ALTER|CREATE|DROP|RENAME|TRUNCATE)[[:space:]]' AND (DB IN ("+$names+") OR DB IS NULL OR COALESCE(INFO,'') REGEXP '(realmd_dev|mangos_dev|characters_dev|logs_dev)');")
Need ($ddl.Trim() -ceq '0') 'ACTIVE_DDL_BLOCKER'
$grants=InvokeReadQuery 'GRANTS' 'SHOW GRANTS';$privs=@('SELECT','SHOW VIEW','TRIGGER','EVENT','PROCESS','SHOW_ROUTINE');foreach($priv in $privs){Need ($grants -match ('(?im)(^GRANT\s+ALL PRIVILEGES|(?:GRANT\s+|,\s*)'+[regex]::Escape($priv)+'(?:,|\s+ON))')) ('BACKUP_PRIVILEGE '+$priv)};$grants=$null
$sets=@();$header=[IO.File]::ReadAllText('C:\Scripts\CORE-CAND-20261109-0210\source\src\shared\migrations_list.h');$map=@{WORLD='mangos_dev';CHARACTERS='characters_dev';LOGON='realmd_dev';LOGS='logs_dev'}
foreach($block in [regex]::Matches($header,'(?s)static const char \*MIGRATIONS_(\w+)\[\]\s*=\s*\{([^}]+)\}')){$db=$map[$block.Groups[1].Value];$expected=@([regex]::Matches($block.Groups[2].Value,'"(\d{14})"')|ForEach-Object {$_.Groups[1].Value});$actual=@((InvokeReadQuery ('MIGRATIONS-'+$block.Groups[1].Value) ('SELECT /*+ MAX_EXECUTION_TIME(5000) */ id FROM '+$db+'.migrations ORDER BY id;')).Trim() -split "`r?`n");$missing=@($expected|Where-Object {$_ -cnotin $actual});$extra=@($actual|Where-Object {$_ -cnotin $expected});$wanted=@($Plan.CandidateBinding.SQL|Where-Object Database -ceq $db|ForEach-Object Id);Need (($missing -join ',') -ceq ($wanted -join ',') -and $extra.Count -eq 0) 'SOURCE_MIGRATION_DELTA_CHANGED';$sets+=[pscustomobject]@{Database=$db;Missing=$missing;Extra=$extra}}
Need (!(Test-Path $Plan.Dev.Root)) 'NEW_NAMESPACE_EXISTS'
foreach($n in @($Plan.Dev.MySQL,$Plan.Dev.Realm,$Plan.Dev.World)){Need ($null -eq (Get-CimInstance Win32_Service -Filter ("Name='"+$n+"'"))) 'NEW_SERVICE_EXISTS'}
foreach($n in @('VMANGOS-R3DEV-MySQL','VMANGOS-R3DEV-realmd','VMANGOS-R3DEV-mangosd')){$s=Get-CimInstance Win32_Service -Filter ("Name='"+$n+"'");Need ($s.State -ceq 'Stopped' -and $s.ProcessId -eq 0) 'OLD_DEV_NOT_STOPPED'}
foreach($p in @(23306,23724,28085,27878,13306,13724,18085,17878)){Need (@(Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue).Count -eq 0) 'DEV_PORT_OCCUPIED'}
Need ((Get-PSDrive C).Free -gt 40GB) 'DISK_SPACE'
$lock=[Threading.Mutex]::new($false,'Global\WOW-SRV-R3-Operation');$owns=$lock.WaitOne(0);try{Need $owns 'CONCURRENT_OPERATION'}finally{if($owns){$lock.ReleaseMutex()};$lock.Dispose()}
SaveJson 'SOURCE-PREFLIGHT.json' @{Result='PASS';AtUtc=[DateTimeOffset]::UtcNow.ToString('o');Host=$env:COMPUTERNAME;User=[Security.Principal.WindowsIdentity]::GetCurrent().Name;Admin=$true;PS=$PSVersionTable.PSVersion.ToString();DesktopX64=$true;CWD=(Get-Location).Path;SourceUUID=$parts[3];Datadir=$parts[2];SourcePort=3306;SourceBinding=$binding;Engines=$engines;MigrationSets=$sets;ActiveDDL=0;BackupPrivileges=$privs;FreeC=(Get-PSDrive C).Free;NoDDLWindow='EXPLICIT_USER_APPROVAL_FOR_THIS_COPY';Operations='READ_ONLY';Queries=$script:QueryCount}
exit 0
