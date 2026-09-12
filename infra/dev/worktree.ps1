<#
.SYNOPSIS
  Lease-aware Git-worktree development driver (Docker Compose + Traefik).

.DESCRIPTION
  Detects the current Git worktree/branch, derives a DNS-safe unique slug, and
  brings up an isolated, profile-aware Compose stack whose services are
  reachable at <role>.<slug>.localhost through one shared Traefik proxy. No
  worktree binds a host app port, so any number of worktrees run at once.
  Matching dependency manifests reuse read-only content-addressed volumes.

  Chromium browsers resolve *.localhost to 127.0.0.1 automatically, so no hosts
  file editing is needed for browser access.

.PARAMETER Command
  up | watch | stop | down | restart | rebuild | status | logs | wasm | url |
  slug | keepalive | cleanup | proxy | proxy-down | prune

.PARAMETER Services
  Stack targets for `up`, `restart`, or `rebuild`. The default is `app`
  (editor + API). Targets can be combined: app, editor, ui, website,
  backend, storybook-ui, storybook-mnx, storybook-app, storybook, and full.
  `core` is an alias for `app`; `all` is an alias for `full`.

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
  [ValidateSet('up', 'watch', 'stop', 'down', 'restart', 'rebuild', 'status', 'logs', 'wasm', 'url', 'slug', 'keepalive', 'cleanup', 'proxy', 'proxy-down', 'prune')]
  [string]$Command = 'status',

  [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
  [string[]]$Services
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProxyCompose = Join-Path $ScriptDir 'proxy\docker-compose.yml'
$WorktreeCompose = Join-Path $ScriptDir 'worktree\docker-compose.yml'
$CleanupScript = Join-Path $ScriptDir 'worktree-janitor.ps1'
$ProxyNetwork = 'viritura-dev-proxy'
$LeaseDuration = [TimeSpan]::FromHours(8)

function Get-RepositoryRoot {
  $root = (& git rev-parse --show-toplevel 2>$null)
  if (-not $root) { throw 'Not inside a Git repository.' }
  return $root.Trim()
}

function Get-WorktreeSlug {
  # Prefer the branch name; fall back to the worktree directory name. Always
  # append a short stable hash of the worktree's absolute path so two worktrees
  # that happen to share a branch name (or a detached HEAD) still get distinct
  # slugs.
  $root = Get-RepositoryRoot

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

function Get-ContentTag {
  param([string[]]$Paths)

  $hash = [System.Security.Cryptography.SHA256]::Create()
  $rootPath = [System.IO.Path]::GetFullPath($repositoryRoot)
  $rootPrefix = $rootPath.TrimEnd([char[]]@('\', '/')) + [System.IO.Path]::DirectorySeparatorChar
  try {
    foreach ($path in ($Paths | Sort-Object -Unique)) {
      if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Hash input does not exist: $path"
      }
      $fullPath = [System.IO.Path]::GetFullPath($path)
      if (-not $fullPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Hash input is outside the repository: $path"
      }
      $relative = $fullPath.Substring($rootPrefix.Length).Replace('\', '/')
      foreach ($bytes in @(
          [System.Text.Encoding]::UTF8.GetBytes("$relative`0"),
          [System.IO.File]::ReadAllBytes($fullPath),
          [byte[]]@(0)
        )) {
        $null = $hash.TransformBlock($bytes, 0, $bytes.Length, $bytes, 0)
      }
    }
    $null = $hash.TransformFinalBlock([byte[]]@(), 0, 0)
    return (($hash.Hash | ForEach-Object { $_.ToString('x2') }) -join '').Substring(0, 16)
  }
  finally {
    $hash.Dispose()
  }
}

function Get-NodeDependencyInputs {
  $inputs = @(
    (Join-Path $repositoryRoot 'package.json'),
    (Join-Path $repositoryRoot 'pnpm-lock.yaml'),
    (Join-Path $repositoryRoot 'pnpm-workspace.yaml'),
    (Join-Path $repositoryRoot '.npmrc'),
    (Join-Path $repositoryRoot '.dockerignore'),
    (Join-Path $repositoryRoot 'infra\dev\worktree\dev.Dockerfile')
  )
  $workspaceRoots = @(
    (Join-Path $repositoryRoot 'apps'),
    (Join-Path $repositoryRoot 'packages'),
    (Join-Path $repositoryRoot 'examples')
  )
  $inputs += Get-ChildItem -Path $workspaceRoots -Directory |
    ForEach-Object { Join-Path $_.FullName 'package.json' } |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }
  return $inputs
}

function Get-ApiRestoreInputs {
  $inputs = @(
    (Join-Path $repositoryRoot '.dockerignore'),
    (Join-Path $repositoryRoot 'infra\dev\worktree\api.Dockerfile')
  )
  $inputs += @(
    (Join-Path $repositoryRoot 'server\Directory.Build.props'),
    (Join-Path $repositoryRoot 'server\Viritura.Api\Viritura.Api.csproj'),
    (Join-Path $repositoryRoot 'server\Viritura.Api\packages.lock.json'),
    (Join-Path $repositoryRoot 'server\Viritura.GitHub\Viritura.GitHub.csproj'),
    (Join-Path $repositoryRoot 'server\Viritura.GitHub\packages.lock.json'),
    (Join-Path $repositoryRoot 'server\Viritura.Infrastructure\Viritura.Infrastructure.csproj'),
    (Join-Path $repositoryRoot 'server\Viritura.Infrastructure\packages.lock.json')
  )
  return $inputs
}

function Invoke-Compose {
  param([string[]]$ComposeArgs)
  & docker compose @ComposeArgs
  if ($LASTEXITCODE -ne 0) { throw "docker compose failed (exit $LASTEXITCODE): $($ComposeArgs -join ' ')" }
}

function Ensure-DockerEngine {
  & docker info *> $null
  if ($LASTEXITCODE -eq 0) { return }

  $desktopCandidates = @(@(
    (Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Docker\Docker\Docker Desktop.exe')
  ) | Where-Object { $_ -and (Test-Path $_) })

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
    [string]$Label,
    [string]$Project = '',
    [string]$Cache = '',
    [string]$ContentHash = ''
  )
  & docker volume inspect $Name *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Creating isolated volume '$Name'..." -ForegroundColor Cyan
    $labelArgs = @('--label', "com.viritura.dev=$Label")
    if ($Project) {
      $labelArgs += @('--label', "com.viritura.dev.project=$Project")
      $labelArgs += @('--label', 'com.viritura.dev.managed=true')
    }
    if ($Cache) {
      $labelArgs += @('--label', "com.viritura.dev.cache=$Cache")
    }
    if ($ContentHash) {
      $labelArgs += @('--label', "com.viritura.dev.hash=$ContentHash")
    }
    & docker volume create @labelArgs $Name *> $null
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

function Initialize-NodeDependencies {
  $mutex = [System.Threading.Mutex]::new($false, "VirituraDevDependencies-$dependencyHash")
  $lockTaken = $false
  try {
    $lockTaken = $mutex.WaitOne([TimeSpan]::FromMinutes(10))
    if (-not $lockTaken) {
      throw "Timed out waiting to initialize dependency set '$dependencyHash'."
    }
    Ensure-NodeImage -Name $nodeImage
    foreach ($volume in $dependencyVolumes) {
      Ensure-ExternalVolume `
        -Name $volume `
        -Label "node-dependencies-$dependencyHash" `
        -Cache 'node-dependencies' `
        -ContentHash $dependencyHash
    }
    Invoke-Compose @('-f', $WorktreeCompose, '--profile', 'images', 'run', '--rm', 'dependency-seed')
  }
  finally {
    if ($lockTaken) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
  }
}

function Ensure-SharedBuildCaches {
  foreach ($volume in $sharedBuildVolumes) {
    Ensure-ExternalVolume -Name $volume -Label 'shared-build-cache'
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
    $Svc = @('app')
  }

  $profiles = @()
  foreach ($s in ($Svc | Where-Object { $_ })) {
    switch ($s.ToLowerInvariant()) {
      'core' { $profiles += 'app' }
      'app' { $profiles += 'app' }
      'editor' { $profiles += 'editor' }
      'ui' { $profiles += 'ui' }
      'frontend' { $profiles += 'ui' }
      'website' { $profiles += 'website' }
      'web' { $profiles += 'website' }
      'backend' { $profiles += 'backend' }
      'api' { $profiles += 'backend' }
      'storybook' { $profiles += 'storybook' }
      'stories' { $profiles += 'storybook' }
      'storybook-ui' { $profiles += 'storybook-ui' }
      'ui-stories' { $profiles += 'storybook-ui' }
      'storybook-mnx' { $profiles += 'storybook-mnx' }
      'mnx-stories' { $profiles += 'storybook-mnx' }
      'storybook-app' { $profiles += 'storybook-app' }
      'app-stories' { $profiles += 'storybook-app' }
      'full' { $profiles += 'full' }
      'all' { $profiles += 'full' }
      default {
        throw "Unknown stack target '$s' (known: app, core, editor, ui, website, backend, storybook[-ui|-mnx|-app], full)"
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

$repositoryRoot = Get-RepositoryRoot
$slug = Get-WorktreeSlug
$env:VIRITURA_SLUG = $slug
$project = "viritura-$slug"
$apiConfigDirectory = Join-Path $env:LOCALAPPDATA "Viritura\dev\$slug"
$env:VIRITURA_API_ENV_FILE = Join-Path $apiConfigDirectory 'api.env'
$leaseDirectory = Join-Path $env:LOCALAPPDATA 'Viritura\dev\leases'
$leaseFile = Join-Path $leaseDirectory "$project.json"
$dataVolume = 'viritura-dev-api-data'
$dependencyHash = Get-ContentTag -Paths (Get-NodeDependencyInputs)
$apiRestoreHash = Get-ContentTag -Paths (Get-ApiRestoreInputs)
$env:VIRITURA_DEPENDENCY_HASH = $dependencyHash
$env:VIRITURA_NODE_IMAGE_TAG = $dependencyHash
$env:VIRITURA_API_IMAGE_TAG = $apiRestoreHash
$nodeImage = "viritura-dev-worktree:$dependencyHash"
$WasmImage = 'viritura-wasm-dev:rust-1.93.1-wasm-pack-0.14.0'
$dependencyVolumeSuffixes = @(
  'root',
  'package-audio',
  'package-core',
  'package-crdt',
  'app-editor',
  'package-format',
  'package-instrument-profiles',
  'package-midi',
  'package-monaco-react',
  'package-musicxml',
  'package-piano-roll',
  'package-playback',
  'package-renderer',
  'package-score-engine',
  'package-score-viewer-react',
  'package-sound-profiles',
  'package-ui',
  'package-video-sync',
  'example-score-viewer',
  'app-desktop',
  'app-server-ui',
  'app-vscode-viewer',
  'app-website'
)
$dependencyVolumes = @(
  $dependencyVolumeSuffixes | ForEach-Object { "viritura-dev-node-$dependencyHash-$_" }
)
$sharedBuildVolumes = @(
  'viritura-dev-cargo-registry',
  'viritura-dev-cargo-git',
  'viritura-dev-wasm-pack-cache',
  'viritura-dev-nuget-packages'
)
$wasmTargetVolume = "$project-wasm-target"

function Invoke-WithLeaseLock {
  param([scriptblock]$Action)

  $mutex = [System.Threading.Mutex]::new($false, "VirituraDevLease-$project")
  $lockTaken = $false
  try {
    $lockTaken = $mutex.WaitOne([TimeSpan]::FromMinutes(2))
    if (-not $lockTaken) {
      throw "Timed out waiting to update lease for '$project'."
    }
    & $Action
  }
  finally {
    if ($lockTaken) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
  }
}

function Set-LeaseActive {
  New-Item -ItemType Directory -Path $leaseDirectory -Force | Out-Null
  $lease = [ordered]@{
    Project = $project
    Slug = $slug
    Worktree = $repositoryRoot
    ExpiresAt = [DateTimeOffset]::UtcNow.Add($LeaseDuration).ToString('O')
    StoppedAt = $null
  }
  $lease | ConvertTo-Json | Set-Content -LiteralPath $leaseFile -Encoding utf8
  Write-Host "Lease renewed through $([DateTimeOffset]::Parse($lease.ExpiresAt).ToLocalTime().ToString('g'))." -ForegroundColor DarkGray
}

function Set-LeaseStopped {
  New-Item -ItemType Directory -Path $leaseDirectory -Force | Out-Null
  $lease = if (Test-Path -LiteralPath $leaseFile) {
    Get-Content -LiteralPath $leaseFile -Raw | ConvertFrom-Json
  }
  else {
    [pscustomobject]@{
      Project = $project
      Slug = $slug
      Worktree = $repositoryRoot
      ExpiresAt = [DateTimeOffset]::UtcNow.ToString('O')
      StoppedAt = $null
    }
  }
  $lease.ExpiresAt = [DateTimeOffset]::UtcNow.ToString('O')
  $lease.StoppedAt = [DateTimeOffset]::UtcNow.ToString('O')
  $lease | ConvertTo-Json | Set-Content -LiteralPath $leaseFile -Encoding utf8
}

function Renew-Lease {
  Invoke-WithLeaseLock { Set-LeaseActive }
}

function Mark-LeaseStopped {
  Invoke-WithLeaseLock { Set-LeaseStopped }
}

function Invoke-ComposeWithLease {
  param([string[]]$ComposeArgs)

  & $CleanupScript
  Invoke-WithLeaseLock {
    Set-LeaseActive
    try {
      Invoke-Compose $ComposeArgs
    }
    catch {
      Set-LeaseStopped
      throw
    }
  }
}

function Remove-Lease {
  Invoke-WithLeaseLock {
    if (Test-Path -LiteralPath $leaseFile) {
      Remove-Item -LiteralPath $leaseFile -Force
    }
  }
}

if ($Command -notin @('slug', 'url', 'keepalive')) {
  Ensure-DockerEngine
}

switch ($Command) {
  'slug' {
    Write-Output $slug
  }
  'url' {
    Show-Urls -Slug $slug
  }
  'keepalive' {
    Renew-Lease
  }
  'cleanup' {
    & $CleanupScript
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
    Ensure-SharedBuildCaches
    Initialize-NodeDependencies
    if (Test-NeedsWasm -Svc $Services) {
      Ensure-ExternalVolume -Name $wasmTargetVolume -Label 'worktree-wasm-target' -Project $project
      Invoke-WasmBuild
    }
    Write-Host "Starting '$project'..." -ForegroundColor Cyan
    # Compose builds a missing image automatically. Existing images stay stable
    # so adding a profile does not restart healthy services; `rebuild` is the
    # explicit dependency/image refresh path.
    Invoke-ComposeWithLease (@('-f', $WorktreeCompose) + $profileArgs + @('up', '-d'))
    Show-Urls -Slug $slug
  }
  'watch' {
    Ensure-Proxy
    $profileArgs = Get-ProfileArgs -Svc $Services
    Ensure-ExternalVolume -Name $dataVolume -Label 'shared-api-data'
    Ensure-SharedBuildCaches
    Initialize-NodeDependencies
    Ensure-ExternalVolume -Name $wasmTargetVolume -Label 'worktree-wasm-target' -Project $project
    Invoke-WasmBuild
    Write-Host "Starting '$project' with UI, Rust/WASM, and API hot reload..." -ForegroundColor Cyan
    Invoke-ComposeWithLease (@('-f', $WorktreeCompose) + $profileArgs + @('--profile', 'watch', 'up', '-d'))
    Show-Urls -Slug $slug
  }
  'restart' {
    $profileArgs = Get-ProfileArgs -Svc $Services
    Invoke-ComposeWithLease (@('-f', $WorktreeCompose) + $profileArgs + @('restart'))
  }
  'rebuild' {
    # Drop worktree-local compiler output. Content-addressed dependency volumes
    # remain shared and a changed manifest naturally selects a new set.
    Ensure-Proxy
    $profileArgs = Get-ProfileArgs -Svc $Services
    Ensure-ExternalVolume -Name $dataVolume -Label 'shared-api-data'
    Ensure-SharedBuildCaches
    Write-Host "Rebuilding '$project' from scratch (shared package caches are preserved)..." -ForegroundColor Yellow
    Invoke-Compose @('-f', $WorktreeCompose, '--profile', '*', 'down', '-v')
    Build-NodeImage
    Initialize-NodeDependencies
    if (Test-NeedsWasm -Svc $Services) {
      Ensure-ExternalVolume -Name $wasmTargetVolume -Label 'worktree-wasm-target' -Project $project
      Invoke-WasmBuild
    }
    Invoke-ComposeWithLease (@('-f', $WorktreeCompose) + $profileArgs + @('up', '-d', '--build'))
    Show-Urls -Slug $slug
  }
  'stop' {
    Invoke-Compose @('-f', $WorktreeCompose, '--profile', '*', 'stop')
    Mark-LeaseStopped
  }
  'down' {
    Write-Host "Removing '$project' containers and networks (worktree compiler output is preserved)..." -ForegroundColor Yellow
    Invoke-Compose @('-f', $WorktreeCompose, '--profile', '*', 'down', '--remove-orphans')
    Mark-LeaseStopped
  }
  'prune' {
    Write-Host "Removing '$project' containers, networks, and compiler output (shared dependencies and API data are preserved)..." -ForegroundColor Yellow
    Invoke-Compose @('-f', $WorktreeCompose, '--profile', '*', 'down', '-v')
    Remove-ExternalVolume -Name $wasmTargetVolume
    Remove-Lease
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
    Ensure-SharedBuildCaches
    Ensure-ExternalVolume -Name $wasmTargetVolume -Label 'worktree-wasm-target' -Project $project
    Invoke-WasmBuild
  }
}
