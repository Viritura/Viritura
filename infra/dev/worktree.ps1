<#
.SYNOPSIS
  Parallel Git-worktree development driver (Docker Compose + Traefik).

.DESCRIPTION
  Detects the current Git worktree/branch, derives a DNS-safe unique slug, and
  brings up an isolated, profile-aware Compose stack whose services are
  reachable at <role>.<slug>.localhost through one shared Traefik proxy. No
  worktree binds a host app port, so any number of worktrees run at once.

  Chromium browsers resolve *.localhost to 127.0.0.1 automatically, so no hosts
  file editing is needed for browser access.

.PARAMETER Command
  up | watch | down | restart | status | logs | wasm | url | slug | proxy | proxy-down | prune

.PARAMETER Services
  Stack targets for `up`, `restart`, or `rebuild`. The default is `core`
  (editor + API). Targets can be combined: core, editor, ui, website, backend,
  storybook, full. `all` is an alias for `full`.

.EXAMPLE
  ./infra/dev/worktree.ps1 up
  ./infra/dev/worktree.ps1 watch
  ./infra/dev/worktree.ps1 up backend
  ./infra/dev/worktree.ps1 up full
  ./infra/dev/worktree.ps1 status
  ./infra/dev/worktree.ps1 down
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('up', 'watch', 'down', 'restart', 'rebuild', 'status', 'logs', 'wasm', 'url', 'slug', 'proxy', 'proxy-down', 'prune')]
  [string]$Command = 'status',

  [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
  [string[]]$Services
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProxyCompose = Join-Path $ScriptDir 'proxy\docker-compose.yml'
$WorktreeCompose = Join-Path $ScriptDir 'worktree\docker-compose.yml'
$ProxyNetwork = 'viritura-dev-proxy'

function Get-WorktreeSlug {
  # Prefer the branch name; fall back to the worktree directory name. Always
  # append a short stable hash of the worktree's absolute path so two worktrees
  # that happen to share a branch name (or a detached HEAD) still get distinct
  # slugs.
  $root = (& git rev-parse --show-toplevel 2>$null)
  if (-not $root) { throw 'Not inside a Git repository.' }
  $root = $root.Trim()

  $branch = (& git rev-parse --abbrev-ref HEAD 2>$null)
  if ($branch) { $branch = $branch.Trim() }

  if (-not $branch -or $branch -eq 'HEAD') {
    $base = Split-Path $root -Leaf
  }
  else {
    $base = $branch
  }

  # DNS label: lowercase, non-alphanumerics -> '-', collapse, trim, cap length.
  $base = $base.ToLowerInvariant()
  $base = ($base -replace '[^a-z0-9]+', '-').Trim('-')
  if ($base.Length -gt 28) { $base = $base.Substring(0, 28).Trim('-') }
  if (-not $base) { $base = 'wt' }

  $md5 = [System.Security.Cryptography.MD5]::Create()
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant())
  $hash = ($md5.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join ''
  $md5.Dispose()

  return "$base-$($hash.Substring(0, 4))"
}

function Invoke-Compose {
  param([string[]]$ComposeArgs)
  & docker compose @ComposeArgs
  if ($LASTEXITCODE -ne 0) { throw "docker compose failed (exit $LASTEXITCODE): $($ComposeArgs -join ' ')" }
}

function Ensure-DockerEngine {
  & docker info *> $null
  if ($LASTEXITCODE -eq 0) { return }

  $desktopCandidates = @(
    (Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Docker\Docker\Docker Desktop.exe')
  ) | Where-Object { $_ -and (Test-Path $_) }

  if (-not $desktopCandidates) {
    throw 'Docker Desktop is not running, and its executable was not found. Start Docker Desktop and retry.'
  }

  Write-Host 'Docker Desktop is not running; starting it...' -ForegroundColor Yellow
  Start-Process -FilePath $desktopCandidates[0] | Out-Null

  $deadline = (Get-Date).AddSeconds(120)
  do {
    Start-Sleep -Seconds 2
    & docker info *> $null
    if ($LASTEXITCODE -eq 0) { return }
  } while ((Get-Date) -lt $deadline)

  throw 'Docker Desktop was started but the Docker engine did not become ready within 120 seconds.'
}

function Ensure-Proxy {
  # The proxy Compose project owns the shared network; worktree stacks consume
  # it as external. Compose's idempotent up also reconciles config changes such
  # as loopback port bindings without destroying the shared network.
  Invoke-Compose @('-f', $ProxyCompose, 'up', '-d')
}

function Ensure-ExternalVolume {
  param(
    [string]$Name,
    [string]$Label
  )
  & docker volume inspect $Name *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Creating isolated volume '$Name'..." -ForegroundColor Cyan
    & docker volume create --label "com.viritura.dev=$Label" $Name *> $null
    if ($LASTEXITCODE -ne 0) { throw "Unable to create Docker volume '$Name'." }
  }
}

function Remove-ExternalVolume {
  param([string]$Name)
  & docker volume inspect $Name *> $null
  if ($LASTEXITCODE -eq 0) {
    & docker volume rm $Name *> $null
    if ($LASTEXITCODE -ne 0) { throw "Unable to remove Docker volume '$Name'." }
  }
}

function Build-NodeImage {
  Invoke-Compose @('-f', $WorktreeCompose, '--profile', 'images', 'build', 'node-image')
}

function Ensure-NodeImage {
  param([string]$Name)
  & docker image inspect $Name *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Building worktree Node image '$Name'..." -ForegroundColor Cyan
    Build-NodeImage
  }
}

