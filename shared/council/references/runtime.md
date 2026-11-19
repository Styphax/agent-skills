# Runtime

Requires Node.js. Astra and Sol need an authenticated Codex CLI. Fable 5.2
runs through an authenticated Claude Code CLI in every harness (tested with
2.1.318) and is requested by its full ID, because the `fable` alias depends
on the Claude Code version: 2.1.318 selects Fable 5.1, 2.1.321 and newer
select Fable 5.2 (checked 2026-11-10). Opus
and Sonnet run as native subagents in Claude Code (2.1.304+) and through the
Claude Code CLI in Codex and Antigravity. Pro runs through the Oracle CLI in
every harness. Gemini members need the Antigravity CLI (`agy`, tested with
1.5.12) signed in once interactively under the default `~/.gemini` home.
Use one
state file per member in the task workspace, start every member before
waiting for any, and pass the same model and effort in every round, from
the same working directory. Web access stays on: add `--no-web` only when
the user set it as described in SKILL.md, and then in every round.

## Codex sandbox

In Codex, run every command that starts or resumes a member
(`codex-member.mjs`, `claude-member.mjs`, `gemini-member.mjs` and Oracle),
and the Gemini `--dry-run` check, which needs network for `agy models`, with
`sandbox_permissions: "require_escalated"` and a one-line `justification`
that names the council request. The `workspace-write` sandbox sends network
traffic to a dead proxy and blocks writes outside the workspace, and the
helpers need both: Claude Code writes its session to `~/.claude`, Codex to
`~/.codex/sessions`, `agy` to `~/.gemini/antigravity-cli`, Oracle to
`~/.oracle`, and Oracle starts Chrome.
Inside the sandbox the Claude account check still passes, but the model
call fails after about three minutes of retries (`ENOTFOUND`, seen on
2026-11-16), and a later resume finds no session. Depending on
`approvals_reviewer`, the user or Codex's automatic reviewer decides the
request. If it is denied, report the member as failed and do not run it
inside the sandbox. Turning on network access for the whole sandbox is no
substitute, because it does not allow those writes.

## Picker

Claude Code: AskUserQuestion with four questions. "OpenAI" is a
multi-select of Astra, Sol and Pro, "Anthropic" a multi-select of Opus,
Fable and Sonnet, "Google" a multi-select of Neon, Argon, Hydrogen and
Carbon (its description says the account may not offer Carbon); mark each
default "(Recommended)". "Effort" offers xhigh
(Recommended), max, high and medium.

Codex: request_user_input allows at most three questions (Codex 0.170.0),
so Google shares a question with Anthropic. Three single-choice questions,
each with a free-form answer added by the client. "OpenAI": "Astra, Sol and
Pro (Recommended)", "Astra and Sol", "None". "Anthropic and Google": "Opus,
Fable and Neon (Recommended)", "Opus, Fable, Sonnet and Neon", "None".
"Effort": "xhigh (Recommended)", "max", "high".

Antigravity: ask_question with the questions of the Claude Code picker.
Whether it takes several or multi-select questions is not verified; if it
takes one single-choice question per call, ask the three Codex questions
one after another.

In every harness, each question's text names all its choices, including
those without a button: the provider's members, all five effort levels,
the Gemini limits (Neon and Hydrogen up to xhigh, Argon and Carbon up to
high), `member=LEVEL` pairs, and that any other combination can be typed.

## Astra and Sol, in every harness

```text
node "<skill>/scripts/codex-member.mjs" --prompt-file "<work>/handoff.md" --state-file "<work>/sol.json" --model sol --effort xhigh --background
node "<skill>/scripts/codex-member.mjs" status --state-file "<work>/sol.json"
node "<skill>/scripts/codex-member.mjs" --prompt-file "<work>/round2.md" --state-file "<work>/sol.json" --model sol --effort xhigh --resume --background
```

`astra` = `gpt-6.2-astra`, `sol` = `gpt-6.2-sol`. Poll `status` until every
member has finished or failed; do not end the turn before that. The
completed state carries the answer. In Antigravity, leave out
`--background` and redirect the output, so the command blocks and prints
the final state with the answer:

```text
node "<skill>/scripts/codex-member.mjs" --prompt-file "<work>/handoff.md" --state-file "<work>/sol.json" --model sol --effort xhigh > "<work>/sol.round1.out"
```

