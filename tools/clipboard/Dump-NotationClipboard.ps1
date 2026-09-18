<#
.SYNOPSIS
Saves MuseScore clipboard XML and original bytes without changing the clipboard.
.DESCRIPTION
Run with Windows PowerShell in STA mode. The default prompt lets you copy a
MuseScore passage after launching the script. Dumps stay outside the repository
under LOCALAPPDATA\Viritura\clipboard-dumps, in a new directory per capture.
Only MuseScore notation payloads are saved, not unrelated clipboard contents.
.EXAMPLE
powershell.exe -NoProfile -STA -File .\tools\clipboard\Dump-NotationClipboard.ps1
#>
[CmdletBinding()]
param(
    [string]$OutputDirectory = (Join-Path $env:LOCALAPPDATA 'Viritura\clipboard-dumps'),
    [switch]$NoPrompt
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function ConvertTo-NotationBytes {
    param([Parameter(Mandatory = $true)][object]$Payload)

    $maximumBytes = 8 * 1024 * 1024
    if ($Payload -is [System.IO.MemoryStream]) {
        if ($Payload.Length -gt $maximumBytes) {
            throw 'Clipboard payload exceeds the 8 MiB limit.'
        }
        return ,$Payload.ToArray()
    }
    if ($Payload -is [byte[]]) {
        if ($Payload.Length -gt $maximumBytes) {
            throw 'Clipboard payload exceeds the 8 MiB limit.'
        }
        return ,$Payload
    }
    if ($Payload -is [string]) {
        $utf8 = New-Object System.Text.UTF8Encoding($false, $true)
        if ($utf8.GetByteCount($Payload) -gt $maximumBytes) {
            throw 'Clipboard payload exceeds the 8 MiB limit.'
        }
        return ,$utf8.GetBytes($Payload)
    }
    throw "Unsupported clipboard payload type: $($Payload.GetType().FullName)"
}

if ([System.Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') {
    throw 'Run with powershell.exe -NoProfile -STA -File <script-path>.'
}
Add-Type -AssemblyName System.Windows.Forms

if (-not $NoPrompt) {
    Write-Host 'Copy the failing passage in MuseScore now.'
    [void](Read-Host 'Return here and press Enter to capture it (do not copy anything else)')
}

$clipboard = [System.Windows.Forms.Clipboard]::GetDataObject()
if ($null -eq $clipboard) {
    throw 'Clipboard is empty. Copy a passage in MuseScore and run again.'
}

$formats = @($clipboard.GetFormats($false))
$notationFormats = @(
    'application/musescore/stafflist'
    'application/musescore/symbol'
    'application/musescore/symbollist'
)
$captureName = '{0}-{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmss-fff'), ([guid]::NewGuid().ToString('N').Substring(0, 8))
$captureDirectory = Join-Path $OutputDirectory $captureName
[void](New-Item -ItemType Directory -Path $captureDirectory -Force)
$utf8 = New-Object System.Text.UTF8Encoding($false, $true)
[System.IO.File]::WriteAllLines((Join-Path $captureDirectory 'formats.txt'), [string[]]$formats, $utf8)
$saved = 0

foreach ($format in $notationFormats) {
    if ($formats -cnotcontains $format) { continue }
    $payload = $clipboard.GetData($format, $false)
    if ($null -eq $payload) {
        throw "Clipboard advertised '$format' but returned no data. Copy again and rerun."
    }
    $bytes = ConvertTo-NotationBytes -Payload $payload
    $name = $format.Substring($format.LastIndexOf('/') + 1)
    $binaryPath = Join-Path $captureDirectory "$name.bin"
    [System.IO.File]::WriteAllBytes($binaryPath, $bytes)

    # Preserve original bytes separately; strip only NUL storage padding in the readable copy.
    $length = $bytes.Length
    while ($length -gt 0 -and $bytes[$length - 1] -eq 0) { $length-- }
    $xml = $utf8.GetString($bytes, 0, $length)
    $xmlPath = Join-Path $captureDirectory "$name.xml"
    [System.IO.File]::WriteAllText($xmlPath, $xml, $utf8)
    Write-Host ("Saved {0} ({1} bytes): {2}" -f $format, $bytes.Length, $xmlPath)
    $saved++
}

Write-Host "Capture directory: $captureDirectory"
if ($saved -eq 0) {
    Write-Warning 'No native MuseScore notation format found. Copy notes in MuseScore, not text or a screenshot.'
    Write-Host ("Available formats: {0}" -f ($formats -join ', '))
} else {
    Write-Host 'Capture complete. Share the capture directory path for investigation.'
}
