<#
Builds a distributable CVRC Windows installer end to end:
  1. dotnet publish (self-contained win-x64)
  2. vpk pack (Velopack)      -> releases\VRCNext-win-Setup.exe (internal, never shown to users)
  3. Inno Setup compile       -> installer\CVRC_Setup_<version>_x64.exe   <-- send THIS file to people

Prerequisites (one-time): `dotnet tool install -g vpk`, and Inno Setup 6
(installed already on this machine via `winget install JRSoftware.InnoSetup`).
#>
param(
    [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$appInfo = Get-Content "main\AppInfo.cs" -Raw
if ($appInfo -notmatch 'Version\s*=\s*"([^"]+)"') {
    throw "Could not read version from main\AppInfo.cs"
}
$version = $Matches[1]
Write-Host "==> CVRC $version Windows installer build" -ForegroundColor Cyan

$publishDir  = Join-Path $repoRoot "publish\win"
$releasesDir = Join-Path $repoRoot "releases"
$installerDir = Join-Path $repoRoot "installer"

Write-Host "==> [1/3] Publishing win-x64 (self-contained)..." -ForegroundColor Cyan
if (Test-Path $publishDir) { Remove-Item $publishDir -Recurse -Force }
dotnet publish VRCNext.csproj -c $Configuration -r win-x64 --self-contained true -o $publishDir
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed" }

Write-Host "==> [2/3] Packing with Velopack (vpk)..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $releasesDir | Out-Null
vpk pack -u VRCNext -v $version -p $publishDir -e CVRC.exe -o $releasesDir
if ($LASTEXITCODE -ne 0) { throw "vpk pack failed" }

Write-Host "==> [3/3] Compiling branded installer (Inno Setup)..." -ForegroundColor Cyan
$isccCmd = Get-Command ISCC.exe -ErrorAction SilentlyContinue
if ($isccCmd) {
    $iscc = $isccCmd.Source
} else {
    $candidates = @(
        "$env:LocalAppData\Programs\Inno Setup 6\ISCC.exe",
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
    )
    $iscc = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $iscc) { throw "ISCC.exe not found. Install Inno Setup 6 first (winget install JRSoftware.InnoSetup)." }
}
New-Item -ItemType Directory -Force -Path $installerDir | Out-Null
& $iscc "build\installer.iss" "/DMyAppVersion=$version"
if ($LASTEXITCODE -ne 0) { throw "Inno Setup compile failed" }

$finalExe = Join-Path $installerDir "CVRC_Setup_${version}_x64.exe"
Write-Host ""
Write-Host "==> Done: $finalExe" -ForegroundColor Green
Write-Host "    This is the file to send to people." -ForegroundColor Green