function Build-WasmImage {
  Invoke-Compose @('-f', $WorktreeCompose, '--profile', 'build', 'build', 'wasm-build')
}

function Ensure-WasmImage {
  & docker image inspect $WasmImage *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Building shared WASM tool image '$WasmImage'..." -ForegroundColor Cyan
    Build-WasmImage
  }
}

function Invoke-WasmBuild {
  Ensure-WasmImage
  Invoke-Compose @('-f', $WorktreeCompose, '--profile', 'build', 'run', '--rm', 'wasm-build')
}

function Test-NeedsWasm {
  param([string[]]$Svc)
  if (-not $Svc -or -not ($Svc | Where-Object { $_ })) { return $true }
  foreach ($s in ($Svc | Where-Object { $_ })) {
    if ($s.ToLowerInvariant() -notin @('backend', 'api')) { return $true }
  }
  return $false
}

function Get-ProfileArgs {
  param([string[]]$Svc)
  if (-not $Svc -or -not ($Svc | Where-Object { $_ })) {
    $Svc = @('core')
  }

  $profiles = @()
  foreach ($s in ($Svc | Where-Object { $_ })) {
    switch ($s.ToLowerInvariant()) {
      'core' { $profiles += 'core' }
      'editor' { $profiles += 'editor' }
      'ui' { $profiles += 'ui' }
      'frontend' { $profiles += 'ui' }
      'website' { $profiles += 'website' }
      'web' { $profiles += 'website' }
      'backend' { $profiles += 'backend' }
      'api' { $profiles += 'backend' }
      'storybook' { $profiles += 'storybook' }
      'stories' { $profiles += 'storybook' }
      'full' { $profiles += 'full' }
      'all' { $profiles += 'full' }
      default {
        throw "Unknown stack target '$s' (known: core, editor, ui, website, backend, storybook, full)"
      }
    }
  }
  $args = @()
  foreach ($p in ($profiles | Select-Object -Unique)) { $args += @('--profile', $p) }
  return , $args
}

function Show-Urls {
  param([string]$Slug)
  Write-Host ''
  Write-Host "Worktree slug: $Slug" -ForegroundColor Green
  Write-Host '  Editor       http://editor.'    -NoNewline; Write-Host "$Slug.localhost" -ForegroundColor Yellow
  Write-Host '  API          http://api.'       -NoNewline; Write-Host "$Slug.localhost" -ForegroundColor Yellow
  Write-Host '  Website      http://web.'       -NoNewline; Write-Host "$Slug.localhost" -ForegroundColor Yellow
  Write-Host '  UI stories   http://ui.'        -NoNewline; Write-Host "$Slug.localhost" -ForegroundColor Yellow
  Write-Host '  MNX stories  http://mnx.'       -NoNewline; Write-Host "$Slug.localhost" -ForegroundColor Yellow
  Write-Host '  App stories  http://storybook.' -NoNewline; Write-Host "$Slug.localhost" -ForegroundColor Yellow
  Write-Host '  Traefik      http://traefik.localhost  (dashboard http://127.0.0.1:8080)'
  Write-Host ''
  Write-Host '  Container API URL: http://api:8080' -ForegroundColor DarkGray
  Write-Host "  API secrets file: $($env:VIRITURA_API_ENV_FILE)" -ForegroundColor DarkGray
  Write-Host ''
}

$slug = Get-WorktreeSlug
$env:VIRITURA_SLUG = $slug
$project = "viritura-$slug"
$apiConfigDirectory = Join-Path $env:LOCALAPPDATA "Viritura\dev\$slug"
$env:VIRITURA_API_ENV_FILE = Join-Path $apiConfigDirectory 'api.env'
$dataVolume = 'viritura-dev-api-data'
$nodeImage = "viritura-dev-worktree:$slug"
$WasmImage = 'viritura-wasm-dev:rust-1.93.1-wasm-pack-0.14.0'
$wasmVolumes = @(
  "$project-cargo-registry",
  "$project-cargo-git",
  "$project-wasm-pack-cache",
  "$project-wasm-target"
)

