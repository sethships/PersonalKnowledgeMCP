<#
.SYNOPSIS
    Neo4j Volume Restore Script for Windows PowerShell

.DESCRIPTION
    Restores Neo4j data from a backup archive.
    Native PowerShell implementation for Windows environments.

    IMPORTANT: This script stops the Neo4j container before restoring.
    All existing data in the volume will be replaced.

.PARAMETER BackupFile
    Path to the backup archive (neo4j-backup-*.tar.gz). Required.

.PARAMETER VolumeName
    Override automatic volume detection. Default: auto-detect neo4j volume.

.PARAMETER Force
    Skip confirmation prompt.

.PARAMETER Quiet
    Suppress informational output, only show errors.

.EXAMPLE
    .\restore-neo4j.ps1 -BackupFile ".\backups\neo4j-backup-20241210-183000.tar.gz"
    Restores from the specified backup file with confirmation.

.EXAMPLE
    .\restore-neo4j.ps1 -BackupFile "backup.tar.gz" -Force
    Restores from backup without confirmation prompt.

.EXAMPLE
    .\restore-neo4j.ps1 -BackupFile "backup.tar.gz" -VolumeName "myproject_neo4j-data"
    Restores to a specific volume.

.NOTES
    Exit Codes:
        0 - Success
        1 - General error
        2 - Docker not available
        3 - Volume not found
        4 - Backup file not found or invalid
        5 - Restore failed
        6 - User cancelled
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$BackupFile,

    [Parameter(Mandatory = $false)]
    [string]$VolumeName = $null,

    [Parameter(Mandatory = $false)]
    [switch]$Force,

    [Parameter(Mandatory = $false)]
    [switch]$Quiet
)

# =============================================================================
# Configuration
# =============================================================================

$ErrorActionPreference = "Stop"

$VOLUME_PATTERN = "neo4j.*data$"
$CONTAINER_PATTERN = "neo4j"

# Apply environment variable if volume not specified
if ([string]::IsNullOrEmpty($VolumeName)) {
    $VolumeName = $env:VOLUME_NAME
}

# =============================================================================
# Logging Functions
# =============================================================================

function Write-Log {
    param(
        [string]$Message,
        [string]$Level = "INFO"
    )

    if ($Quiet -and $Level -eq "INFO") {
        return
    }

    $color = switch ($Level) {
        "INFO"    { "Cyan" }
        "SUCCESS" { "Green" }
        "WARN"    { "Yellow" }
        "ERROR"   { "Red" }
        default   { "White" }
    }

    $prefix = "[$Level]"
    Write-Host $prefix -ForegroundColor $color -NoNewline
    Write-Host " $Message"
}

function Write-Info    { param([string]$Message) Write-Log -Message $Message -Level "INFO" }
function Write-Success { param([string]$Message) Write-Log -Message $Message -Level "SUCCESS" }
function Write-Warn    { param([string]$Message) Write-Log -Message $Message -Level "WARN" }
function Write-Err     { param([string]$Message) Write-Log -Message $Message -Level "ERROR" }

# =============================================================================
# Helper Functions
# =============================================================================

function Test-DockerAvailable {
    try {
        $null = docker --version 2>$null
        if ($LASTEXITCODE -ne 0) {
            throw "Docker command failed"
        }

        $null = docker info 2>$null
        if ($LASTEXITCODE -ne 0) {
            throw "Docker daemon not running"
        }

        return $true
    }
    catch {
        return $false
    }
}

function Test-BackupFile {
    param([string]$Path)

    if (-not (Test-Path -Path $Path -PathType Leaf)) {
        Write-Err "Backup file not found: $Path"
        exit 4
    }

    # Return absolute path
    return (Resolve-Path -Path $Path).Path
}

function Test-BackupChecksum {
    param([string]$BackupPath)

    $checksumPath = "$BackupPath.sha256"

    if (-not (Test-Path -Path $checksumPath -PathType Leaf)) {
        Write-Warn "No checksum file found ($checksumPath)"
        Write-Warn "Skipping integrity verification - backup may not have been created with checksums"
        return $true
    }

    Write-Info "Verifying backup integrity..."

    try {
        $expectedChecksum = (Get-Content -Path $checksumPath -Raw).Trim()
        $actualHash = Get-FileHash -Path $BackupPath -Algorithm SHA256
        $actualChecksum = $actualHash.Hash.ToLower()

        if ($expectedChecksum -eq $actualChecksum) {
            Write-Info "Checksum verified: $($actualChecksum.Substring(0, 16))..."
            return $true
        }
        else {
            Write-Err "Checksum mismatch!"
            Write-Err "Expected: $expectedChecksum"
            Write-Err "Actual:   $actualChecksum"
            Write-Err "The backup file may be corrupted. Aborting restore."
            exit 4
        }
    }
    catch {
        Write-Warn "Failed to verify checksum: $_"
        Write-Warn "Proceeding with restore..."
        return $true
    }
}

