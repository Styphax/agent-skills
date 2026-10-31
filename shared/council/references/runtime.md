# Runtime

Requires Node.js. Astra and Sol need an authenticated Codex CLI; Opus and
Fable in Codex need an authenticated Claude Code CLI (2.1.257+ for Fable
5.1). The helpers are unchanged copies of the duel helpers. Use one state
file per member in the task workspace, start every member before waiting
for any, and pass the same model, effort and `--no-web` in both rounds.

## Astra and Sol, in both harnesses

```text
node "<skill>/scripts/codex-duel.mjs" --prompt-file "<work>/handoff.md" --state-file "<work>/sol.json" --model sol --effort xhigh --background
node "<skill>/scripts/codex-duel.mjs" status --state-file "<work>/sol.json"
node "<skill>/scripts/codex-duel.mjs" --prompt-file "<work>/round2.md" --state-file "<work>/sol.json" --model sol --effort xhigh --resume --background
```

`astra` = `gpt-6-astra`, `sol` = `gpt-6.1-sol`. Poll `status` at reasonable
intervals; the completed state carries the answer. Never pass `--write`:
the lead makes authorized edits.

## Opus and Fable, in Claude Code

Use the Agent tool with `subagent_type: general-purpose`, `model: opus` or
`fable`, `effort` as requested, `run_in_background: true` and the handoff
as the prompt. For round 2, send the follow-up to the same agent with
`SendMessage`; it keeps its model and history. Read-only is a handoff rule
here, not a tool restriction.

## Opus and Fable, in Codex

```text
node "<skill>/scripts/claude-duel.mjs" --prompt-file "<work>/handoff.md" --state-file "<work>/opus.json" --model claude-opus-5-5 --effort xhigh > "<work>/opus.round1.out"
node "<skill>/scripts/claude-duel.mjs" --prompt-file "<work>/round2.md" --state-file "<work>/opus.json" --model claude-opus-5-5 --effort xhigh --resume > "<work>/opus.round2.out"
```

Fable is `claude-fable-5-1`. The helper blocks until the turn ends and
prints the result as JSON on stdout, so start each call as a background
command of the host and read the `.out` file once the state file shows
`completed`. The member gets only Read, Glob, Grep and, unless `--no-web`,
WebSearch and WebFetch.

## Failures

Both helpers enforce exact-session resume, unchanged settings and two turns
per state file. On failure, keep the state and logs, do not resume or
retry, and report that member as failed. Model and effort are requested;
the Codex event stream does not attest them, the Claude helper checks the
model on every assistant message.
