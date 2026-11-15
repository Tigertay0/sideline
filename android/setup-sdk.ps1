<#
  One-time setup for building the Google TV app: Google's Android SDK command-line tools, one platform, one set of
  build-tools. About 600 MB. Google's Android SDK license comes up in this window: read it and type y to accept.
#>
$ErrorActionPreference = 'Stop'
$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$tools = Join-Path $sdk 'cmdline-tools\latest'
$sdkmanager = Join-Path $tools 'bin\sdkmanager.bat'

if (-not (Test-Path $sdkmanager)) {
    $zip = Join-Path $env:TEMP 'android-commandlinetools-win.zip'
    $unpack = Join-Path $env:TEMP 'android-commandlinetools'
    Write-Host 'Downloading the Android SDK command-line tools from dl.google.com (about 150 MB)...'
    Invoke-WebRequest 'https://dl.google.com/android/repository/commandlinetools-win-14742923_latest.zip' -OutFile $zip
    if (Test-Path $unpack) { Remove-Item $unpack -Recurse -Force }
    Expand-Archive $zip -DestinationPath $unpack
    New-Item -ItemType Directory -Force (Split-Path $tools) | Out-Null
    Move-Item (Join-Path $unpack 'cmdline-tools') $tools
    Remove-Item $zip -Force
}

Write-Host ''
Write-Host "Google's Android SDK license is next. Read it, then type y and press Enter to accept."
& $sdkmanager "--sdk_root=$sdk" --licenses
if ($LASTEXITCODE -ne 0) { throw 'The license was not accepted, so nothing was installed.' }

& $sdkmanager "--sdk_root=$sdk" 'platforms;android-35' 'build-tools;35.0.0' 'platform-tools'
if ($LASTEXITCODE -ne 0) { throw 'sdkmanager could not install the platform and build-tools.' }

Write-Host ''
Write-Host "Done. The SDK is in $sdk. You can close this window."
