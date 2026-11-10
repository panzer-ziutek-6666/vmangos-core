function Read-NativeVerifyOutput {
    [CmdletBinding()]
    param([AllowEmptyString()][string]$Stdout,[int]$ExitCode)
    if($null -eq $Stdout -or $Stdout.Length -gt 2048){throw 'A154_NATIVE_VERIFY_FORMAT'}
    if($ExitCode -eq 0 -and $Stdout -cmatch '\AA142_INSTALLED_SEAL_VERIFIED=True CLR_STARTED=False LIVE_CONNECTIONS=0\r?\n\z'){
        return [pscustomobject][ordered]@{Kind='Verified';DiagnosticAvailable=$false;DetailLine=$null}
    }
    if($ExitCode -ne 1){throw 'A154_NATIVE_VERIFY_EXIT_OR_FORMAT'}
    if($Stdout -cmatch '\AA142_NATIVE_BOOTSTRAP_REFUSED=True LIVE_CONNECTIONS=0\r?\n\z'){
        return [pscustomobject][ordered]@{Kind='Refused';DiagnosticAvailable=$false;DetailLine=$null}
    }
    # The specific refusal is TWO lines: diagnostic followed by the generic
    # marker. Never pass this whole capture as one Write-Audit field.
    $pattern='\A(?<detail>A151_NATIVE_REFUSAL SOURCE=bootstrap_win32\.cpp LINE=(?<line>[0-9]{1,10}) WIN32_OBSERVED=(?<win32>[0-9]{1,10}) OBJECT=\[(?<object>[^\[\]\r\n]{1,240})\] SID=(?<sid>S-[0-9]+(?:-[0-9]+)+|UNAVAILABLE) MASK=(?<mask>[0-9]{1,10}) FLAGS=(?<flags>[0-9]{1,3}) LIVE_CONNECTIONS=0)\r?\nA142_NATIVE_BOOTSTRAP_REFUSED=True LIVE_CONNECTIONS=0\r?\n\z'
    $match=[regex]::Match($Stdout,$pattern,[Text.RegularExpressions.RegexOptions]::CultureInvariant)
    if(-not $match.Success){throw 'A154_NATIVE_VERIFY_FORMAT'}
    foreach($c in $Stdout.ToCharArray()){
        $code=[int]$c
        if(($code -lt 32 -and $code -notin @(10,13)) -or $code -gt 126){throw 'A154_NATIVE_VERIFY_FORMAT'}
    }
    $line=[uint64]::Parse($match.Groups['line'].Value,[Globalization.CultureInfo]::InvariantCulture)
    $win32=[uint64]::Parse($match.Groups['win32'].Value,[Globalization.CultureInfo]::InvariantCulture)
    $mask=[uint64]::Parse($match.Groups['mask'].Value,[Globalization.CultureInfo]::InvariantCulture)
    $flags=[uint64]::Parse($match.Groups['flags'].Value,[Globalization.CultureInfo]::InvariantCulture)
    if($line -eq 0 -or $line -gt [uint32]::MaxValue -or $win32 -gt [uint32]::MaxValue -or
        $mask -gt [uint32]::MaxValue -or $flags -gt 255){throw 'A154_NATIVE_VERIFY_RANGE'}
    return [pscustomobject][ordered]@{
        Kind='Refused';DiagnosticAvailable=$true;DetailLine=$match.Groups['detail'].Value
        Source='bootstrap_win32.cpp';Line=[uint32]$line;Win32Observed=[uint32]$win32
        Object=$match.Groups['object'].Value;Sid=$match.Groups['sid'].Value;Mask=[uint32]$mask;Flags=[byte]$flags
    }
}

function Write-NativeRefusalDiagnostic {
    param($Result)
    if($null -eq $Result.Native){return}
    $parsed=Read-NativeVerifyOutput -Stdout ([string]$Result.Native.Stdout) -ExitCode ([int]$Result.Native.ExitCode)
    if($parsed.Kind -ceq 'Refused' -and $parsed.DiagnosticAvailable){
        Write-Audit ('NATIVE_REFUSAL_DETAIL='+$parsed.DetailLine)
    }
}
