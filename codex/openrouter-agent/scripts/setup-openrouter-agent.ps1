[CmdletBinding(SupportsShouldProcess = $true)]
param()

$ErrorActionPreference = 'Stop'
$isolatedHome = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex-openrouter'
$targetConfig = Join-Path $isolatedHome 'config.toml'
if (Test-Path -LiteralPath $targetConfig) {
    throw 'An isolated config already exists. Preserve it and follow references/setup.md for migration.'
}
$authScript = Join-Path $PSScriptRoot 'read-openrouter-key.ps1'
if (-not (Test-Path -LiteralPath $authScript -PathType Leaf)) { throw 'Credential hook is missing.' }
$authPathToml = $authScript.Replace('\', '/').Replace('"', '\"')
$configText = @"
model_provider = "openrouter"
model = "@preset/z-ai-glm-5-3-flash"
approval_policy = "never"
sandbox_mode = "read-only"
web_search = "disabled"

[model_providers.openrouter]
name = "OpenRouter"
base_url = "https://openrouter.ai/api/v1"
wire_api = "responses"
request_max_retries = 0
stream_max_retries = 0

[model_providers.openrouter.auth]
command = "powershell"
args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "$authPathToml"]
timeout_ms = 5000
refresh_interval_ms = 0
"@
if ($PSCmdlet.ShouldProcess($targetConfig, 'Create isolated OpenRouter configuration')) {
    [void][System.IO.Directory]::CreateDirectory($isolatedHome)
    $stream = [System.IO.File]::Open($targetConfig, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write)
    try {
        $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($configText + "`n")
        $stream.Write($bytes, 0, $bytes.Length)
    } finally { $stream.Dispose() }
    Write-Output 'Isolated OpenRouter configuration created. Run -ValidateOnly before a consultation.'
}
