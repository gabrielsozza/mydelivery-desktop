param([Parameter(Mandatory=$true)][string]$Installer,[switch]$TestRepair,[string]$PreviousInstaller,[string]$UnpackedDirectory,[ValidateSet("x64","ia32")][string]$ExpectedArch="x64")
$ErrorActionPreference = 'Stop'
if ($env:CI -ne 'true') { throw 'Only run on a disposable CI runner' }
$Installer = (Resolve-Path $Installer).Path
$machine = if ($ExpectedArch -eq "ia32") { 0x14c } else { 0x8664 }
$installDir = Join-Path $env:LOCALAPPDATA 'MyDelivery-installed-smoke'
$exe = Join-Path $installDir 'MyDelivery.exe'
function Stop-TestApp {
  # This script runs only on a disposable CI runner; wait for Chromium children
  # to release loaded DLLs before testing reinstallation.
  if ($env:CI -ne 'true') { throw 'Run this installed-app smoke test only on an isolated CI runner' }
  for ($i=0;$i -lt 20;$i++) {
    if (!(Get-Process -Name MyDelivery -ErrorAction SilentlyContinue)) { return }
    & taskkill.exe /F /T /IM MyDelivery.exe 2>$null | Out-Null
    Start-Sleep -Milliseconds 500
  }
  throw 'Test application processes did not stop'
}
function Install-App([string]$Package = $Installer) {
  Stop-TestApp
  # NSIS requires /D to be last and unquoted, even when the path contains spaces.
  $p = Start-Process -FilePath $Package -ArgumentList "/S /D=$installDir" -PassThru -Wait
  if ($p.ExitCode -ne 0) { throw "Installer failed: $($p.ExitCode)" }
  if (!(Test-Path $exe)) { throw 'Installer did not create MyDelivery.exe' }
  Stop-TestApp
}
function Assert-Shortcut {
  $shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'MyDelivery.lnk'
  if (!(Test-Path $shortcutPath)) { throw 'Desktop shortcut is missing' }
  $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
  if ($shortcut.TargetPath -ne $exe) { throw "Desktop shortcut points to the wrong executable: $($shortcut.TargetPath)" }
  if (!(Test-Path $shortcut.TargetPath)) { throw 'Desktop shortcut target does not exist' }
  Write-Output 'PASS: desktop shortcut points to the installed application'
}
function Assert-NormalExit {
  $app = Start-Process -FilePath $exe -PassThru
  for ($i=0; $i -lt 45; $i++) {
    Start-Sleep -Seconds 1
    $app.Refresh()
    if ($app.HasExited) { throw 'App exited before the normal-exit test' }
    if ($app.MainWindowHandle -ne 0) { break }
  }
  if (!$app.CloseMainWindow()) { throw 'Could not close the application normally' }
  if (!$app.WaitForExit(30000)) { throw 'Application did not exit normally' }
  if (!(Test-Path $exe)) { throw 'Application disappeared after normal exit' }
  Assert-Shortcut
  Write-Output 'PASS: normal exit preserves application and shortcut'
}
function Assert-PE([string]$file) {
  $bytes = [IO.File]::ReadAllBytes($file)
  if ($bytes.Length -lt 128 -or [BitConverter]::ToUInt16($bytes,0) -ne 0x5a4d) { throw "Invalid PE: $file" }
  $offset = [BitConverter]::ToInt32($bytes,0x3c)
  if ($offset -lt 0 -or ($offset+26) -gt $bytes.Length -or [BitConverter]::ToUInt32($bytes,$offset) -ne 0x4550) { throw "Invalid PE header: $file" }
  if ([BitConverter]::ToUInt16($bytes,$offset+4) -ne $machine) { throw "Wrong architecture (expected $ExpectedArch): $file" }
}
function Assert-Starts([string]$label) {
  Assert-PE $exe
  Get-ChildItem $installDir -Filter '*.dll' | ForEach-Object { Assert-PE $_.FullName }
  $out=Join-Path $env:TEMP 'mydelivery-native-out.txt';$err=Join-Path $env:TEMP 'mydelivery-native-err.txt'
  $env:ELECTRON_RUN_AS_NODE='1'
  try {
    $p=Start-Process -FilePath $exe -ArgumentList '--version' -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -Wait
    if ($p.ExitCode -ne 0) { throw "Native loader failed ($label): $($p.ExitCode) $(Get-Content $err -Raw)" }
    if ((Get-Content $out -Raw) -notmatch 'v\d+\.\d+') { throw 'Native runtime returned no version' }
  } finally { Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }
  $app=Start-Process -FilePath $exe -PassThru
  $windowFound=$false
  for($i=0;$i -lt 45;$i++) {
    Start-Sleep -Seconds 1
    $app.Refresh()
    if ($app.HasExited) { throw "Packaged app exited before opening ($label): $($app.ExitCode)" }
    if ($app.MainWindowHandle -ne 0) { $windowFound=$true;break }
  }
  if (!$windowFound) { throw "No native window opened ($label)" }
  Start-Sleep -Seconds 3
  $app.Refresh();if($app.HasExited){throw "Window crashed ($label): $($app.ExitCode)"}
  Stop-TestApp
  Write-Output "PASS: $label - $ExpectedArch native DLLs, Electron loader, installed application window"
}
try {
  if ($UnpackedDirectory) {
    $installDir = (Resolve-Path $UnpackedDirectory).Path
    $exe = Join-Path $installDir 'MyDelivery.exe'
    Assert-Starts 'Packaged architecture runtime'
    Assert-Starts 'Reopen packaged architecture runtime'
    exit 0
  }
  if ($PreviousInstaller) {
    Install-App (Resolve-Path $PreviousInstaller).Path
    Assert-Starts 'Previous release'
    $previousHash=(Get-FileHash (Join-Path $installDir 'resources/app.asar') -Algorithm SHA256).Hash
    $userDir=Join-Path $env:APPDATA 'MyDelivery'
    New-Item -ItemType Directory -Force -Path $userDir | Out-Null
    $settings=Join-Path $userDir 'printing.json'
    [IO.File]::WriteAllText($settings,'{"printerName":"CI test printer","width":58,"mode":"driver"}')
    $settingsHash=(Get-FileHash $settings -Algorithm SHA256).Hash
  }
  Install-App
  if ($PreviousInstaller -and (Get-FileHash (Join-Path $installDir 'resources/app.asar') -Algorithm SHA256).Hash -eq $previousHash) { throw 'Upgrade did not replace application code' }
  if ($PreviousInstaller -and (Get-FileHash $settings -Algorithm SHA256).Hash -ne $settingsHash) { throw 'Upgrade changed printer preferences' }
  Assert-Shortcut
  Assert-Starts 'Clean installation'
  Assert-NormalExit
  Assert-Starts 'Reopen installed app'
  Assert-Starts 'Third launch'
  if ($TestRepair) {
    $dll=Join-Path $installDir 'ffmpeg.dll';$before=(Get-FileHash $dll -Algorithm SHA256).Hash
    # Deliberately damage only the disposable CI installation, then verify repair.
    [IO.File]::WriteAllText($dll,'test damaged application DLL')
    Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) 'MyDelivery.lnk')
    Install-App
    if ((Get-FileHash $dll -Algorithm SHA256).Hash -ne $before) { throw 'Reinstallation did not restore the damaged DLL' }
    Assert-Shortcut
    Assert-Starts 'Reinstallation repairs damaged DLL and missing shortcut'
    if ($PreviousInstaller -and (Get-FileHash $settings -Algorithm SHA256).Hash -ne $settingsHash) { throw 'Repair changed printer preferences' }
  }
} finally { Stop-TestApp }
