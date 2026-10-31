# Runtime

Requires Node.js. Astra and Sol need an authenticated Codex CLI. Opus and
Fable run as native subagents in Claude Code (2.1.304+) and through an
authenticated Claude Code CLI in Codex (2.1.257+ for Fable 5.1). Use one
state file per member in the task workspace, start every member before
waiting for any, and pass the same model, effort and `--no-web` in both
rounds, from the same working directory.

## Astra and Sol, in both harnesses

```text
node "<skill>/scripts/codex-member.mjs" --prompt-file "<work>/handoff.md" --state-file "<work>/sol.json" --model sol --effort xhigh --background
node "<skill>/scripts/codex-member.mjs" status --state-file "<work>/sol.json"
node "<skill>/scripts/codex-member.mjs" --prompt-file "<work>/round2.md" --state-file "<work>/sol.json" --model sol --effort xhigh --resume --background
```

`astra` = `gpt-6-astra`, `sol` = `gpt-6.1-sol`. Poll `status` until every
member has finished or failed; do not end the turn before that. The
completed state carries the answer. Never pass `--write`: the lead makes
authorized edits. Running this inside a Codex session is not yet verified.

## Opus and Fable, in Claude Code

Use the Agent tool in the background with `subagent_type: general-purpose`,
`model: opus` or `fable`, `effort` as requested and the handoff as the
prompt. For later rounds, send the follow-up to the same agent with
`SendMessage`; it keeps its model and history. The alias is requested, not
checked: treat a model-switch notice in the result as a failed member.
Read-only, no delegation and `--no-web` are handoff rules here, not tool
restrictions, and the member loads the project's CLAUDE.md.

## Opus and Fable, in Codex

```text
node "<skill>/scripts/claude-member.mjs" --prompt-file "<work>/handoff.md" --state-file "<work>/opus.json" --model claude-opus-5-5 --effort xhigh > "<work>/opus.round1.out"
node "<skill>/scripts/claude-member.mjs" --prompt-file "<work>/round2.md" --state-file "<work>/opus.json" --model claude-opus-5-5 --effort xhigh --resume > "<work>/opus.round2.out"
```

Fable is `claude-fable-5-1`. The helper blocks until the turn ends and
prints the result as JSON on stdout. Let the host yield a session handle
for each call, wait with its continuation tool, and read the `.out` file
after the process has exited. The member gets only Read, Glob, Grep and,
unless `--no-web`, WebSearch and WebFetch, and runs in safe mode.

## Failures

Both helpers enforce exact-session resume and unchanged settings; rounds
are unlimited. On failure, keep the state and logs, do not resume or
retry, and report that member as failed. Effort is requested, not measured.
The Claude helper checks the model on every assistant message; the Codex
event stream does not attest it. On explicit interruption, use the Codex
helper's `cancel --state-file`.
