---
name: claude-duel
description: Run a bounded adversarial exchange between Codex and Claude Code on one question, using Claude Fable 5.1 with high effort by default, then return one integrated answer.
metadata:
  version: 1.0.1
---

Codex answers first, Claude Code challenges the answer, and Codex integrates
what survives. Use at most two Claude turns. Keep the main Codex model unchanged.

## Arguments

Parse optional flags followed by the question:

| Flag | Values | Default |
| --- | --- | --- |
| `--model` | `fable`, `fable-5.1`, `claude-fable-5-1`, or an explicitly requested full `claude-...` model ID | `claude-fable-5-1` |
| `--effort` | `low`, `medium`, `high`, `xhigh`, `max` | `high` |

Both Fable aliases map to the pinned ID `claude-fable-5-1`, not the moving
Claude CLI alias. An override changes only its own setting. An unsupported
flag or value requires clarification; never silently substitute a model or
effort. There is no `--fast` flag and no global configuration change.
Use the exact question after the flags, or the latest substantive question
if none is supplied. Preserve the surrounding conversation's constraints.

## Workflow

1. Announce the selected Claude model and effort in one line.
2. Analyze the question independently and form Codex's provisional answer
   before consulting Claude.
3. Write a UTF-8 handoff in a unique directory under the workspace's `work/`
   folder. Include the exact question, material facts and constraints,
   relevant source excerpts or file paths, provisional answer, uncertainties,
   and weakly supported claims. Do not include secrets. Only include material
   the user has authorized for this consultation. If evidence must stay
   within the supplied material, pass `--no-web` in both rounds.
4. Instruct Claude to reach its own conclusion before reacting to the
   provisional answer, not to manufacture disagreement, and to return seven
   numbered sections: own conclusion; verified factual errors; overstated or
   unsupported claims; hidden assumptions; omitted alternatives or dependencies;
   strongest opposing position; evidence that would change the conclusion.
   Mark each substantive point `[verified]` or `[judgment call]`, cite evidence
   for verified points, and identify missing evidence explicitly. Limit live
   research to five minutes and ten search/fetch calls, then write the answer.
5. Run round 1 with the helper below. Read the returned result and assess each
   objection against evidence, logic and the user's constraints. Neither accept
   an objection merely because Claude made it nor average the two positions.
6. Stop if no material disagreement remains. Otherwise write a round-2
   handoff with Claude's previous conclusion, Codex's responses and supporting
   evidence, and the exact unresolved disagreements. Ask Claude to reconsider
   only those disagreements, concede answered points, defend remaining ones,
   and avoid repeating resolved points. Use the same state file with `--resume`.
7. After round 2, stop the exchange. Codex owns the final decision, verification
   and any implementation already authorized by the underlying task.

## Runtime

Requires Node.js and an installed, authenticated Claude Code CLI. Fable 5.1
requires Claude Code 2.1.251 or newer. Resolve this skill's `scripts/claude-duel.mjs`
relative to the installed SKILL.md. Run from the task's working directory.

```text
node "<skill-dir>/scripts/claude-duel.mjs" --prompt-file "<work-dir>/round1.md" --state-file "<work-dir>/duel.json" --model claude-fable-5-1 --effort high
node "<skill-dir>/scripts/claude-duel.mjs" --prompt-file "<work-dir>/round2.md" --state-file "<work-dir>/duel.json" --model claude-fable-5-1 --effort high --resume
```

Pass the selected overrides explicitly in both rounds. `--no-web` removes web
tools; otherwise only Read, Glob, Grep, WebSearch and WebFetch are available.
Claude receives no shell, write, connector, skill or delegation tools. Safe
mode disables local customizations and hooks; include relevant task rules in
the handoff. This is a tool restriction, not an operating-system sandbox:
local read tools can access files permitted by Claude Code. The helper writes
its own state and transcript files; Claude Code also persists its session.

The helper passes the prompt over stdin, uses no shell interpolation, pins
model and effort on every turn, checks the model of every assistant message
in Claude's structured event stream plus the requested model's usage, and
resumes the exact saved session ID. It never uses `--continue`, a latest-session
selector, a fallback model or a permission bypass. It refuses a third round,
concurrent use of one state file, setting changes on resume, and resume after
an incomplete or failed run.

Let the host execution tool yield a session ID instead of imposing a short
foreground timeout. Wait with its native continuation tool and give brief
progress updates. The helper enforces a 25-minute deadline per Claude turn
and terminates the child on timeout or interruption. Do not infer a dead
process merely from a quiet log. `--dry-run` shows resolved command arguments
without calling Claude or creating state.

If the helper itself is forcibly killed, its lock can remain. Check the PID
and timestamp recorded in the lock and the native host execution status.
Remove only that exact lock after confirming the process has exited. A state
still marked `running` remains incomplete and must not be resumed; report it
and obtain authorization before starting another model call in a fresh duel.

On authentication failure, unavailable model/effort, permission denial,
timeout, interruption, missing model evidence or model mismatch: stop and
report the exact limitation. Do not retry, replace the reviewer or claim a
completed review. An unreviewed answer may still be returned with that status.
After a failed follow-up, distinguish the completed first review from the
unresolved follow-up. Keep raw `<state-file>.roundN.json` and stderr locally
for diagnosis; do not dump them into the final response.
Raw round files contain newline-delimited JSON events. Other models in the
aggregate usage can belong to Claude Code's internal helper calls; they do
not prove that the reviewer changed models. Missing assistant-model evidence
or any assistant message on another model still fails validation.

## Final response

Return one integrated answer: best-supported conclusion, surviving reasoning,
corrections prompted by Claude, unresolved disagreements, and calibrated
uncertainty. Include a short line naming the model, requested effort and number
of completed Claude turns. The reviewer model is checked from runtime messages; effort
is explicitly requested via CLI, not independently measured. Do not provide
the transcript unless asked, or claim consensus without actual agreement on
the conclusion and its main reasons.

## CHANGELOG

### 1.0.1 (2026-09-05)

- Documented the server-reported minimum Claude Code version for Fable 5.1.
- Check reviewer models on assistant messages in the structured event stream,
  rather than rejecting auxiliary models in aggregate usage. A live run on
  2.1.261 showed Fable review messages alongside a separate Haiku usage entry.
  Event handling follows the official
  [streaming output documentation](https://code.claude.com/docs/en/agent-sdk/streaming-output).
- Live-validated with Claude Code 2.1.261: file reading, Fable 5.1 with High
  requested, two rounds in the same session with retained context, and a
  third-round rejection before any model call. The first result was revalidated
  against its persisted assistant messages after correcting the usage check.

### 1.0.0 (2026-09-05)

- Adapted the `codex-duel` v1.2.0 workflow (see `claude-code/codex-duel` in
  this repo) for Codex as lead and Claude Code as reviewer. Default:
  `claude-fable-5-1`, `high`.
- Replaced the Codex plugin runtime with a read-only Claude CLI helper,
  exact-session resume and bounded turns. Global fast-mode switching omitted.
- Runtime flags checked against local Claude Code 2.1.207 and the official
  [CLI reference](https://code.claude.com/docs/en/cli-reference).
  Model ID checked against the official
  [model configuration guide](https://support.claude.com/en/articles/11940350-claude-code-model-configuration).
