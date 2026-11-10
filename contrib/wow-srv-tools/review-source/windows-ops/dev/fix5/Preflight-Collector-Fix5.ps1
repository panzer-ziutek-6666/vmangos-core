. (Join-Path $PSScriptRoot Preflight.Common.ps1)
$name='VMANGOS-ADMIN-PANEL-TELEMETRY';$task=Get-ScheduledTask -TaskName $name -TaskPath '\' -ErrorAction Stop
Need ($task.Settings.Enabled -and [string]$task.State -ceq 'Running' -and $task.Principal.UserId -in @('SYSTEM','S-1-5-18')) 'COLLECTOR_TASK_STATE_OR_PRINCIPAL'
$actions=@($task.Actions);$worker=Join-Path $Plan.CollectorRoot Run-TelemetryWorker.ps1
Need ($actions.Count -eq 1 -and $actions[0].Execute -ieq 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -and $actions[0].Arguments.Contains($worker)) 'COLLECTOR_TASK_ACTION_BINDING'
$processes=@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -ieq $actions[0].Execute -and $_.CommandLine -and $_.CommandLine.Contains($worker)})
Need ($processes.Count -eq 1) 'COLLECTOR_PROCESS_BINDING'
$scheduler=New-Object -ComObject Schedule.Service;$scheduler.Connect();$registered=$scheduler.GetFolder('\').GetTask($name);$instances=$registered.GetInstances(0)
Need ($instances.Count -eq 1 -and [long]$instances.Item(1).EnginePID -eq [long]$processes[0].ProcessId) 'COLLECTOR_TASK_INSTANCE_PID'
$scriptText=[IO.File]::ReadAllText($worker);Need ($scriptText.Contains('$PSScriptRoot')) 'COLLECTOR_ROOT_RESOLUTION_REVIEW_REQUIRED'
SaveJson COLLECTOR-TASK-BINDING.json @{Result='PASS';Task=$name;Path='\';State=[string]$task.State;Enabled=[bool]$task.Settings.Enabled;Principal=$task.Principal.UserId;Exe=$actions[0].Execute;Arguments=$actions[0].Arguments;WorkingDirectory=$actions[0].WorkingDirectory;Worker=$worker;WorkerSHA256=(Hash $worker);TaskInstancePID=[long]$instances.Item(1).EnginePID;Process=@{PID=[long]$processes[0].ProcessId;ParentPID=[long]$processes[0].ParentProcessId;CreatedUtc=$processes[0].CreationDate.ToUniversalTime().ToString('o');Exe=$processes[0].ExecutablePath};HistoricalWorkingDirectory='Preserved; worker uses its pinned PSScriptRoot';EarlierBroadNameFilter='SUPPLEMENT-READ.CollectorTasks selected Windows diagnostic task, not authoritative for VMaNGOS task. This exact action/instance binding supersedes that field only.';AtUtc=[DateTimeOffset]::UtcNow.ToString('o')}
'OK=True';'CHANGE_SCOPE=EXACT_COLLECTOR_TASK_READ_ONLY';'LOG='+$Out;'NEXT_STEP=Final report'
