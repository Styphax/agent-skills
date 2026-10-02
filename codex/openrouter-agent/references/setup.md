# Setup and verification

This helper targets Windows with PowerShell 5.1 or newer, Node.js 20.3 or newer
and the npm installation of Codex CLI. The current offline verification uses
Codex CLI 0.155.1. It resolves Codex's JavaScript entrypoint beside the npm
launcher and fails with an explicit error if that layout is unavailable.

## Required files

Keep the skill package together:

- `SKILL.md` and `agents/openai.yaml`
- `scripts/invoke-openrouter-agent.ps1`, the public entrypoint
- `scripts/openrouter-agent.mjs`, the supervisor and per-run gateway
- `scripts/read-openrouter-key.ps1`, the Codex credential hook
- `scripts/setup-openrouter-agent.ps1`, the initializer for a new Codex home

The isolated configuration lives in `%USERPROFILE%/.codex-openrouter/config.toml`.
It must not replace the parent `%USERPROFILE%/.codex/config.toml`.

Store the real API key in the Windows **user** environment variable
`OPENROUTER_API_KEY`, using the Windows environment-variable settings. Do not
paste it into a task, command history or a configuration file. The wrapper
reads the value without displaying it and sends it to its supervisor over
stdin. Do not execute the credential hook manually: its output is a token.

For a new installation, run the initializer after the skill files and key
are in place:

```powershell
& "<skill-dir>/scripts/setup-openrouter-agent.ps1"
```

The initializer creates only the isolated home's configuration and refuses
to overwrite an existing configuration. For an existing installation,
preserve unrelated settings and update the OpenRouter provider's auth hook
to this package's `read-openrouter-key.ps1`. Its base URL is
`https://openrouter.ai/api/v1`, protocol `responses`, with
`request_max_retries = 0` and `stream_max_retries = 0`.

The wrapper overrides the provider URL with a temporary loopback address for
its supervised run. Its auth override uses the same hook, but supplies a
per-run process token instead of the user API key. Ordinary Codex runs outside
this helper do not inherit the helper's request cap or model verification.

## Readiness

```powershell
& "<skill-dir>/scripts/invoke-openrouter-agent.ps1" -ValidateOnly -WorkingDirectory "<task-dir>"
```

Readiness checks local dependencies and reads the current OpenRouter catalog
and active preset. Check the resolved model, supported effort and server
tools in the report. It sends no Responses request and does not prove that
paid inference or a server tool will succeed. A missing key, unavailable
endpoint, ambiguous model or unsupported effort must be resolved before a run.

Use the same model and effort arguments for readiness and the consultation.
For the standard preset, the expected model is `z-ai/glm-5.3-flash` and the
effort is `max`. `xhigh` is not an advertised effort for this model. A preset
can change remotely, so the helper resolves it again at the start of a run.

## Limits and errors

One consultation defaults to 1500 seconds and eight forwarded Responses
requests. Automatic request and stream retries are disabled. The helper
fails on mismatched or missing model evidence and terminates only its own
process tree on timeout. Higher limits need explicit user authorization.

Server-side web tools and provider routing run inside OpenRouter. Their
internal calls are not included in the helper's request count. For a monetary
ceiling, use OpenRouter's key spending controls. Configuring those controls is
a separate account change, not part of skill setup.

The old `ensure-openrouter-max-proxy.ps1` and `openrouter-max-proxy.js` in the
isolated home are no longer referenced. Existing copies may be retained for
rollback. Do not stop another session's running proxy or delete files as part
of a readiness check.

## References

- [Codex configuration](https://learn.chatgpt.com/docs/config-file/config-reference)
- [OpenRouter model catalog](https://openrouter.ai/api/v1/models)
- [OpenRouter presets](https://openrouter.ai/docs/guides/features/presets)
- [GLM 5.3 Flash model card](https://huggingface.co/zai-org/GLM-5.3-Flash)
