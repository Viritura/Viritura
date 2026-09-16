[CmdletBinding()]
param(
    [string] $BuildRoot = (Join-Path $env:LOCALAPPDATA "Viritura\sfizz-browser-build"),
    [switch] $Force
)

$ErrorActionPreference = "Stop"
$vendorDirectory = $PSScriptRoot
$metadata = Get-Content (Join-Path $vendorDirectory "sfizz-runtime.json") -Raw | ConvertFrom-Json
$artifactPath = Join-Path $vendorDirectory $metadata.artifact
$sourceDirectory = Join-Path $BuildRoot "sfizz-webaudio"
$engineDirectory = Join-Path $sourceDirectory "sfizz"
$emsdkDirectory = Join-Path $BuildRoot "emsdk"
$buildDirectory = Join-Path $BuildRoot "build"
$ninjaDirectory = Join-Path $BuildRoot "tools\ninja-$($metadata.ninjaVersion)"
$ninjaArchive = Join-Path $ninjaDirectory "ninja-win.zip"
$ninjaPath = Join-Path $ninjaDirectory "ninja.exe"

function Invoke-Native([string] $Executable, [string[]] $Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Executable failed with exit code $LASTEXITCODE"
    }
}

function Get-NativeOutput([string] $Executable, [string[]] $Arguments) {
    $output = & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Executable failed with exit code $LASTEXITCODE"
    }
    return ($output | Out-String).Trim()
}

function Get-Sha256([string] $Path) {
    return (Get-FileHash $Path -Algorithm SHA256).Hash.ToUpperInvariant()
}

function Test-Artifact {
    if (-not (Test-Path $artifactPath -PathType Leaf)) {
        return $false
    }
    return (Get-Sha256 $artifactPath) -eq $metadata.artifactSha256
}

function Ensure-Checkout([string] $Directory, [string] $Repository, [string] $Commit) {
    if (-not (Test-Path (Join-Path $Directory ".git"))) {
        if (Test-Path $Directory) {
            throw "Build source directory already exists without a Git checkout: $Directory"
        }
        Invoke-Native "git" @("clone", "--no-checkout", "--filter=blob:none", $Repository, $Directory)
        Invoke-Native "git" @("-C", $Directory, "fetch", "--depth", "1", "origin", $Commit)
        Invoke-Native "git" @("-C", $Directory, "checkout", "--detach", $Commit)
    }
    $actualCommit = Get-NativeOutput "git" @("-C", $Directory, "rev-parse", "HEAD")
    if ($actualCommit -ne $Commit) {
        throw "Expected $Directory at $Commit, found $actualCommit"
    }
}

function Ensure-SourcePatch([string] $Directory, [string] $Patch) {
    & git -C $Directory apply --reverse --check $Patch 2>$null
    if ($LASTEXITCODE -eq 0) {
        return
    }
    Invoke-Native "git" @("-C", $Directory, "apply", "--check", $Patch)
    Invoke-Native "git" @("-C", $Directory, "apply", $Patch)
}

if (-not $Force -and (Test-Artifact)) {
    Write-Host "sfizz runtime already matches $($metadata.artifactSha256)"
    exit 0
}

foreach ($command in @("git", "cmake", "curl.exe")) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "Required build command is unavailable: $command"
    }
}

New-Item -ItemType Directory -Force -Path $BuildRoot | Out-Null
Ensure-Checkout $sourceDirectory $metadata.sfizzWebaudioRepository $metadata.sfizzWebaudioCommit
Invoke-Native "git" @("-C", $sourceDirectory, "submodule", "update", "--init", "--depth", "1", "sfizz")

$actualEngineCommit = Get-NativeOutput "git" @("-C", $engineDirectory, "rev-parse", "HEAD")
if ($actualEngineCommit -ne $metadata.sfizzCommit) {
    throw "Expected sfizz at $($metadata.sfizzCommit), found $actualEngineCommit"
}
Invoke-Native "git" @(
    "-C", $engineDirectory, "submodule", "update", "--init", "--depth", "1",
    "external/abseil-cpp",
    "external/filesystem",
    "external/simde",
    "external/st_audiofile/thirdparty/dr_libs",
    "external/st_audiofile/thirdparty/libaiff",
    "external/st_audiofile/thirdparty/stb_vorbis"
)

Ensure-SourcePatch $sourceDirectory (Join-Path $vendorDirectory "patches\sfizz-webaudio.patch")
Ensure-SourcePatch $engineDirectory (Join-Path $vendorDirectory "patches\sfizz-filedata-move.patch")

if (-not (Test-Path (Join-Path $emsdkDirectory ".git"))) {
    Invoke-Native "git" @(
        "clone", "--branch", $metadata.emsdkVersion, "--depth", "1",
        "https://github.com/emscripten-core/emsdk.git", $emsdkDirectory
    )
}
$actualEmsdkCommit = Get-NativeOutput "git" @("-C", $emsdkDirectory, "rev-parse", "HEAD")
if ($actualEmsdkCommit -ne $metadata.emsdkCommit) {
    throw "Expected emsdk at $($metadata.emsdkCommit), found $actualEmsdkCommit"
}

$emccPath = Join-Path $emsdkDirectory "upstream\emscripten\emcc.bat"
if (-not (Test-Path $emccPath)) {
    Invoke-Native (Join-Path $emsdkDirectory "emsdk.bat") @("install", $metadata.emsdkVersion)
}
Invoke-Native (Join-Path $emsdkDirectory "emsdk.bat") @("activate", $metadata.emsdkVersion)

if (-not (Test-Path $ninjaPath)) {
    New-Item -ItemType Directory -Force -Path $ninjaDirectory | Out-Null
    Invoke-Native "curl.exe" @(
        "-L", "--fail", "--silent", "--show-error", "-o", $ninjaArchive, $metadata.ninjaWindowsUrl
    )
    $ninjaHash = Get-Sha256 $ninjaArchive
    if ($ninjaHash -ne $metadata.ninjaWindowsSha256) {
        throw "Unexpected Ninja archive SHA-256 $ninjaHash"
    }
    Expand-Archive -Force $ninjaArchive $ninjaDirectory
}

$env:EMSDK_QUIET = "1"
$env:SOURCE_DATE_EPOCH = "1675422015"
$environmentScript = Join-Path $emsdkDirectory "emsdk_env.bat"
$emcmake = Join-Path $emsdkDirectory "upstream\emscripten\emcmake.bat"
$buildCommand = @(
    "call `"$environmentScript`" >nul",
    "call `"$emcmake`" cmake -S `"$sourceDirectory`" -B `"$buildDirectory`" -G Ninja -DCMAKE_MAKE_PROGRAM=`"$ninjaPath`" -DCMAKE_BUILD_TYPE=Release",
    "cmake --build `"$buildDirectory`" --parallel $([Environment]::ProcessorCount)"
) -join " && "
Invoke-Native $env:ComSpec @("/d", "/s", "/c", $buildCommand)

$builtArtifact = Join-Path $buildDirectory "sfizz.wasm.js"
$builtHash = Get-Sha256 $builtArtifact
$builtBytes = (Get-Item $builtArtifact).Length
if ($builtHash -ne $metadata.artifactSha256 -or $builtBytes -ne $metadata.artifactBytes) {
    throw "Unexpected sfizz runtime: SHA-256 $builtHash, $builtBytes bytes"
}
Copy-Item $builtArtifact $artifactPath -Force
Write-Host "Built sfizz runtime: SHA-256 $builtHash ($builtBytes bytes)"