function Get-Neo4jVolume {
    param([string]$Pattern)

    $volumes = docker volume ls --format '{{.Name}}' 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Failed to list Docker volumes"
        exit 2
    }

    $matchingVolume = $volumes | Where-Object { $_ -match $Pattern } | Select-Object -First 1

    return $matchingVolume
}

function Test-VolumeExists {
    param([string]$Volume)

    $null = docker volume inspect $Volume 2>$null
    return $LASTEXITCODE -eq 0
}

function Get-Neo4jContainers {
    $containers = docker ps --format '{{.Names}}' 2>$null
    return $containers | Where-Object { $_ -match $CONTAINER_PATTERN }
}

function ConvertTo-DockerPath {
    <#
    .SYNOPSIS
        Converts a Windows path to Docker-compatible path format.
    .DESCRIPTION
        Docker on Windows requires paths in Unix-like format (e.g., /c/path instead of C:\path).
        This function handles the conversion consistently across the script.
    .PARAMETER Path
        The Windows path to convert.
    .EXAMPLE
        ConvertTo-DockerPath -Path "C:\Users\data\backup.tar.gz"
        Returns: /c/Users/data/backup.tar.gz
    #>
    param([string]$Path)

    # Get the absolute path
    $absolutePath = (Resolve-Path -Path $Path).Path

    # Reject UNC paths (network paths) as Docker cannot mount them directly
    if ($absolutePath -match '^\\\\') {
        Write-Err "UNC paths are not supported. Please copy the backup to a local path first."
        exit 4
    }

    # Convert Windows path separators to forward slashes
    # and convert drive letter format (C:\ to /c/)
    $dockerPath = $absolutePath -replace '\\', '/'
    $dockerPath = $dockerPath -replace '^([A-Za-z]):', '/$1'

    return $dockerPath
}

function Stop-Neo4jContainer {
    $containers = Get-Neo4jContainers

    if (-not $containers) {
        Write-Info "No running Neo4j container found"
        return
    }

    Write-Info "Stopping Neo4j container(s): $($containers -join ', ')"

    # Try docker compose first
    $composeResult = docker compose stop neo4j 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Info "Container stopped via docker compose"
        Start-Sleep -Seconds 2
        return
    }

    # Fall back to docker stop
    foreach ($container in $containers) {
        Write-Info "Stopping container: $container"
        docker stop $container 2>$null | Out-Null
    }

    Start-Sleep -Seconds 2
}

function Start-Neo4jContainer {
    Write-Info "Starting Neo4j container..."

    $result = docker compose up -d neo4j 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Info "Container started via docker compose"
        return $true
    }

    Write-Warn "Could not start container automatically"
    Write-Warn "Please start the container manually: docker compose up -d neo4j"
    return $false
}

function Wait-ForHealthy {
    param([int]$MaxAttempts = 60)

    Write-Info "Waiting for Neo4j to be healthy..."

    # Get credentials from environment
    $neo4jUser = if ($env:NEO4J_USER) { $env:NEO4J_USER } else { "neo4j" }
    $neo4jPassword = $env:NEO4J_PASSWORD

    # Try .env file if password not set
    if ([string]::IsNullOrEmpty($neo4jPassword)) {
        $scriptDir = Split-Path -Parent $PSScriptRoot
        $envFile = Join-Path -Path $scriptDir -ChildPath ".env"
        if (Test-Path -Path $envFile) {
            $envContent = Get-Content -Path $envFile -ErrorAction SilentlyContinue
            $passwordLine = $envContent | Where-Object { $_ -match '^NEO4J_PASSWORD=' }
            if ($passwordLine) {
                $neo4jPassword = ($passwordLine -split '=', 2)[1] -replace '"', ''
            }
        }
    }

    if ([string]::IsNullOrEmpty($neo4jPassword)) {
        Write-Warn "NEO4J_PASSWORD not set - skipping health check"
        Write-Warn "Please verify Neo4j is running manually"
        return $false
    }

    for ($i = 0; $i -lt $MaxAttempts; $i++) {
        $container = Get-Neo4jContainers | Select-Object -First 1

        if ($container) {
            $result = docker exec $container cypher-shell -u $neo4jUser -p $neo4jPassword "RETURN 1" 2>$null
            if ($LASTEXITCODE -eq 0) {
                Write-Success "Neo4j is healthy"
                return $true
            }
        }

        Start-Sleep -Seconds 2
    }

    Write-Warn "Neo4j health check timed out after $($MaxAttempts * 2) seconds"
    Write-Warn "The container may still be starting up"
    return $false
}

