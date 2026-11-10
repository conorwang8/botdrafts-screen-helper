param([string]$OutputDirectory = '', [string]$BuildDirectory = '')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'dist' }
if (-not $BuildDirectory) { $BuildDirectory = Join-Path $projectRoot ('build\windows-' + [Guid]::NewGuid().ToString('N')) }
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
$buildRoot = [IO.Path]::GetFullPath($BuildDirectory)
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$version = $package.version
$nodePath = (Get-Command node -ErrorAction Stop).Source
$nodeVersion = (& $nodePath --version).Trim()
if ([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 24) { throw 'Node.js 24 or newer is required to build.' }
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'The Windows .NET Framework C# compiler was not found.' }
foreach ($required in @('node_modules\sharp\package.json','assets\catalog.json','upstream\index.html','eng.traineddata.gz')) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $required))) { throw 'Run npm ci and npm run setup before building.' }
}
New-Item -ItemType Directory -Force -Path $outputRoot,$buildRoot | Out-Null
$payloadRoot = Join-Path $buildRoot 'payload'
$appRoot = Join-Path $payloadRoot 'app'
$runtimeRoot = Join-Path $payloadRoot 'runtime'
New-Item -ItemType Directory -Force -Path $appRoot,$runtimeRoot | Out-Null
Write-Host 'Preparing the application files…'
foreach ($name in @('server.mjs','vision.mjs','tracker.mjs','layout.mjs','site-bridge.mjs','helper.js','helper.css','package.json','package-lock.json','eng.traineddata.gz')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination (Join-Path $appRoot $name)
}
foreach ($name in @('node_modules','assets','upstream')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination (Join-Path $appRoot $name) -Recurse
}
Copy-Item -LiteralPath $nodePath -Destination (Join-Path $runtimeRoot 'node.exe')
Write-Host 'Including runtime license notices…'
Invoke-WebRequest -Uri ('https://raw.githubusercontent.com/nodejs/node/' + $nodeVersion + '/LICENSE') -OutFile (Join-Path $runtimeRoot 'NODE-LICENSE.txt') -UseBasicParsing
Copy-Item -LiteralPath (Join-Path $projectRoot 'windows\THIRD-PARTY-NOTICES.txt') -Destination (Join-Path $payloadRoot 'THIRD-PARTY-NOTICES.txt')
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipPath = Join-Path $buildRoot 'payload.zip'
Write-Host 'Compressing the bundled reader and runtime…'
[IO.Compression.ZipFile]::CreateFromDirectory($payloadRoot,$zipPath,[IO.Compression.CompressionLevel]::Optimal,$false)
$payloadHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
$buildInfoPath = Join-Path $buildRoot 'BuildInfo.cs'
@"
using System.Reflection;
[assembly: AssemblyTitle("BotDrafts Helper")]
[assembly: AssemblyProduct("BotDrafts Helper")]
[assembly: AssemblyDescription("Local Brawl Stars ranked draft reader")]
[assembly: AssemblyVersion("$version.0")]
[assembly: AssemblyFileVersion("$version.0")]
internal static class BuildInfo {
    internal const string Version = "$version";
    internal const string PayloadHash = "$payloadHash";
}
"@ | Set-Content -LiteralPath $buildInfoPath -Encoding UTF8
$exePath = Join-Path $outputRoot 'BotDrafts-Helper.exe'
Write-Host 'Building the Windows executable…'
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll /reference:System.Web.Extensions.dll "/out:$exePath" "/resource:$zipPath,BotDrafts.Payload.zip" "/win32manifest:$(Join-Path $projectRoot 'windows\app.manifest')" (Join-Path $projectRoot 'windows\Launcher.cs') $buildInfoPath
if ($LASTEXITCODE -ne 0) { throw 'The Windows executable could not be built.' }
$exeHash = (Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash.ToLowerInvariant()
($exeHash + '  BotDrafts-Helper.exe') | Set-Content -LiteralPath (Join-Path $outputRoot 'SHA256SUMS.txt') -Encoding ascii
@{version=$version;node=$nodeVersion;platform='win-x64';sha256=$exeHash;bytes=(Get-Item -LiteralPath $exePath).Length} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputRoot 'build-info.json') -Encoding UTF8
Write-Host ('Ready: ' + $exePath)