Never pass `--write`: the lead makes authorized edits. Running this inside a Codex session is not yet verified.

## Opus and Sonnet, in Claude Code

Use native subagents only when the parent session uses the user's Claude
account login. If that cannot be confirmed, use the CLI helper below,
which verifies account authentication before submitting the request.

Use the Agent tool in the background with `subagent_type: general-purpose`,
`model: opus` or `sonnet`, `effort` as requested and the handoff as the
prompt. Use `model: fable` in the Agent tool only when the session runs
Claude Code 2.1.321 or newer: older versions map the alias to Fable 5.1.
The desktop app bundles its own version, so `claude --version` shows only
the CLI on PATH.
For later rounds, send the follow-up to the same agent with `SendMessage`;
it keeps its model and history. The alias is requested, not checked: treat
a model-switch notice in the result as a failed member. Read-only and no
delegation, and `--no-web` when set, are handoff rules here, not tool
restrictions,
and the member loads the project's CLAUDE.md.

## Fable in every harness, Opus and Sonnet in Codex and Antigravity

```text
node "<skill>/scripts/claude-member.mjs" --prompt-file "<work>/handoff.md" --state-file "<work>/fable.json" --model claude-fable-5-2 --effort xhigh > "<work>/fable.round1.out"
node "<skill>/scripts/claude-member.mjs" --prompt-file "<work>/round2.md" --state-file "<work>/fable.json" --model claude-fable-5-2 --effort xhigh --resume > "<work>/fable.round2.out"
```

Opus is `claude-opus-5-5`, Sonnet `claude-sonnet-5-5`. The helper blocks
until the turn ends and prints the result as JSON on stdout. In Claude Code,
run it with the Bash tool in the background and read the `.out` file when
the completion notice arrives. In Codex, let the host yield a session handle
for each call, wait with its continuation tool, and read the `.out` file
after the process has exited. In Antigravity, see the lead section below.
The member gets only
Read, Glob, Grep and, unless `--no-web`, WebSearch and WebFetch, and runs in
safe mode. Claude members use the user's Claude account login, never API-key
billing or a cloud provider. The helper removes inherited API credentials,
custom endpoints/headers and provider-selection flags from a child-only
environment. It checks `claude auth status --json` in that same environment
and requires `loggedIn: true`, `authMethod: claude.ai` and
`apiProvider: firstParty` before sending the prompt. A missing account login
stops the run; there is no API fallback. Stored credentials and the parent
environment remain unchanged. The state file records only the verified auth
method/provider, never credentials. Dry runs do not verify authentication.

## Gemini members, in every harness

```text
node "<skill>/scripts/gemini-member.mjs" --prompt-file "<work>/handoff.md" --state-file "<work>/neon.json" --model neon --effort xhigh > "<work>/neon.round1.out"
node "<skill>/scripts/gemini-member.mjs" --prompt-file "<work>/round2.md" --state-file "<work>/neon.json" --model neon --effort xhigh --resume > "<work>/neon.round2.out"
```

`neon`, `argon`, `hydrogen` and `carbon` select `gemini-4-<name>`. Neon
and Hydrogen accept `low` to `xhigh`, Argon and Carbon `low` to `high`; the
helper refuses any other level, and the lead asks the user instead of
choosing one. Before Round 1, run each Gemini member's command once with
`--dry-run`: it sends no prompt but fails when the account does not offer
the model at that effort (Carbon was not offered on 2026-11-19). Run and
read it like the Claude helper. It finds `agy` on PATH
or through T3 Code's `~/.t3/tools/antigravity-acp/<platform>/active.json`,
removes `GEMINI_HOME`, `ANTIGRAVITY_*` and Google API keys from the child
environment, and checks with `agy models` that the account offers the model
at that effort before sending the prompt. The prompt goes to `agy` on stdin
as one `stream-json` message, and each round runs as its own process that
resumes the saved conversation with `--conversation`.

