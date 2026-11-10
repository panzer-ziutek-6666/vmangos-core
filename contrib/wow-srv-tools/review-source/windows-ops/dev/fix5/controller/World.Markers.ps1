function Get-WorldMarkers([string]$Path,[DateTime]$ProcessCreatedUtc){
    $fs=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    $reader=New-Object IO.StreamReader($fs,[Text.Encoding]::UTF8,$true,65536)
    $start=$null;$ready=$null;$failure=$null;$number=0;$startLine=0;$readyLine=0
    try{while($null -ne ($line=$reader.ReadLine())){
        $number++;$m=[regex]::Match($line,'^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) (Starting service\.\.\.|World initialized\.|Unhandled exception.*|Access violation.*|Crash dump written.*)$')
        if(-not $m.Success){continue}
        $local=[DateTime]::ParseExact($m.Groups[1].Value,'yyyy-MM-dd HH:mm:ss',[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeLocal)
        $utc=$local.ToUniversalTime();if($utc -lt $ProcessCreatedUtc.AddSeconds(-2)){continue}
        $body=$m.Groups[2].Value
        if($body -ceq 'Starting service...'){$start=$utc.ToString('o');$startLine=$number;$ready=$null;$readyLine=0}
        elseif($body -ceq 'World initialized.' -and $startLine -gt 0 -and $number -gt $startLine){$ready=$utc.ToString('o');$readyLine=$number}
        elseif($body -cne 'World initialized.'){$failure=$body.Split(' ')[0]}
    }}finally{$reader.Dispose();$fs.Dispose()}
    [pscustomobject]@{Path=$Path;StartUtc=$start;ReadyUtc=$ready;StartLine=$startLine;ReadyLine=$readyLine;Failure=$failure;Share='ReadWrite|Delete';GenerationUtc=$ProcessCreatedUtc.ToString('o')}
}