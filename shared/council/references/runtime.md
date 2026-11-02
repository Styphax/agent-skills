# Runtime

Requires Node.js. Astra and Sol need an authenticated Codex CLI. Opus and
Fable run as native subagents in Claude Code (2.1.304+) and through an
authenticated Claude Code CLI in Codex (2.1.257+ for Fable 5.1); Sonnet uses
the same paths. Pro runs through the Oracle CLI in both harnesses. Use one
state file per member in the task workspace, start every member before
waiting for any, and pass the same model, effort and `--no-web` in both
rounds, from the same working directory.

## Picker

Claude Code: AskUserQuestion with three questions. "OpenAI" is a
multi-select of Astra, Sol and Pro, "Anthropic" a multi-select of Opus,
Fable and Sonnet; mark each default "(Recommended)". "Effort" offers xhigh
(Recommended), max, high and medium.

Codex: request_user_input with three single-choice questions, each with a
free-form answer added by the client. "OpenAI": "Astra, Sol and Pro
(Recommended)", "Astra and Sol", "None". "Anthropic": "Opus and Fable
(Recommended)", "Opus, Fable and Sonnet", "None". "Effort": "xhigh
(Recommended)", "max", "high".

In both, each question's text names all its choices, including those
without a button: the provider's members, all five effort levels and
`member=LEVEL` pairs, and that any other combination can be typed.

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

## Opus, Fable and Sonnet, in Claude Code

Use the Agent tool in the background with `subagent_type: general-purpose`,
`model: opus`, `fable` or `sonnet`, `effort` as requested and the handoff as
the prompt. For later rounds, send the follow-up to the same agent with
`SendMessage`; it keeps its model and history. The alias is requested, not
checked: treat a model-switch notice in the result as a failed member.
Read-only, no delegation and `--no-web` are handoff rules here, not tool
restrictions, and the member loads the project's CLAUDE.md.

## Opus, Fable and Sonnet, in Codex

```text
node "<skill>/scripts/claude-member.mjs" --prompt-file "<work>/handoff.md" --state-file "<work>/opus.json" --model claude-opus-5-5 --effort xhigh > "<work>/opus.round1.out"
node "<skill>/scripts/claude-member.mjs" --prompt-file "<work>/round2.md" --state-file "<work>/opus.json" --model claude-opus-5-5 --effort xhigh --resume > "<work>/opus.round2.out"
```

Fable is `claude-fable-5-1`, Sonnet `claude-sonnet-5-5`. The helper blocks
until the turn ends and prints the result as JSON on stdout. Let the host
yield a session handle for each call, wait with its continuation tool, and
read the `.out` file after the process has exited. The member gets only
Read, Glob, Grep and, unless `--no-web`, WebSearch and WebFetch, and runs in
safe mode.

## Pro, in both harnesses

Pro is ChatGPT's Pro tier on the user's signed-in account, driven by the
Oracle CLI in browser mode. `npx` runs Oracle's latest release on every
call, so no separate install or update is needed; it requires Node.js 24+
and Chrome. On the first run, sign in to chatgpt.com in the Chrome window
Oracle opens; the profile is kept. Pro sees only attached files, so attach
the handoff and every file it names, and nothing else from `work/`. Send
them as one zip attachment: with several attachments, Oracle's check of the
sent message can fail although ChatGPT received every file. The prompt asks
Pro to list the files it can read; compare that list with the files sent
and report a missing one as an evidence gap.

```text
npx -y @steipete/oracle@latest --engine browser --browser-manual-login --model gpt-6-pro --browser-bundle-files --browser-bundle-format zip --slug "<council>-pro-r1" --wait --write-output "<work>/pro.round1.md" -p "Answer the attached council handoff. Begin by listing every attached file you can read." --file "<work>/handoff.md" --file "<material>"
npx -y @steipete/oracle@latest --followup "<council>-pro-r1" --browser-bundle-files --browser-bundle-format zip --slug "<council>-pro-r2" --wait --write-output "<work>/pro.round2.md" -p "Answer the attached council follow-up. Begin by listing every attached file you can read." --file "<work>/round2.md" --file "<revised files>"
```

`gpt-6-pro` selects GPT-6 Astra at the Pro tier, and Oracle aborts when it
cannot confirm Pro. A round takes 10 to 60 minutes. In Claude Code, run each
command with the Bash tool in the background at its longest timeout and read
the output file when the completion notice arrives. In Codex, start it like
the Claude helper and read the output file after exit. Pro needs a local
session, because Oracle opens Chrome with the user's ChatGPT sign-in. Each
later round follows up on the previous round's slug, which reopens the same
ChatGPT conversation. Never re-run a command. If it exits early or with an
error, read `browser.runtime.promptSubmitted` in
`~/.oracle/sessions/<slug>/meta.json`. When it is true, the prompt reached
ChatGPT and Pro may still answer: collect the answer with the same `npx`
prefix and `session <slug> --live --write-output "<work>/pro.roundN.md"`,
and count Pro as failed only if that returns no answer. `--no-web` is a
handoff rule here.

## Failures

Both helpers enforce exact-session resume and unchanged settings; rounds
are unlimited. On failure, keep the state and logs, do not resume or
retry, and report that member as failed. An Oracle error after the prompt
was submitted is not yet a failure; follow the Pro section first. Effort is
requested, not measured.
The Claude helper checks the model on every assistant message; the Codex
event stream does not attest it; Oracle checks the ChatGPT picker, not the
server-side model. On explicit interruption, use the Codex
helper's `cancel --state-file`.
