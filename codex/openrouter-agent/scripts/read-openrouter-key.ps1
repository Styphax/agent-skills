$ErrorActionPreference = 'Stop'
# The supervised child receives only a per-run loopback credential here.
$openRouterToken = [Environment]::GetEnvironmentVariable('OPENROUTER_API_KEY', 'Process')
if ([string]::IsNullOrWhiteSpace($openRouterToken)) {
    $openRouterToken = [Environment]::GetEnvironmentVariable('OPENROUTER_API_KEY', 'User')
}
if ([string]::IsNullOrWhiteSpace($openRouterToken)) {
    throw 'OPENROUTER_API_KEY is not configured.'
}
# This script is a Codex auth hook. Never run it interactively or log stdout.
Write-Output $openRouterToken
