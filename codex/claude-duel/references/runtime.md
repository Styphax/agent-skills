# Claude runtime

Requires Node.js and authenticated Claude Code (Fable 5.1: CLI 2.1.257+).
Resolve `scripts/claude-duel.mjs` relative to this skill. Run from the task
workspace. `fable` and `fable-5.1` map to `claude-fable-5-1`; explicitly
requested full `claude-...` IDs are also accepted.

```text
node "<skill>/scripts/claude-duel.mjs" --prompt-file "<work>/round1.md" --state-file "<work>/duel.json" --model claude-fable-5-1 --effort xhigh
node "<skill>/scripts/claude-duel.mjs" --prompt-file "<work>/round2.md" --state-file "<work>/duel.json" --model claude-fable-5-1 --effort xhigh --resume
```

Pass selected overrides in both calls. `--blind`, `--wide` and `--steer`
control handoff content, not helper arguments. If evidence must stay within
supplied material, pass `--no-web` in both calls. `--dry-run` shows arguments
without a model call or state creation.

Let the host yield a session handle and wait with its continuation tool;
there is no overall deadline. A quiet log is not proof of a dead process.

The helper enforces exact-session resume, unchanged settings, at most two
turns and one active call per state file. It checks assistant-message model
IDs, session ID and successful completion. Effort is requested, not measured.
Only Read/Glob/Grep and, unless disabled, WebSearch/WebFetch are available.
Safe mode disables local customizations and hooks; managed policy still
applies. This is a tool restriction, not OS isolation: local files permitted
by Claude Code remain readable. Put relevant task rules in the handoff.

On failure, retain the state, round JSON and stderr for diagnosis. Do not
resume an incomplete/failed turn. If a forced kill leaves a lock, check its
recorded PID and host execution status; remove that exact lock only after
confirming the process exited. Starting a replacement duel requires new
authorization. Successful first-round evidence remains valid if round 2 fails.
