<#
.SYNOPSIS
  Stops and removes expired Viritura worktree development stacks.

.DESCRIPTION
  Lease files live outside the repository under %LOCALAPPDATA%\Viritura\dev.
  Expired stacks are stopped immediately and removed after a 24-hour grace
  period. Only Docker resources belonging to a recorded Viritura Compose
  project are touched.
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('cleanup', 'install', 'uninstall')]
  [string]$Command = 'cleanup'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$DevRoot = Join-Path $env:LOCALAPPDATA 'Viritura\dev'
$LeaseDirectory = Join-Path $DevRoot 'leases'
$InstalledScript = Join-Path $DevRoot 'worktree-janitor.ps1'
$TaskName = 'Viritura Dev Worktree Janitor'
$RemovalGrace = [TimeSpan]::FromHours(24)
$CacheRetention = [TimeSpan]::FromDays(7)

function Invoke-Docker {
  param([string[]]$Arguments)

  & docker @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "docker failed (exit $LASTEXITCODE): $($Arguments -join ' ')"
  }
}

function Get-DockerIds {
  param([string[]]$Arguments)

  $result = @(& docker @Arguments)
  if ($LASTEXITCODE -ne 0) {
    throw "docker failed (exit $LASTEXITCODE): $($Arguments -join ' ')"
  }
  return @($result | Where-Object { $_ })
}

function Save-Lease {
  param(
    [string]$Path,
    [object]$Lease
  )

  $Lease | ConvertTo-Json | Set-Content -LiteralPath $Path -Encoding utf8
}

function Remove-ProjectResources {
  param([string]$Project)

  $containers = Get-DockerIds @(
    'container', 'ls', '--all', '--quiet',
    '--filter', "label=com.docker.compose.project=$Project",
    '--filter', 'label=com.viritura.dev.managed=true'
  )
  if ($containers.Count -gt 0) {
    Invoke-Docker (@('container', 'rm', '--force') + $containers)
  }

  $networks = Get-DockerIds @(
    'network', 'ls', '--quiet',
    '--filter', "label=com.docker.compose.project=$Project",
    '--filter', 'label=com.viritura.dev.managed=true'
  )
  foreach ($network in $networks) {
    Invoke-Docker @('network', 'rm', $network)
  }

  $volumes = Get-DockerIds @(
    'volume', 'ls', '--quiet',
    '--filter', "label=com.docker.compose.project=$Project",
    '--filter', 'label=com.viritura.dev.managed=true'
  )
  foreach ($volume in $volumes) {
    Invoke-Docker @('volume', 'rm', $volume)
  }

  $worktreeVolumes = Get-DockerIds @(
    'volume', 'ls', '--quiet',
    '--filter', "label=com.viritura.dev.project=$Project",
    '--filter', 'label=com.viritura.dev.managed=true'
  )
  foreach ($volume in $worktreeVolumes) {
    Invoke-Docker @('volume', 'rm', $volume)
  }
}

function Remove-StaleCaches {
  param([DateTimeOffset]$Now)

  $cutoff = $Now - $CacheRetention
  $dependencyVolumes = Get-DockerIds @(
    'volume', 'ls', '--quiet',
    '--filter', 'label=com.viritura.dev.cache=node-dependencies'
  )
  foreach ($volume in $dependencyVolumes) {
    $inspection = @(& docker volume inspect $volume | ConvertFrom-Json)[0]
    if ($LASTEXITCODE -ne 0) { continue }
    if ([DateTimeOffset]::Parse([string]$inspection.CreatedAt) -gt $cutoff) { continue }
    $users = Get-DockerIds @('container', 'ls', '--all', '--quiet', '--filter', "volume=$volume")
    if ($users.Count -eq 0) {
      Invoke-Docker @('volume', 'rm', $volume)
    }
  }

  foreach ($cacheLabel in @('node-image', 'api-image')) {
    $images = Get-DockerIds @('image', 'ls', '--quiet', '--filter', "label=com.viritura.dev.cache=$cacheLabel")
    foreach ($image in ($images | Sort-Object -Unique)) {
      $inspection = @(& docker image inspect $image | ConvertFrom-Json)[0]
      if ($LASTEXITCODE -ne 0) { continue }
      if ([DateTimeOffset]::Parse([string]$inspection.Created) -gt $cutoff) { continue }
      $users = Get-DockerIds @('container', 'ls', '--all', '--quiet', '--filter', "ancestor=$image")
      if ($users.Count -eq 0) {
        Invoke-Docker @('image', 'rm', $image)
      }
    }
  }
}

