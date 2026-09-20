<#
.SYNOPSIS
Saves MuseScore clipboard XML and original bytes without changing the clipboard.
.DESCRIPTION
Run with Windows PowerShell in STA mode. The default prompt lets you copy a
MuseScore passage after launching the script. Dumps stay outside the repository
under LOCALAPPDATA\Viritura\clipboard-dumps, in a new directory per capture.
Only MuseScore notation payloads are saved, not unrelated clipboard contents.
Each capture includes capture.json with optional tags and notes describing the
notation, expected result, or observed error. Tags are comma-separated.
.EXAMPLE
powershell.exe -NoProfile -STA -File .\tools\clipboard\Dump-NotationClipboard.ps1
.EXAMPLE
powershell.exe -NoProfile -STA -File .\tools\clipboard\Dump-NotationClipboard.ps1 -Tags "hairpin,slur" -Notes "Two bars; paste reports unsupported Spanner"
#>
[CmdletBinding()]
param(
    [string]$OutputDirectory = (Join-Path $env:LOCALAPPDATA 'Viritura\clipboard-dumps'),
    [string]$Tags = '',
    [string]$Notes = '',
    [switch]$NoPrompt
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([System.Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') {
    throw 'Run with powershell.exe -NoProfile -STA -File <script-path>.'
}

if (-not ('Viritura.NotationClipboardCapture' -as [type])) {
    # Read native storage only: managed clipboard APIs may deserialize untrusted objects.
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace Viritura {
    public sealed class NotationClipboardCapture {
        public readonly string[] Formats;
        public readonly Dictionary<string, byte[]> Payloads;
        private static readonly string[] AllowedFormats = {
            "application/musescore/stafflist",
            "application/musescore/symbol",
            "application/musescore/symbollist"
        };

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool OpenClipboard(IntPtr owner);
        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool CloseClipboard();
        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint EnumClipboardFormats(uint format);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
        private static extern int GetClipboardFormatNameW(uint format, StringBuilder name, int capacity);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
        private static extern uint RegisterClipboardFormatW(string name);
        [DllImport("user32.dll")]
        private static extern bool IsClipboardFormatAvailable(uint format);
        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr GetClipboardData(uint format);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern UIntPtr GlobalSize(IntPtr handle);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr GlobalLock(IntPtr handle);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GlobalUnlock(IntPtr handle);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern void SetLastError(uint error);

        private NotationClipboardCapture(string[] formats, Dictionary<string, byte[]> payloads) {
            Formats = formats;
            Payloads = payloads;
        }

        private static string FormatName(uint format) {
            if (format >= 0xC000) {
                var name = new StringBuilder(256);
                if (GetClipboardFormatNameW(format, name, name.Capacity) == 0)
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot read clipboard format name.");
                return name.ToString();
            }
            switch (format) {
                case 1: return "Text";
                case 2: return "Bitmap";
                case 3: return "MetaFilePict";
                case 7: return "OEMText";
                case 8: return "DeviceIndependentBitmap";
                case 13: return "UnicodeText";
                case 14: return "EnhancedMetafile";
                case 15: return "FileDrop";
                case 16: return "Locale";
                default: return "CF_" + format;
            }
        }

        private static byte[] ReadBlock(IntPtr handle) {
            ulong length = GlobalSize(handle).ToUInt64();
            if (length == 0)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Clipboard payload is empty or unreadable.");
            if (length > 8UL * 1024 * 1024)
                throw new InvalidOperationException("Clipboard payload exceeds the 8 MiB limit.");
            var bytes = new byte[checked((int)length)];
            IntPtr pointer = GlobalLock(handle);
            if (pointer == IntPtr.Zero)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot lock clipboard payload.");
            try {
                Marshal.Copy(pointer, bytes, 0, bytes.Length);
                return bytes;
            } finally {
                // The clipboard owns this handle: unlock it, but never free it.
                GlobalUnlock(handle);
            }
        }

        public static NotationClipboardCapture Capture() {
            if (!OpenClipboard(IntPtr.Zero))
                throw new Win32Exception(Marshal.GetLastWin32Error(),
                    "Cannot open clipboard; it may be locked by another application. Try again later.");
            try {
                var formats = new List<string>();
                uint format = 0;
                while (true) {
                    SetLastError(0);
                    format = EnumClipboardFormats(format);
                    if (format == 0) {
                        int error = Marshal.GetLastWin32Error();
                        if (error != 0)
                            throw new Win32Exception(error, "Cannot enumerate clipboard formats.");
                        break;
                    }
                    if (formats.Count >= 4096)
                        throw new InvalidOperationException("Clipboard exceeds the 4096 format limit.");
                    formats.Add(FormatName(format));
                }
                var payloads = new Dictionary<string, byte[]>(StringComparer.Ordinal);
                foreach (string name in AllowedFormats) {
                    uint id = RegisterClipboardFormatW(name);
                    if (id == 0)
                        throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot identify notation format.");
                    if (!IsClipboardFormatAvailable(id)) continue;
                    IntPtr handle = GetClipboardData(id);
                    if (handle == IntPtr.Zero)
                        throw new Win32Exception(Marshal.GetLastWin32Error(),
                            "Clipboard advertised '" + name + "' but returned no data. Copy again and rerun.");
                    payloads.Add(name, ReadBlock(handle));
                }
                return new NotationClipboardCapture(formats.ToArray(), payloads);
            } finally {
                CloseClipboard();
            }
        }
    }
}
'@
}

if (-not $NoPrompt) {
    if (-not $PSBoundParameters.ContainsKey('Tags')) {
        $Tags = Read-Host 'Tags, comma-separated (e.g. hairpin, slur, multiple voices; optional)'
    }
    if (-not $PSBoundParameters.ContainsKey('Notes')) {
        $Notes = Read-Host 'Notes: what this contains, expected behavior, or error (optional)'
    }
    Write-Host 'Copy the failing passage in MuseScore now.'
    [void](Read-Host 'Return here and press Enter to capture it (do not copy anything else)')
}

$clipboard = [Viritura.NotationClipboardCapture]::Capture()
$formats = @($clipboard.Formats)
$capturedAt = [DateTimeOffset]::Now
$captureTags = @($Tags.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique)
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
$savedPayloads = @()
$metadata = [ordered]@{
    version = 1
    capturedAt = $capturedAt.ToString('o')
    tags = $captureTags
    notes = $Notes
    formats = $formats
    payloads = $savedPayloads
    complete = $false
}
$metadataPath = Join-Path $captureDirectory 'capture.json'
[System.IO.File]::WriteAllText($metadataPath, ($metadata | ConvertTo-Json -Depth 5), $utf8)

foreach ($format in $notationFormats) {
    if (-not $clipboard.Payloads.ContainsKey($format)) { continue }
    $bytes = $clipboard.Payloads[$format]
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
    $savedPayloads += [ordered]@{
        format = $format
        bytes = $bytes.Length
        binaryFile = "$name.bin"
        xmlFile = "$name.xml"
    }
    $metadata.payloads = $savedPayloads
    [System.IO.File]::WriteAllText($metadataPath, ($metadata | ConvertTo-Json -Depth 5), $utf8)
}

$metadata.complete = $true
[System.IO.File]::WriteAllText($metadataPath, ($metadata | ConvertTo-Json -Depth 5), $utf8)
Write-Host "Capture directory: $captureDirectory"
Write-Host "Tags and notes: $metadataPath"
if ($savedPayloads.Count -eq 0) {
    Write-Warning 'No native MuseScore notation format found. Copy notes in MuseScore, not text or a screenshot.'
    Write-Host ("Available formats: {0}" -f ($formats -join ', '))
} else {
    Write-Host 'Capture complete. Share the capture directory path for investigation.'
}
