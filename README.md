# agent-skills

Skills for Claude Code and OpenAI Codex.

| Skill | Runs in | Folder |
| --- | --- | --- |
| `codex-duel` | Claude Code | `claude-code/codex-duel` |
| `claude-duel` | Codex | `codex/claude-duel` |
| `bmw-lease-rates` | Claude Code and Codex | `shared/bmw-lease-rates` |
| `vw-lease-rates` | Codex | `codex/vw-lease-rates` |
| `openrouter-agent` | Codex on Windows | `codex/openrouter-agent` |
| `clear-writing` | Claude Code | `claude-code/clear-writing` |

## Duel skills

`codex-duel` and `claude-duel` are two mirror-image skills for a bounded
adversarial review between Claude and OpenAI Codex.

`codex-duel` runs in Claude Code: Claude answers first, Codex attacks the
answer, Claude integrates what survives, at most two Codex turns.

`claude-duel` runs in Codex: Codex answers first, Claude Code attacks the
answer, Codex integrates what survives, at most two Claude turns.

Both skills return one integrated answer by default. Add `--blind` to
withhold the lead's answer in round 1, then compare and challenge the
independent answers in round 2. Blind mode always uses two reviewer turns.

For authorized code changes, check the final revised files after the last
edit. If round 2 remains available, send the revised artifact and check
results to the reviewer. Agreement alone does not verify the implementation.

Runtime and wide-mode details live in each skill's `references/` directory.
Release histories are preserved in separate `CHANGELOG.md` files.

Both also offer `--wide` for open or broad questions: round 1 is blind, both
models list the defensible answers independently, the lead merges them with
origin tags, and the final response is a map of candidates with the points
where the models weigh differently, not a single conclusion. `--steer` adds
one pause after the merge in which the user steers round 2 (deepen, drop,
add).

## codex-duel 1.5.0 (runs in Claude Code)

### Requirements

- Claude Code.
- Node.js.
- An installed, authenticated Codex CLI. The included helper calls
  `codex exec` directly.

### Install

Copy `claude-code/codex-duel` to `~/.claude/skills/codex-duel`.

The companion plugin and its old `max` effort patch are no longer required.
The patch remains in the repository for older releases.

### Usage

Use only on an explicit user request to run Codex Duel. Ask Claude in
natural language (for example, "Use Codex Duel to review this change") or
invoke it directly:

```
/codex-duel [flags] <question>
```

