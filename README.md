# codex-duel and claude-duel

Two mirror-image skills for a bounded adversarial review between Claude and
OpenAI Codex.

`codex-duel` runs in Claude Code: Claude answers first, Codex attacks the
answer, Claude integrates what survives, at most two Codex turns.

`claude-duel` runs in Codex: Codex answers first, Claude Code attacks the
answer, Codex integrates what survives, at most two Claude turns.

Both skills return one integrated answer, not a transcript of the exchange.

## codex-duel (runs in Claude Code)

### Requirements

- Claude Code.
- The OpenAI Codex plugin for Claude Code. codex-duel calls the plugin's
  `codex-companion.mjs`, found under
  `~/.claude/plugins/cache/openai-codex/codex/*/scripts/`.
- An authenticated Codex.

### Install

Copy `claude-code/codex-duel` to `~/.claude/skills/codex-duel`.

### Usage

Manual only (`disable-model-invocation: true`). Invoke as:

```
/codex-duel [flags] <question>
```

| Flag | Values | Default |
| --- | --- | --- |
| `--model` | `astra`, `sol`, `terra`, `luna`, or the full ids `gpt-6-astra`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` | `astra` |
| `--effort` | `low`, `medium`, `high`, `xhigh` | `xhigh` |
| `--fast` | no value | off |

### Notable behavior

- Read-only by default. File edits happen only if the underlying request
  explicitly asks for implementation or file changes.
- `--fast` temporarily flips `service_tier` in `~/.codex/config.toml` to
  `"fast"` and restores it afterward. The toggle command reads
  `USERPROFILE`, so it works on Windows as written. On macOS or Linux,
  replace `USERPROFILE` with `HOME`.
- Maximum two Codex turns per duel, 25 minutes wall-clock per turn.

## claude-duel (runs in Codex)

### Requirements

- Node.js.
- An installed, authenticated Claude Code CLI, version 2.1.251 or newer for
  Fable 5.1.

### Install

Copy `codex/claude-duel` to `~/.codex/skills/claude-duel`.

### Usage

Manual only (`allow_implicit_invocation: false`). Invoke as:

```
$claude-duel [flags] <question>
```

| Flag | Values | Default |
| --- | --- | --- |
| `--model` | `fable`, `fable-5.1`, `claude-fable-5-1`, or an explicitly requested full `claude-...` model ID | `claude-fable-5-1` |
| `--effort` | `low`, `medium`, `high`, `xhigh`, `max` | `high` |

### Notable behavior

- The reviewer (Claude Code) gets only `Read`, `Glob`, `Grep`, `WebSearch`,
  `WebFetch`. Pass `--no-web` to drop the two web tools.
- The helper checks the reviewer model on every assistant message in
  Claude's structured event stream, not just on aggregate usage.
- Maximum two Claude turns per duel, 25 minutes per turn.

## License

MIT.