if ($Command -notin @('slug', 'url')) {
  Ensure-DockerEngine
}

switch ($Command) {
  'slug' {
    Write-Output $slug
  }
  'url' {
    Show-Urls -Slug $slug
  }
  'proxy' {
    Ensure-Proxy
    Write-Host 'Traefik proxy is up: http://traefik.localhost (dashboard http://127.0.0.1:8080)' -ForegroundColor Green
  }
  'proxy-down' {
    Invoke-Compose @('-f', $ProxyCompose, 'down')
  }
  'up' {
    Ensure-Proxy
    $profileArgs = Get-ProfileArgs -Svc $Services
    Ensure-ExternalVolume -Name $dataVolume -Label 'shared-api-data'
    Ensure-NodeImage -Name $nodeImage
    if (Test-NeedsWasm -Svc $Services) {
      foreach ($volume in $wasmVolumes) {
        Ensure-ExternalVolume -Name $volume -Label 'worktree-wasm-cache'
      }
      Invoke-WasmBuild
    }
    Write-Host "Starting '$project'..." -ForegroundColor Cyan
    # Compose builds a missing image automatically. Existing images stay stable
    # so adding a profile does not restart healthy services; `rebuild` is the
    # explicit dependency/image refresh path.
    Invoke-Compose (@('-f', $WorktreeCompose) + $profileArgs + @('up', '-d'))
    Show-Urls -Slug $slug
  }
  'watch' {
    Ensure-Proxy
    $profileArgs = Get-ProfileArgs -Svc $Services
    Ensure-ExternalVolume -Name $dataVolume -Label 'shared-api-data'
    Ensure-NodeImage -Name $nodeImage
    foreach ($volume in $wasmVolumes) {
      Ensure-ExternalVolume -Name $volume -Label 'worktree-wasm-cache'
    }
    Invoke-WasmBuild
    Write-Host "Starting '$project' with UI, Rust/WASM, and API hot reload..." -ForegroundColor Cyan
    Invoke-Compose (@('-f', $WorktreeCompose) + $profileArgs + @('--profile', 'watch', 'up', '-d'))
    Show-Urls -Slug $slug
  }
  'restart' {
    $profileArgs = Get-ProfileArgs -Svc $Services
    Invoke-Compose (@('-f', $WorktreeCompose) + $profileArgs + @('restart'))
  }
  'rebuild' {
    # Dependencies changed on the host: drop the seeded node_modules volumes,
    # rebuild the image from the current lockfile, and start fresh.
    Ensure-Proxy
    $profileArgs = Get-ProfileArgs -Svc $Services
    Ensure-ExternalVolume -Name $dataVolume -Label 'shared-api-data'
    Write-Host "Rebuilding '$project' from scratch (removing node_modules volumes)..." -ForegroundColor Yellow
    Invoke-Compose @('-f', $WorktreeCompose, '--profile', '*', 'down', '-v')
    Build-NodeImage
    if (Test-NeedsWasm -Svc $Services) {
      foreach ($volume in $wasmVolumes) {
        Ensure-ExternalVolume -Name $volume -Label 'worktree-wasm-cache'
      }
      Invoke-WasmBuild
    }
    Invoke-Compose (@('-f', $WorktreeCompose) + $profileArgs + @('up', '-d', '--build'))
    Show-Urls -Slug $slug
  }
  'down' {
    # Keep containers attached to their anonymous package volumes. Removing the
    # containers without -v would strand those volumes instead of reusing them.
    Invoke-Compose @('-f', $WorktreeCompose, '--profile', '*', 'stop')
  }
  'prune' {
    Write-Host "Removing '$project' containers, networks, and dependency volumes (shared API data is preserved)..." -ForegroundColor Yellow
    Invoke-Compose @('-f', $WorktreeCompose, '--profile', '*', 'down', '-v')
    foreach ($volume in $wasmVolumes) { Remove-ExternalVolume -Name $volume }
  }
  'status' {
    Invoke-Compose @('-f', $WorktreeCompose, '--profile', '*', 'ps')
    Show-Urls -Slug $slug
  }
  'logs' {
    $svc = if ($Services -and $Services[0]) { @($Services[0]) } else { @() }
    Invoke-Compose (@('-f', $WorktreeCompose, '--profile', '*', 'logs', '-f', '--tail=200') + $svc)
  }
  'wasm' {
    foreach ($volume in $wasmVolumes) {
      Ensure-ExternalVolume -Name $volume -Label 'worktree-wasm-cache'
    }
    Invoke-WasmBuild
  }
}