| Flag | Values | Default |
| --- | --- | --- |
| `--model` | `astra`, `sol`, `terra`, `luna` or the full ids `gpt-6-astra`, `gpt-6.1-sol`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` | `astra` |
| `--effort` | `low`, `medium`, `high`, `xhigh`, `max` | `xhigh` |
| `--fast` | no value | off |
| `--blind` | no value | off |
| `--wide` | no value; includes a blind first pass | off |
| `--steer` | no value, requires `--wide` | off |

The aliases select `gpt-6-astra`, `gpt-6.1-sol`, `gpt-5.6-terra` and
`gpt-6-luna`, respectively. Terra is a legacy option. Explicit full model
IDs are preserved.

### Notable behavior

- The local helper runs in the background and resumes the exact saved session
  ID, even when another task ran between rounds.
- Read-only by default. File edits require authorization in the underlying task.
- `--fast` requests fast processing for each invocation. Without it, the helper
  requests the default tier. Saved configuration stays untouched on success,
  failure and pauses.
- The helper enforces two reviewer turns and one active worker per state file.
- Model and effort are explicitly requested. The exec event stream does not
  independently attest the serving model or effort.
- Runtime checks use simulated CLI responses. No live model calls were made
  for this release.

## claude-duel 1.2.0 (runs in Codex)

### Requirements

- Node.js.
- An installed, authenticated Claude Code CLI, version 2.1.257 or newer for
  Fable 5.1.

### Install

Copy `codex/claude-duel` to `~/.codex/skills/claude-duel`.

### Usage

Use only on an explicit user request to run Claude Duel. Ask Codex in
natural language (for example, "Use Claude Duel to review this change") or
invoke it directly:

```
$claude-duel [flags] <question>
```

| Flag | Values | Default |
| --- | --- | --- |
| `--model` | `fable`, `fable-5.1`, `claude-fable-5-1`, or an explicitly requested full `claude-...` model ID | `claude-fable-5-1` |
| `--effort` | `low`, `medium`, `high`, `xhigh`, `max` | `xhigh` |
| `--blind` | no value | off |
| `--wide` | no value; includes a blind first pass | off |
| `--steer` | no value, requires `--wide` | off |

### Notable behavior

- The reviewer (Claude Code) gets only `Read`, `Glob`, `Grep`, `WebSearch`,
  `WebFetch`. Pass `--no-web` to drop the two web tools.
- The helper disables content-based automatic model switching for each
  invocation with `switchModelsOnFlag: false`.
- The helper checks the reviewer model on every assistant message in
  Claude's structured event stream, not just on aggregate usage.
- Maximum two Claude turns per duel.

## bmw-lease-rates 1.3.0 (runs in Claude Code and Codex)

Calculates current BMW.de used-car lease rates for every vehicle in a
filtered results URL, for a given term, annual mileage and down payment.
Writes a Markdown table of private-customer gross rates and a JSON file with
every quote.

### Requirements

- Node.js 18 or newer. No browser.

### Install

Copy `shared/bmw-lease-rates` to `~/.claude/skills/bmw-lease-rates` or
`~/.codex/skills/bmw-lease-rates`.

### Usage

Give the agent a BMW.de Gebrauchtwagen results URL and ask for lease rates.
The script also runs on its own:

```
node shared/bmw-lease-rates/scripts/bmw_lease_rates.mjs --url "<BMW_RESULTS_URL>" --term 36 --mileage 10000 --down-payment 0 --out .
```

Offline regression tests with mocked responses: `node --test shared/bmw-lease-rates/tests/lease-rates.test.mjs`.

## vw-lease-rates 1.1.0 (runs in Codex)

Calculates real VWFS private lease rates (PrivatLeasing) through VWFS
WebCalc for every vehicle in a Volkswagen.de used-car search URL. Several
terms per run are possible (`--terms 24-36`). Writes Markdown and JSON. The
skill text is in German.

### Requirements

- Node.js 18 or newer. No browser.

### Install

Copy `codex/vw-lease-rates` to `~/.codex/skills/vw-lease-rates`.

### Usage

Give the agent a Volkswagen.de search URL and ask for lease rates. The script
also runs on its own:

```
node codex/vw-lease-rates/scripts/vw_lease_rates.mjs --url "<VW_SEARCH_URL>" --terms 24-36 --mileage 10000 --down-payment 0 --out .
```

Offline regression tests with mocked responses: `node --test codex/vw-lease-rates/tests/lease-rates.test.mjs`.

## openrouter-agent 1.1.1 (runs in Codex on Windows)

Runs a bounded OpenRouter consultation in a separate Codex process while the
parent Desktop session keeps its OpenAI provider and model catalog.

### Requirements and install

Windows, PowerShell 5.1 or newer, Node.js 20.3 or newer, the npm installation
of Codex CLI and an OpenRouter API key. Copy `codex/openrouter-agent` to
`~/.codex/skills/openrouter-agent`, then follow the included
[setup instructions](codex/openrouter-agent/references/setup.md). The package
includes its runtime, credential hook and isolated-configuration initializer.

The default `@preset/z-ai-glm-5-3-flash` is an account-owned OpenRouter preset,
not a public model ID. To reproduce it, create a preset with that slug,
select `z-ai/glm-5.3-flash` and set reasoning effort to `max`. The original
preset also enables `openrouter:datetime`, `openrouter:web_search` and
`openrouter:web_fetch`. Those server tools can incur additional charges.
Alternatively, pass `-Model z-ai/glm-5.3-flash -Effort max` to use the model
directly without that preset or its tools. No account configuration or API
key is included in this repository.

### Usage

Use only on an explicit user request for an OpenRouter consultation. Ask
Codex in natural language (for example, "Have OpenRouter Agent review this
change") or invoke it directly:

```text
$openrouter-agent <bounded task>
```

The PowerShell helper also exposes `-Model`, `-ExpectedModel`, `-Effort`,
`-MaxRequests`, `-TimeoutSeconds` and `-ValidateOnly`. Readiness reads current
model and preset metadata without starting inference.

The defaults are GLM 5.3 Flash with `max`, 25 minutes and at most eight
forwarded Responses requests. Automatic retries are disabled. A temporary
loopback gateway checks the responding model and enforces the request cap.
The child runs read-only; the parent handles authorized edits. A request cap
does not cap the cost of server-side tools or internal provider work.

Runtime verification for version 1.1.0 covered 24 offline tests, the real Codex CLI
against simulated responses and read-only metadata checks. No paid inference
was used for the update or publication.

## clear-writing 1.0.0 (runs in Claude Code)

A light version of ASD-STE100 Simplified Technical English for agent answers,
in English and German. It keeps 13 of 16 core rules: one word per thing, no
private labels or undefined abbreviations, verbs for actions, one idea per
sentence, no semicolons, vertical lists, main statement first, and a reason
with every instruction. It leaves out the STE dictionary and the bans on
perfect tenses and "-ing" forms, because those fit English manuals only.

### Install

Copy `claude-code/clear-writing` to `~/.claude/skills/clear-writing`.

### Usage

Manual only (`disable-model-invocation: true`):

```text
/clear-writing [text or task to apply it to]
```

Without an argument, the rules apply from the call to the end of the session.

## License

MIT.
