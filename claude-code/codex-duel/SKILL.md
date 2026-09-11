---
name: codex-duel
description: Run a bounded adversarial exchange between Claude and Codex on one question, defaulting to GPT-6 Astra with xhigh reasoning effort; GPT-5.6 Sol, Terra and Luna and Codex fast mode are optional.
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(ls:*)
metadata:
  version: 1.2.0
---

Run a bounded Claude-Codex review: Claude answers first, Codex attacks the
answer, Claude integrates what survives. At most two Codex turns.

## Arguments

`$ARGUMENTS` is parsed as optional flags followed by the question.

| Flag | Values | Default |
| --- | --- | --- |
| `--model` | `astra`, `sol`, `terra`, `luna` or the full ids `gpt-6-astra`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` | `astra` |
| `--effort` | `low`, `medium`, `high`, `xhigh` | `xhigh` |
| `--fast` | no value | off |

- `astra` maps to `gpt-6-astra`; `sol`, `terra` and `luna` map to
  `gpt-5.6-<name>`. Pass the full model id to the runtime script.
- With no model or effort flags, pass `--model gpt-6-astra --effort xhigh`.
  An explicit override changes only its own setting.
- Any other model or effort value: stop and ask the user. Never substitute
  another model or effort, never downgrade silently.
- The text after the flags is the exact question. If it is empty, use the
  latest substantive user question in this conversation.
- Preserve all material constraints from the surrounding conversation.

## Codex runtime

Runtime script (resolve once, reuse the path):

```
SCRIPT=$(ls -d ~/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs | tail -1)
```

Run every `node "$SCRIPT" ...` call from the repository root (the current
working directory). Codex jobs are tracked per workspace.

Rules:

- Always `task --background`. Never `task --wait` and never a foreground
  `task`: a Bash call is killed after 10 minutes, the Codex job then stays
  marked "running" and blocks every later resume.
- Do not go through the `codex:codex-rescue` subagent. It decides on its own
  between foreground and background and does not return the job id reliably.
- Read-only by default: no `--write` unless the user's request explicitly
  asks for implementation or file changes.
- Long handoffs go into a file in the scratchpad and are passed with
  `--prompt-file <path>` instead of inline quoting.

### Fast mode (only with `--fast`)

Codex fast mode is the config key `service_tier` in `~/.codex/config.toml`
(`"fast"` maps to priority processing). The plugin cannot pass it per run,
but the Codex app-server re-reads the config for every new thread, so
toggling the file is enough. No restart needed.

Enable before round 1:

```
node -e "const fs=require('fs'),p=require('path').join(process.env.USERPROFILE,'.codex','config.toml');fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(/^service_tier = .*$/m,'service_tier = \"fast\"'));console.log(fs.readFileSync(p,'utf8').match(/^service_tier = .*$/m)[0])"
```

Restore after the duel, also after any error, timeout or cancel (replace
`fast` with `default` in the command above). Print the restored line. If the
restore fails, tell the user in the final answer.

Caveats to keep in mind: the key is global for Codex CLI and app-server runs,
so other Codex CLI jobs started during the duel run in fast mode too. The
Codex desktop app has its own setting and is unaffected.

### Pre-flight (before every Codex turn)

```
node "$SCRIPT" status
```

If a job shows `running` and its log file has not changed for more than two
minutes, the process is dead. Cancel it first, otherwise a resume fails with
"Task ... is still running":

```
node "$SCRIPT" cancel <job-id>
```

### Start a turn

Round 1 (fresh thread):

```
node "$SCRIPT" task --background --model <model> --effort <effort> --prompt-file <handoff-file>
```

Round 2 (same thread):

```
node "$SCRIPT" task --background --resume-last --model <model> --effort <effort> --prompt-file <handoff-file>
```

The output line "Codex Task started in the background as task-..." carries
the job id. Keep it. `--resume-last` picks the newest tracked task thread in
this repository, so start round 2 directly after round 1 and check in the
status output that the "Codex session ID" is the one from round 1.

### Wait and collect

Run in the background (Bash with `run_in_background: true`):

```
node "$SCRIPT" status <job-id> --wait --timeout-ms 1500000
```

When it returns with status `completed`:

```
node "$SCRIPT" result <job-id>
```

That output is Codex's answer. If the status is still `running` after the
wait (25 minutes), cancel the job, report the timeout to the user and finish
with Claude's own analysis marked as not adversarially reviewed.

## Workflow

1. Parse the flags and the question. Confirm model, effort and fast mode in
   one line to the user before starting.

2. Independently analyze the question and form Claude's provisional answer
   before consulting Codex.

3. Prepare a focused handoff file containing:

   - the exact question,
   - all material facts and constraints,
   - relevant files or paths,
   - Claude's provisional answer,
   - Claude's explicit uncertainties,
   - any claims for which the evidence is weak or incomplete,
   - a research budget: at most 5 minutes of live checks and at most 10
     fetches, then stop researching and write the answer,
   - the answer format: seven numbered sections (own conclusion, verified
     factual errors, overstated or unsupported claims, hidden assumptions,
     omitted alternatives or dependencies, strongest opposing position,
     evidence that would change the conclusion), each point marked as
     verified or judgment call.

   Instruct Codex to work independently before reacting to Claude's answer,
   to give its own conclusion, not to manufacture disagreement, and not to
   edit files unless the underlying user request explicitly asks for
   implementation or file changes.

4. If `--fast` is set, enable fast mode. Run the pre-flight. Start round 1,
   wait, collect.

5. Evaluate every Codex objection independently.

   Do not accept an objection merely because Codex made it.
   Do not average Claude's and Codex's positions.
   Do not manufacture consensus.
   Resolve disagreements based on evidence, logic, and the user's constraints.

6. If no material disagreement remains, stop the inter-agent exchange and
   produce the final answer.

7. If a material disagreement remains, perform exactly one follow-up turn
   with `--resume-last`. The round-2 handoff file contains:

   - Codex's previous conclusion,
   - Claude's response to each material objection,
   - the evidence supporting Claude's response,
   - the exact unresolved disagreements.

   Ask Codex to reconsider only the remaining material disagreements, concede
   points that Claude has adequately answered, defend points that remain
   valid, identify any new evidence that materially changes the conclusion,
   and avoid repeating resolved points.

8. After the second Codex turn, stop. Do not initiate another round.

9. If `--fast` was set, restore `service_tier = "default"`.

## Final response

Return one integrated answer containing:

- the best-supported conclusion,
- the reasoning that survived adversarial review,
- corrections made because of the Codex review,
- any genuinely unresolved disagreement,
- calibrated confidence where uncertainty remains,
- one line naming model, effort, fast mode and number of Codex turns used.

Do not dump the inter-agent transcript unless the user explicitly requests it.

Do not describe the answer as a consensus unless Claude and Codex actually
reached the same conclusion for substantially the same reasons.

## Limits

- Maximum Codex turns: 2
- Maximum wall-clock per Codex turn: 25 minutes, then cancel
- Models: `gpt-6-astra` (default), `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`
- Efforts: `low`, `medium`, `high`, `xhigh` (default)
- Fast mode: off unless `--fast`; always restored afterwards
- Default file mode: read-only
- File edits are permitted only when explicitly required by the underlying task
- Never silently fall back to another model, effort or tier

## CHANGELOG

### 1.2.0 (2026-09-04)

- Switched the default model to GPT-6 Astra (`gpt-6-astra`); reasoning effort
  stays `xhigh`. Without flags, both values are passed explicitly.
- Added `--model astra` and `--model gpt-6-astra`. Sol, Terra and Luna
  remain selectable; their previous short forms still apply.

### 1.1.0 (2026-09-03)

- Codex now runs in the background (`task --background`), with waiting via
  `status --wait` and collecting via `result`. Reason: in the foreground the
  call died after 10 minutes, the job stayed marked "running" in the plugin
  status, and blocked every resume.
- The subagent `codex:codex-rescue` is no longer used. It decides on its own
  between foreground and background and does not return the job id
  reliably. Instead, the plugin script is called directly.
- Pre-flight: hanging jobs are cleaned up with `cancel` before every turn.
- New flags: `--model sol|terra|luna`, `--effort low|medium|high|xhigh`,
  `--fast`. Fast switches `service_tier` in `~/.codex/config.toml` to "fast"
  for the duration of the duel and back afterwards. Checked on 2026-09-03:
  the running app server re-reads the config per thread, no restart needed.
- The handoff now contains a research budget and a fixed answer format.
- Long handoffs go via `--prompt-file` instead of as a shell argument.

### 1.0.0 (2026-09-03)

- Initial version. Built from scratch, not imported. Purpose: have a
  question reviewed against GPT-5.6 Sol, in at most two Codex rounds, and
  build one integrated answer from it instead of a transcript.
- Uses the Codex plugin subagent `codex:codex-rescue`, not the skills
  `codex:rescue` / `codex:codex-rescue`.
- Model and effort are fixed: `gpt-5.6-sol`, `xhigh`. A silent fallback to
  another model is explicitly forbidden.