function Confirm-Restore {
    param(
        [string]$BackupPath,
        [string]$Volume
    )

    if ($Force) {
        return $true
    }

    $fileInfo = Get-Item -Path $BackupPath
    $sizeFormatted = "{0:N2} MB" -f ($fileInfo.Length / 1MB)

    Write-Host ""
    Write-Host "WARNING: This operation will REPLACE all existing Neo4j data." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Backup file:   $($fileInfo.Name)"
    Write-Host "  File size:     $sizeFormatted"
    Write-Host "  Target volume: $Volume"
    Write-Host ""
    Write-Host "This action is DESTRUCTIVE and cannot be undone." -ForegroundColor Red
    Write-Host ""

    $confirm = Read-Host "Are you sure you want to proceed? (y/N)"
    if ($confirm -match "^[Yy]") {
        return $true
    }

    Write-Info "Restore cancelled by user"
    exit 6
}

function Clear-VolumeData {
    param([string]$Volume)

    Write-Info "Clearing existing data in volume..."

    # Remove all files including hidden files (dotfiles) for complete cleanup
    docker run --rm `
        -v "${Volume}:/data" `
        alpine `
        sh -c "rm -rf /data/* /data/.[!.]* /data/..?* 2>/dev/null || true" 2>$null

    if ($LASTEXITCODE -ne 0) {
        Write-Err "Failed to clear volume data"
        exit 5
    }

    Write-Info "Volume cleared"
}

function Restore-BackupData {
    param(
        [string]$BackupPath,
        [string]$Volume
    )

    $backupName = Split-Path -Path $BackupPath -Leaf

    Write-Info "Restoring data from backup..."

    # Convert Windows path to Docker-compatible path using helper function
    $dockerBackupDir = ConvertTo-DockerPath -Path (Split-Path -Path $BackupPath -Parent)

    docker run --rm `
        -v "${Volume}:/data" `
        -v "${dockerBackupDir}:/backup:ro" `
        alpine `
        tar xzf "/backup/$backupName" -C /data 2>$null

    if ($LASTEXITCODE -ne 0) {
        Write-Err "Failed to restore data from backup"
        exit 5
    }

    Write-Success "Data restored from backup"
}

function Show-Verification {
    $neo4jUser = if ($env:NEO4J_USER) { $env:NEO4J_USER } else { "neo4j" }

    Write-Host ""
    Write-Info "Verification:"
    Write-Host "  # Check Neo4j browser (after container starts):"
    Write-Host "  http://localhost:7474"
    Write-Host ""
    Write-Host "  # Or via cypher-shell:"
    Write-Host "  docker exec pk-mcp-neo4j cypher-shell -u $neo4jUser -p <password> 'RETURN 1'"
    Write-Host ""
}

# =============================================================================
# Main Execution
# =============================================================================

function Main {
    Write-Info "Neo4j Restore Script (PowerShell)"
    Write-Info "=================================="

    # Pre-flight checks
    if (-not (Test-DockerAvailable)) {
        Write-Err "Docker is not installed, not in PATH, or daemon is not running"
        exit 2
    }

    # Validate backup file
    $BackupFile = Test-BackupFile -Path $BackupFile
    Write-Info "Backup file validated: $BackupFile"

    # Verify backup integrity
    $null = Test-BackupChecksum -BackupPath $BackupFile

    # Detect or validate volume
    if ([string]::IsNullOrEmpty($VolumeName)) {
        $VolumeName = Get-Neo4jVolume -Pattern $VOLUME_PATTERN

        if ([string]::IsNullOrEmpty($VolumeName)) {
            Write-Err "Could not find Neo4j volume matching pattern: $VOLUME_PATTERN"
            Write-Err "Available volumes:"
            docker volume ls --format '  {{.Name}}'
            exit 3
        }

        Write-Info "Detected volume: $VolumeName"
    }
    else {
        Write-Info "Using specified volume: $VolumeName"
    }

    if (-not (Test-VolumeExists -Volume $VolumeName)) {
        Write-Err "Volume '$VolumeName' does not exist"
        exit 3
    }

    # Confirm with user
    Confirm-Restore -BackupPath $BackupFile -Volume $VolumeName

    # Perform restore
    Stop-Neo4jContainer
    Clear-VolumeData -Volume $VolumeName
    Restore-BackupData -BackupPath $BackupFile -Volume $VolumeName

    $null = Start-Neo4jContainer
    $null = Wait-ForHealthy

    # Show verification commands
    Show-Verification

    Write-Success "Restore completed successfully"
}

# Run main function
try {
    Main
    exit 0
}
catch {
    Write-Err "Unexpected error: $_"
    exit 1
}
