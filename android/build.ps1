<#
  Builds Sideline for Google TV (sideline-tv.apk) straight from the Android SDK command-line tools: no Gradle, no
  Android Studio. Needs a JDK 17+ (javac, jar, keytool) and the SDK from setup-sdk.ps1.
  The APK is signed with a local debug key (created on first build): fine for sideloading on your own TV.
#>
param([string]$Sdk = $(if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }))
$ErrorActionPreference = 'Stop'

function Run([string]$exe, [string[]]$argv) {
    & $exe @argv
    if ($LASTEXITCODE -ne 0) { throw "$([IO.Path]::GetFileName($exe)) failed (exit $LASTEXITCODE)" }
}

$here = $PSScriptRoot
$root = Split-Path $here
$platform = Get-ChildItem (Join-Path $Sdk 'platforms') -Directory -ErrorAction SilentlyContinue |
    Sort-Object { [int]($_.Name -replace '\D', '') } | Select-Object -Last 1
$tools = Get-ChildItem (Join-Path $Sdk 'build-tools') -Directory -ErrorAction SilentlyContinue |
    Sort-Object { [version]($_.Name -replace '-.*', '') } | Select-Object -Last 1
if (-not $platform -or -not $tools) { throw "No Android platform or build-tools in $Sdk. Run setup-sdk.ps1 first." }
$androidJar = Join-Path $platform.FullName 'android.jar'
$t = $tools.FullName

# Fresh build folder (only ever our own android\build)
$b = Join-Path $here 'build'
if (Test-Path $b) { Remove-Item $b -Recurse -Force }
$web = Join-Path $b 'stage\assets\web'
New-Item -ItemType Directory -Force (Join-Path $b 'gen'), (Join-Path $b 'classes'), (Join-Path $b 'dex'), (Join-Path $web 'src'), (Join-Path $web 'tv') | Out-Null

# The same web code the Chrome extension ships, plus the TV pages (not the desktop-only dev server)
Copy-Item (Join-Path $root 'src\core'), (Join-Path $root 'src\ui') (Join-Path $web 'src') -Recurse
Copy-Item (Join-Path $root 'src\content.js'), (Join-Path $root 'src\options.js') (Join-Path $web 'src')
Get-ChildItem (Join-Path $root 'tv') -File | Where-Object Name -ne 'dev-server.js' | Copy-Item -Destination (Join-Path $web 'tv')

Write-Host "Using $($platform.Name), build-tools $($tools.Name)"
Run "$t\aapt2.exe" @('compile', '--dir', (Join-Path $here 'res'), '-o', (Join-Path $b 'res.zip'))
Run "$t\aapt2.exe" @('link', '-o', (Join-Path $b 'app.unsigned.apk'), '-I', $androidJar, '--manifest', (Join-Path $here 'AndroidManifest.xml'),
    '--java', (Join-Path $b 'gen'), (Join-Path $b 'res.zip'))
# The web pages go in with jar, not aapt2 -A: aapt2 on Windows records "assets/web\tv\home.html" (backslashes) and Android can't open those.
Run 'jar' @('uf', (Join-Path $b 'app.unsigned.apk'), '-C', (Join-Path $b 'stage'), 'assets')

$sources = Get-ChildItem (Join-Path $here 'src'), (Join-Path $b 'gen') -Recurse -Filter *.java | ForEach-Object FullName
Run 'javac' (@('-source', '11', '-target', '11', '-Xlint:-options', '-encoding', 'UTF-8', '-classpath', $androidJar, '-d', (Join-Path $b 'classes')) + $sources)

$classes = Get-ChildItem (Join-Path $b 'classes') -Recurse -Filter *.class | ForEach-Object FullName
Run "$t\d8.bat" (@('--release', '--min-api', '26', '--lib', $androidJar, '--output', (Join-Path $b 'dex')) + $classes)
Run 'jar' @('uf', (Join-Path $b 'app.unsigned.apk'), '-C', (Join-Path $b 'dex'), 'classes.dex')
Run "$t\zipalign.exe" @('-p', '-f', '4', (Join-Path $b 'app.unsigned.apk'), (Join-Path $b 'app.aligned.apk'))

$ks = Join-Path $here 'debug.keystore'
$pass = if ($env:SIDELINE_KEYSTORE_PASS) { $env:SIDELINE_KEYSTORE_PASS } else { 'android' }   # debug key for sideloading; set the variable for your own
if (-not (Test-Path $ks)) {
    Run 'keytool' @('-genkeypair', '-keystore', $ks, '-storepass', $pass, '-keypass', $pass, '-alias', 'sideline',
        '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=Sideline debug')
}
$apk = Join-Path $root 'sideline-tv.apk'
Run "$t\apksigner.bat" @('sign', '--ks', $ks, '--ks-pass', "pass:$pass", '--key-pass', "pass:$pass", '--out', $apk, (Join-Path $b 'app.aligned.apk'))
Write-Host "Built $apk"
