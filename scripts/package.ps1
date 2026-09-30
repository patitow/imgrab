# Builds dist/imgrab-<version>.zip with only the files the extension needs.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$manifest = Get-Content manifest.json -Raw | ConvertFrom-Json
$version = $manifest.version
$files = @(
  "manifest.json", "background.js", "content.js", "shared.js",
  "offscreen.html", "offscreen.js", "options.html", "options.js", "icons"
)
if (Test-Path "_locales") { $files += "_locales" }

New-Item -ItemType Directory -Force dist | Out-Null
$zip = "dist/imgrab-$version.zip"
if (Test-Path $zip) { Remove-Item $zip }
# bsdtar (built into Windows 10+) writes zip entries with "/" separators, which the stores require.
# Compress-Archive in Windows PowerShell 5.1 writes "\" and can be rejected.
tar -a -cf $zip @files
if ($LASTEXITCODE -ne 0) { throw "tar failed" }
Write-Host "Created $zip"
