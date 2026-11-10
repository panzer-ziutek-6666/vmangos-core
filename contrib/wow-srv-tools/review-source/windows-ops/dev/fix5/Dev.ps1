function LogicalBackup($Run,[string]$SourceDefaults){
 AssertPrivate $SourceDefaults;Need ($Run.State.Approval.NoDDLWindow -is [bool] -and $Run.State.Approval.NoDDLWindow) 'NO_DDL_WINDOW_REQUIRED'
 $dir=Join-Path $Run.Plan.BackupRoot ($Run.Id+'-logical');NewPrivate $dir;$dump=Join-Path $dir 'four-databases.sql'
 $query=Join-Path $Run.Out 'engine-preflight.sql'
 $names=($Run.Plan.DatabaseNames|ForEach-Object {"'"+$_+"'"}) -join ','
 [IO.File]::WriteAllText($query,('SELECT TABLE_SCHEMA,TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA IN ('+$names+") AND TABLE_TYPE='BASE TABLE' AND ENGINE<>'InnoDB';"),[Text.UTF8Encoding]::new($false))
 $probe=InvokeInputFile $Run (Join-Path $Run.Plan.MySQLBin 'mysql.exe') @(('--defaults-extra-file='+$SourceDefaults),'--protocol=TCP','--host=127.0.0.1','--port=3306','--batch','--skip-column-names') $query 'SOURCE-ENGINES' 60000
  $engines=[IO.File]::ReadAllText($probe.Stdout);$strategy=$Run.State.Approval.SnapshotStrategy
 Need ($strategy -cin @('AllInnoDB','QuiescentGlobalReadLock')) 'EXPLICIT_SNAPSHOT_STRATEGY_REQUIRED'
 $snapshotOption='--single-transaction';$snapshotProof='ALL_INNODB_SINGLE_TRANSACTION_NO_DDL_WINDOW'
 if($strategy -ceq 'AllInnoDB'){Need ([string]::IsNullOrWhiteSpace($engines)) 'NONTRANSACTIONAL_TABLES_REQUIRE_QUIESCENT_GLOBAL_READ_LOCK'}else{
  Need ($Run.State.Approval.AllowGlobalReadLock -is [bool] -and $Run.State.Approval.AllowGlobalReadLock) 'GLOBAL_READ_LOCK_SEPARATE_APPROVAL_REQUIRED'
  if(!$Run.State.ContainsKey('Module')){LoadProduction $Run}
  Assert-BackendQuiescent 'mangosd';Assert-BackendQuiescent 'realmd'
  $snapshotOption='--lock-all-tables';$snapshotProof='CONFIRMED_WORLD_REALM_DOWN_GLOBAL_READ_LOCK_NO_DDL_WINDOW'
 }
 $argsList=@(('--defaults-extra-file='+$SourceDefaults),'--protocol=TCP','--host=127.0.0.1','--port=3306',$snapshotOption,'--quick','--routines','--events','--triggers','--hex-blob','--set-gtid-purged=OFF','--no-tablespaces',('--result-file='+$dump),'--databases')+@($Run.Plan.DatabaseNames)
 $native=NativeKit $Run (Join-Path $Run.Plan.MySQLBin 'mysqldump.exe') $argsList 'LOGICAL-DUMP' 3600000
 if($strategy -ceq 'QuiescentGlobalReadLock'){Assert-BackendQuiescent 'mangosd';Assert-BackendQuiescent 'realmd'};Need ((Get-Item $dump).Length -gt 10000) 'LOGICAL_DUMP_EMPTY';AssertPrivate $dump
 $s=[IO.File]::OpenRead($dump);try{[void]$s.Seek([Math]::Max(0,$s.Length-8192),[IO.SeekOrigin]::Begin);$reader=[IO.StreamReader]::new($s);$tail=$reader.ReadToEnd();$reader.Dispose()}finally{$s.Dispose()}
 Need ($tail.Contains('-- Dump completed on')) 'LOGICAL_DUMP_NO_COMPLETION_MARKER'
 $Run.State.LogicalBackup=[pscustomobject]@{Path=$dump;SHA256=(Hash $dump);Bytes=(Get-Item $dump).Length;CreatedUtc=[DateTimeOffset]::UtcNow.ToString('o');SourcePort=3306;DatabaseNames=$Run.Plan.DatabaseNames;NativeExit=$native.ExitCode;ConsistentSnapshot=$snapshotProof;PhysicalDataCopied=$false}
 $Run.Receipt.LogicalBackup=$Run.State.LogicalBackup;PutJson (Join-Path $dir 'BACKUP-RECEIPT.json') $Run.State.LogicalBackup
}
function SetDevConfig([string]$Text,[string]$Key,[string]$Value){
 $pattern='(?m)^\s*'+[regex]::Escape($Key)+'\s*=.*$';$line=$Key+' = '+$Value
 if([regex]::IsMatch($Text,$pattern)){return [regex]::Replace($Text,$pattern,$line.Replace('$','$$'))};return $Text+"`r`n"+$line+"`r`n"
}
function ProvisionDevConfigs($Run,[string]$SecretPath){
 AssertPrivate $SecretPath;$secret=GetJson $SecretPath
 foreach($key in @('DevAdminPassword','DevCorePassword')){Need ($secret.$key -cmatch '^[A-Za-z0-9_-]{32,128}$' -and !$secret.$key.Contains('REPLACE')) 'DEV_PRIVATE_RANDOM_PASSWORD_REQUIRED'}
 Need ($secret.DevAdminPassword -cne $secret.DevCorePassword) 'DEV_DISTINCT_PASSWORDS'
 $d=$Run.Plan.Dev;$password=$secret.DevCorePassword
 foreach($name in @('mangosd','realmd')){
  $text=[IO.File]::ReadAllText((Join-Path $PSScriptRoot ('dev-templates\'+$name+'.conf.dist.in')))
  $map=@{BindIP='"127.0.0.1"';LogsDir=('"'+$d.Logs.Replace('\','/')+'"')}
  if($name -ceq 'mangosd'){$map.WorldServerPort='18085';$map.RealmID='1';$map.DataDir=('"'+$d.GameData.Replace('\','/')+'"');$map.'SOAP.Enabled'='0';$map.'SOAP.IP'='"127.0.0.1"';$map.'SOAP.Port'='17878';$map.LogTime='1';$map.'LogFile.Timestamp'='0';$map.AutoHonorRestart='1';$map.'AiPlayerbot.ConfigFile'=('"'+(Join-Path $d.Runtime 'aiplayerbot.conf').Replace('\','/')+'"');$map.'AiPlayerbot.Enabled'='0';$map.'AiPlayerbot.RandomBotAutologin'='0'
   foreach($pair in @(@{Key='LoginDatabase.Info';DB='realmd_dev'},@{Key='WorldDatabase.Info';DB='mangos_dev'},@{Key='CharacterDatabase.Info';DB='characters_dev'},@{Key='LogsDatabase.Info';DB='logs_dev'})){$map[$pair.Key]='"127.0.0.1;13306;r3dev;'+$password+';'+$pair.DB+'"'}
  }else{$map.RealmServerPort='13724';$map.LoginDatabaseInfo='"127.0.0.1;13306;r3dev;'+$password+';realmd_dev"'}
  foreach($key in $map.Keys){$text=SetDevConfig $text $key $map[$key]}
  [IO.File]::WriteAllText((Join-Path $d.Runtime ($name+'.conf')),$text,[Text.UTF8Encoding]::new($false))
 }
 [IO.File]::WriteAllText((Join-Path $d.Runtime 'aiplayerbot.conf'),"AiPlayerbot.Enabled = 0`r`nAiPlayerbot.RandomBotAutologin = 0`r`n",[Text.UTF8Encoding]::new($false))
 $ini="[mysqld]`r`nbasedir="+[IO.Path]::GetDirectoryName($Run.Plan.MySQLBin).Replace('\','/')+"`r`ndatadir="+$d.Data.Replace('\','/')+"`r`nport=13306`r`nbind-address=127.0.0.1`r`nmysqlx=0`r`nevent_scheduler=OFF`r`nlog-error="+(Join-Path $d.Logs 'mysql-error.log').Replace('\','/')+"`r`ninit-file="+(Join-Path $d.Root 'private\bootstrap.sql').Replace('\','/')+"`r`n"
 [IO.File]::WriteAllText($d.MySQLIni,$ini,[Text.UTF8Encoding]::new($false))
 [IO.File]::WriteAllText($d.Defaults,("[client]`r`nuser=root`r`npassword="+$secret.DevAdminPassword+"`r`nhost=127.0.0.1`r`nport=13306`r`n"),[Text.UTF8Encoding]::new($false))
 $sql="ALTER USER 'root'@'localhost' IDENTIFIED BY '"+$secret.DevAdminPassword+"';`r`nCREATE USER IF NOT EXISTS 'r3dev'@'127.0.0.1' IDENTIFIED BY '"+$password+"';`r`n"
 foreach($db in $Run.Plan.DatabaseNames){$sql+='GRANT ALL PRIVILEGES ON '+$db+".* TO 'r3dev'@'127.0.0.1';`r`n"}
 [IO.File]::WriteAllText((Join-Path $d.Root 'private\bootstrap.sql'),$sql,[Text.UTF8Encoding]::new($false))
 foreach($p in @($d.Defaults,(Join-Path $d.Root 'private\bootstrap.sql'),(Join-Path $d.Runtime 'mangosd.conf'),(Join-Path $d.Runtime 'realmd.conf'))){AssertPrivate $p}
}
function CreateDevServices($Run){
 $d=$Run.Plan.Dev
 foreach($name in @($d.MySQL,$d.Realm,$d.World)){Need ($null -eq (Get-Service -Name $name -ErrorAction SilentlyContinue)) ('DEV_SERVICE_ALREADY_EXISTS '+$name)}
 $rows=@(@{Name=$d.MySQL;Image=((Join-Path $Run.Plan.MySQLBin 'mysqld.exe')+' --defaults-file='+$d.MySQLIni+' '+$d.MySQL)},@{Name=$d.Realm;Image=((Join-Path $d.Runtime 'realmd.exe')+' -s run -c '+(Join-Path $d.Runtime 'realmd.conf'))},@{Name=$d.World;Image=((Join-Path $d.Runtime 'mangosd.exe')+' -s run -c '+(Join-Path $d.Runtime 'mangosd.conf'))})
 foreach($row in $rows){[void](NativeKit $Run 'C:\Windows\System32\sc.exe' @('create',$row.Name,'type=','own','start=','demand','binPath=',$row.Image) ('CREATE-'+$row.Name) 30000)}
 # DEV only. Production dependency/failure policy is not touched.
 [void](NativeKit $Run 'C:\Windows\System32\sc.exe' @('config',$d.Realm,'depend=',$d.MySQL) 'DEV-REALM-DEPENDENCY' 30000)
 [void](NativeKit $Run 'C:\Windows\System32\sc.exe' @('config',$d.World,'depend=',($d.Realm+'/'+$d.MySQL)) 'DEV-WORLD-DEPENDENCY' 30000)
}