The helper starts `agy` with `--add-dir "<skill>/gemini"` and one of two
agent definitions from `gemini/.agents/agents/`: `council-member-web`
(read files, web search) or, with `--no-web`, `council-member` (read files).
In tests the member saw only `read_file`, `manage_task` (agy adds it to
every agent; it manages background tasks) and, with web, `search_web`.
`init.tools` in the raw log is agy's whole catalogue, not the member's tool
set, so the helper checks the tools actually called and rejects the answer
when any other tool ran, `manage_task` included. A `--settings` file next to the state file adds
deny rules for writes, commands, browser page opening, downloads and MCP as
a second layer, and allows reading files anywhere. The member cannot list
or search folders, so the handoff names every file by absolute path. Web
search returns a summary with redirect links and cannot open a page, so
weigh such claims as search summaries. When the output lists
`deniedActions`, report them as an evidence gap for that member. The
member probably loads `~/.gemini/GEMINI.md` the way a Claude member loads
CLAUDE.md. Pass the same flags in every round: the agent and the settings
are not stored in the conversation.

## Antigravity as lead

A Gemini session in Antigravity can lead when `council` is listed in
`~/.gemini/config/skills.json`; T3 Code's Antigravity home inherits that
file. Tested on 2026-11-19 with Neon leading inside T3 Code; Carbon was not
offered on that account. The lead uses the helpers: `codex-member.mjs` for
Astra and Sol, `claude-member.mjs` for Opus, Fable and Sonnet,
`gemini-member.mjs` for Gemini members and Oracle for Pro. Never use a
subagent, swarm or workflow tool (such as `invoke_subagent`,
`define_subagent`, `manage_subagents`, `browser_subagent` or
`run_workflow`) for a member, and never call `agy` directly.

Start every member command with `run_command`, all of them before waiting
for any. Each helper command must block until its member ends, so run
`codex-member.mjs` without `--background`: in a test the detached worker
was gone without output once its starting command had exited. Antigravity
moves the long commands to background tasks.

Then stay in the turn until every member has ended. In T3 Code a turn
that ends while members run is not woken again, neither by the end of a
background task nor by a `schedule` timer (both seen on 2026-11-19). So
never reply without a tool call and never use `schedule` while a member
runs. Wait in a loop instead: run
`node -e "setTimeout(() => {}, 5000)"` with `run_command` and
`WaitMsBeforeAsync` set to 10000 (its maximum; a longer command moves to
the background, and starting the shell and Node takes 2 to 5 seconds), and
in the same step check with `manage_task` which member commands have
ended; repeat. Completion notices for the member tasks also arrive during
these calls. On 2026-11-19 this loop kept the turn open until all members
had answered, including Pro after almost 4 minutes (13 waits). A Pro round
of 60 minutes needs about 200 such steps, which costs Antigravity quota. When a command ends, read its output: the `.out` file
for the Codex, Claude and Gemini helpers, the `--write-output` file for
Pro. A Gemini lead may also
have Neon as a member, which runs in its own `agy` conversation. Lead and
Gemini members draw on the same Antigravity quota. Inside T3 Code the
helpers had network access and could write to `~/.claude` and
`~/.gemini`. Outside T3 Code, `~/.gemini/config/config.json` turns on
Antigravity's terminal sandbox, which may block both; this is not tested.

## Pro, in every harness

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
the output file when the completion notice arrives. In Codex and
Antigravity, start it like the Claude helper and read the `--write-output`
file after exit. Pro needs a local
session, because Oracle opens Chrome with the user's ChatGPT sign-in. Each
later round follows up on the previous round's slug, which reopens the same
ChatGPT conversation. Never re-run a command. If it exits early or with an
error, read `browser.runtime.promptSubmitted` in
`~/.oracle/sessions/<slug>/meta.json`. When it is true, the prompt reached
ChatGPT and Pro may still answer: collect the answer with the same `npx`
prefix and `session <slug> --live --write-output "<work>/pro.roundN.md"`,
and count Pro as failed only if that returns no answer. `--no-web`, when
set, is a handoff rule here.

## Failures

All helpers enforce exact-session resume and unchanged settings; rounds
are unlimited. On failure, keep the state and logs, do not resume or
retry, and report that member as failed. An Oracle error after the prompt
was submitted is not yet a failure; follow the Pro section first. Effort is
requested, not measured.
The Claude helper checks the model on every assistant message; the Codex
event stream does not attest it; `agy` only repeats the requested model and
agent, which the Gemini helper checks; Oracle checks the ChatGPT picker,
not the server-side model. A Gemini turn that ends with an empty answer
counts as failed, with any denied actions named in the error. On explicit
interruption, use the Codex helper's `cancel --state-file`.
