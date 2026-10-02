[CmdletBinding()]
param(
    [string]$Task = '',
    [ValidatePattern('^(?:@preset/[A-Za-z0-9][A-Za-z0-9._/-]*|[A-Za-z0-9][A-Za-z0-9._:/-]*(?:@preset/[A-Za-z0-9][A-Za-z0-9._/-]*)?)$')]
    [string]$Model = '@preset/z-ai-glm-5-3-flash',
    [string]$ExpectedModel = '',
    [ValidateSet('', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max')]
    [string]$Effort = '',
    [ValidateNotNullOrEmpty()]
    [string]$WorkingDirectory = (Get-Location).Path,
    [ValidateRange(1, 3600)]
    [int]$TimeoutSeconds = 1500,
    [ValidateRange(1, 100)]
    [int]$MaxRequests = 8,
    [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $ValidateOnly -and [string]::IsNullOrWhiteSpace($Task)) {
    throw 'Task must not be empty for an agent run.'
}
if ($Model -eq '@preset/z-ai-glm-5-3-flash') {
    if ([string]::IsNullOrWhiteSpace($ExpectedModel)) { $ExpectedModel = 'z-ai/glm-5.3-flash' }
    if ([string]::IsNullOrWhiteSpace($Effort)) { $Effort = 'max' }
}
$resolvedWorkingDirectory = (Resolve-Path -LiteralPath $WorkingDirectory -ErrorAction Stop).Path
if (-not (Test-Path -LiteralPath $resolvedWorkingDirectory -PathType Container)) {
    throw 'WorkingDirectory must be an existing directory.'
}
$isolatedCodexHome = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex-openrouter'
if (-not (Test-Path -LiteralPath (Join-Path $isolatedCodexHome 'config.toml') -PathType Leaf)) {
    throw 'Isolated OpenRouter config is missing. Follow references/setup.md.'
}
$runtime = Join-Path $PSScriptRoot 'openrouter-agent.mjs'
$authScript = Join-Path $PSScriptRoot 'read-openrouter-key.ps1'
foreach ($dependency in @($runtime, $authScript)) {
    if (-not (Test-Path -LiteralPath $dependency -PathType Leaf)) { throw "Required helper is missing: $dependency" }
}
$node = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1
$nodeVersion = (& $node.Source --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.(\d+)\.' -or [int]$Matches[1] -lt 20 -or ([int]$Matches[1] -eq 20 -and [int]$Matches[2] -lt 3)) {
    throw 'Node.js 20.3 or newer is required.'
}
$codex = Get-Command codex -ErrorAction Stop | Select-Object -First 1
$codexEntry = Join-Path (Split-Path -Parent $codex.Source) 'node_modules\@openai\codex\bin\codex.js'
if (-not (Test-Path -LiteralPath $codexEntry -PathType Leaf)) {
    throw 'The npm-installed Codex CLI entrypoint was not found. Follow references/setup.md.'
}
$storedKey = [Environment]::GetEnvironmentVariable('OPENROUTER_API_KEY', 'User')
if ([string]::IsNullOrWhiteSpace($storedKey)) { throw 'OPENROUTER_API_KEY is not configured for the Windows user.' }

$request = @{
    task = $Task
    model = $Model
    expectedModel = $ExpectedModel
    effort = $Effort
    workingDirectory = $resolvedWorkingDirectory
    codexHome = $isolatedCodexHome
    codexEntry = $codexEntry
    authScript = $authScript
    apiKey = $storedKey
    validateOnly = [bool]$ValidateOnly
    timeoutSeconds = $TimeoutSeconds
    maxRequests = $MaxRequests
}
if ([string]::IsNullOrWhiteSpace($ExpectedModel)) { $request.Remove('expectedModel') }
if ([string]::IsNullOrWhiteSpace($Effort)) { $request.Remove('effort') }
$process = New-Object System.Diagnostics.Process
$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $node.Source
$startInfo.Arguments = '"' + $runtime + '"'
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
$startInfo.RedirectStandardInput = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$utf8 = New-Object System.Text.UTF8Encoding($false)
$startInfo.StandardOutputEncoding = $utf8
$startInfo.StandardErrorEncoding = $utf8
$process.StartInfo = $startInfo
$started = $false
try {
    $started = $process.Start()
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $inputBytes = $utf8.GetBytes(($request | ConvertTo-Json -Depth 6 -Compress))
    $process.StandardInput.BaseStream.Write($inputBytes, 0, $inputBytes.Length)
    $process.StandardInput.BaseStream.Close()
    [Array]::Clear($inputBytes, 0, $inputBytes.Length)
    $storedKey = $null
    $request.apiKey = $null
    if (-not $process.WaitForExit(($TimeoutSeconds + 45) * 1000)) {
        throw 'OpenRouter helper exceeded its supervision deadline.'
    }
    $outputText = $stdoutTask.GetAwaiter().GetResult()
    $errorText = $stderrTask.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) {
        if (-not [string]::IsNullOrWhiteSpace($outputText)) { Write-Output $outputText.Trim() }
        throw 'OpenRouter agent failed. See the structured error above; no retry was started.'
    }
    if ([string]::IsNullOrWhiteSpace($outputText)) { throw 'OpenRouter helper returned no result.' }
    $null = $outputText | ConvertFrom-Json -ErrorAction Stop
    Write-Output $outputText.Trim()
}
finally {
    $storedKey = $null
    $request.apiKey = $null
    if ($started -and -not $process.HasExited) {
        & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F 2>$null | Out-Null
    }
    $process.Dispose()
}