function Invoke-Cleanup {
  & docker info *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Warning 'Docker is not available; skipping Viritura worktree cleanup.'
    return
  }
  New-Item -ItemType Directory -Path $LeaseDirectory -Force | Out-Null

  $now = [DateTimeOffset]::UtcNow
  foreach ($leaseFile in Get-ChildItem -LiteralPath $LeaseDirectory -Filter '*.json' -File) {
    $project = $leaseFile.BaseName
    $mutex = [System.Threading.Mutex]::new($false, "VirituraDevLease-$project")
    $lockTaken = $false
    try {
      $lockTaken = $mutex.WaitOne([TimeSpan]::FromMinutes(2))
      if (-not $lockTaken) {
        throw "Timed out waiting for lease lock for '$project'."
      }
      $lease = Get-Content -LiteralPath $leaseFile.FullName -Raw | ConvertFrom-Json
      $project = [string]$lease.Project
      if ($project -ne $leaseFile.BaseName) {
        throw "Lease project '$project' does not match its file name."
      }
      $expiresAt = [DateTimeOffset]::Parse([string]$lease.ExpiresAt)
      if (-not $project.StartsWith('viritura-', [StringComparison]::Ordinal) -or $expiresAt -gt $now) {
        continue
      }

      if (-not $lease.StoppedAt) {
        $containers = Get-DockerIds @(
          'container', 'ls', '--quiet',
          '--filter', "label=com.docker.compose.project=$project",
          '--filter', 'label=com.viritura.dev.managed=true'
        )
        if ($containers.Count -gt 0) {
          Write-Host "Stopping expired development stack '$project'..." -ForegroundColor Yellow
          Invoke-Docker (@('container', 'stop') + $containers)
        }
        $lease | Add-Member -NotePropertyName StoppedAt -NotePropertyValue $now.ToString('O') -Force
        Save-Lease -Path $leaseFile.FullName -Lease $lease
        continue
      }

      $stoppedAt = [DateTimeOffset]::Parse([string]$lease.StoppedAt)
      if ($stoppedAt + $RemovalGrace -gt $now) { continue }

      Write-Host "Removing expired development stack '$project'..." -ForegroundColor Yellow
      Remove-ProjectResources -Project $project
      Remove-Item -LiteralPath $leaseFile.FullName -Force
    }
    catch {
      Write-Warning "Unable to process lease '$($leaseFile.FullName)': $($_.Exception.Message)"
    }
    finally {
      if ($lockTaken) { $mutex.ReleaseMutex() }
      $mutex.Dispose()
    }
  }
  Remove-StaleCaches -Now $now
}

function Install-Janitor {
  New-Item -ItemType Directory -Path $DevRoot -Force | Out-Null
  Copy-Item -LiteralPath $PSCommandPath -Destination $InstalledScript -Force

  $action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$InstalledScript`" cleanup"
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval ([TimeSpan]::FromMinutes(15))
  $settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit ([TimeSpan]::FromMinutes(10)) `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable
  $principal = New-ScheduledTaskPrincipal `
    -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) `
    -LogonType Interactive `
    -RunLevel Limited

  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description 'Stops expired Viritura development stacks and removes them after 24 hours.' `
    -Force | Out-Null
  Write-Host "Installed '$TaskName' (runs every 15 minutes while signed in)." -ForegroundColor Green
}

function Uninstall-Janitor {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }
  if (Test-Path -LiteralPath $InstalledScript) {
    Remove-Item -LiteralPath $InstalledScript -Force
  }
  Write-Host "Uninstalled '$TaskName'." -ForegroundColor Green
}

switch ($Command) {
  'cleanup' { Invoke-Cleanup }
  'install' { Install-Janitor }
  'uninstall' { Uninstall-Janitor }
}
