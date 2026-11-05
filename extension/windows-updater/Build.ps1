param([string]$OutputPath)
$ErrorActionPreference='Stop'
if(-not $OutputPath){$OutputPath=Join-Path $PSScriptRoot 'MetaAssistantUpdater.exe'}
$source=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Updater.cs') -Raw -Encoding UTF8
$buildOutput=Join-Path ([IO.Path]::GetTempPath()) ('meta-assistant-build-'+[guid]::NewGuid().ToString('N')+'.exe')
Add-Type -TypeDefinition $source -ReferencedAssemblies @('System.Web.Extensions','System.IO.Compression','System.IO.Compression.FileSystem','System.Windows.Forms','System.Drawing','System.Core') -OutputAssembly $buildOutput -OutputType WindowsApplication
Copy-Item -LiteralPath $buildOutput -Destination $OutputPath -Force
