# Codex runtime

Requires Node.js and authenticated Codex CLI. Use this skill's helper,
`scripts/codex-duel.mjs`, from the task workspace. It calls `codex exec`
directly, without changing the companion plugin or global configuration.

Models: `astra` = `gpt-6-astra`, `sol` = `gpt-6.1-sol`, `luna` = `gpt-6-luna`,
`terra` = `gpt-5.6-terra`. Full IDs also accepted: these four plus `gpt-6-sol`,
`gpt-5.6-sol`, `gpt-5.6-luna`. Default: Astra, `xhigh`.

```text
node "<skill>/scripts/codex-duel.mjs" --prompt-file "<work>/round1.md" --state-file "<work>/duel.json" --model astra --effort xhigh --background
node "<skill>/scripts/codex-duel.mjs" status --state-file "<work>/duel.json"
node "<skill>/scripts/codex-duel.mjs" --prompt-file "<work>/round2.md" --state-file "<work>/duel.json" --model astra --effort xhigh --resume --background
```

Always start turns with `--background` in Claude Code so a foreground tool
timeout cannot kill a long review. Poll `status` at reasonable intervals;
completed status includes the answer. No overall deadline. On explicit
interruption use `cancel --state-file "<work>/duel.json"` for this duel only.

Pass the same model, effort and runtime flags in both rounds:
- `--fast`: set `service_tier="fast"` for each invocation only. Without it,
  request `default` for this duel. Saved settings are never modified, so no
  restoration is needed after completion, error or a steering pause.
- `--write`: permit workspace edits only when explicitly authorized by the
  underlying task. Otherwise the reviewer runs read-only.
- `--no-web`: disable web search when evidence must stay within supplied
  material; include that constraint in the handoff too.
- `--dry-run`: inspect the resolved command without running a model.

`--blind`, `--wide` and `--steer` affect handoffs, not helper arguments.
The helper persists the exact thread ID and supplies it to `exec resume`;
it never uses a latest-session selector. It enforces unchanged settings,
two turns maximum and one active worker per state file. Model and effort
are explicitly requested; the exec event stream does not independently
attest the serving model or effort. Do not claim otherwise.

Inspect the state and round logs on failure. Do not resume incomplete or
failed runs or automatically retry. A quiet log is not proof of death.
For a stranded `running` state, check its recorded worker PID and host
status; remove only its lock after confirming exit. Leave the failed or
incomplete state as evidence; a fresh duel requires new authorization.
The local read-only policy does not constrain external connector writes;
the handoff must preserve the task's permissions and prohibit delegation.
