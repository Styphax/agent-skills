---
name: codex-duel
description: Run a bounded adversarial exchange between Claude and Codex on one question, defaulting to GPT-6 Astra with xhigh reasoning effort; GPT-5.6 Sol, Terra and Luna and Codex fast mode are optional. With --wide, both models map the range of defensible answers instead of converging on one; --steer adds one pause for the user to steer round 2.
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(ls:*)
metadata:
  version: 1.3.1
---

Run a bounded Claude-Codex review: Claude answers first, Codex attacks the
answer, Claude integrates what survives. At most two Codex turns. With
`--wide`, both models list the defensible answers independently and Claude
merges the lists into a map instead (see "Wide mode").

## Arguments

`$ARGUMENTS` is parsed as optional flags followed by the question.

| Flag | Values | Default |
| --- | --- | --- |
| `--model` | `astra`, `sol`, `terra`, `luna` or the full ids `gpt-6-astra`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` | `astra` |
| `--effort` | `low`, `medium`, `high`, `xhigh` | `xhigh` |
| `--fast` | no value | off |
| `--wide` | no value | off |
| `--steer` | no value | off |

- `astra` maps to `gpt-6-astra`; `sol`, `terra` and `luna` map to
  `gpt-5.6-<name>`. Pass the full model id to the runtime script.
- With no model or effort flags, pass `--model gpt-6-astra --effort xhigh`.
  An explicit override changes only its own setting.
- `--wide` switches to wide mode (see below). It combines with any model,
  effort and fast setting.
- `--steer` pauses wide mode once after the merge so the user can steer
  round 2. It requires `--wide`; `--steer` alone: stop and ask the user.
- Any other model or effort value: stop and ask the user. Never substitute
  another model or effort, never downgrade silently.
- The text after the flags is the exact question. If it is empty, use the
  latest substantive user question in this conversation.
- Preserve all material constraints from the surrounding conversation.
- Handoffs and the final response use the language of the question unless
  the user asks otherwise.

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

A foreground wait also works when `--timeout-ms` stays under the Bash
limit (540000); `status --wait` only polls, so repeat it until the status is
`completed`. Interactive sessions only: in a `claude -p` run the session
ends with the turn, and the plugin's SessionEnd hook then kills this
session's Codex jobs and drops their records.

When it returns with status `completed`:

```
node "$SCRIPT" result <job-id>
```

That output is Codex's answer. If the status is still `running` after the
wait (25 minutes), cancel the job, report the timeout to the user and finish
with Claude's own analysis marked as not adversarially reviewed.

## Workflow

1. Parse the flags and the question. Confirm model, effort and the active
   flags in one line to the user before starting.

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

## Wide mode (`--wide`)

For open or broad questions where the deliverable is the range of defensible
answers, not one conclusion. Runtime, pre-flight, background execution,
research budget, model pinning and the read-only default apply unchanged.
Wide mode always uses both Codex turns. It replaces workflow steps 2 to 8;
steps 1 and 9 apply as written.

1. Form Claude's own candidate list in the format below before reading any
   Codex output.

2. Round-1 handoff: the exact question, all material facts and constraints,
   known gaps in the facts, relevant files or paths, the research budget,
   and the format below. It contains none of Claude's candidates, leanings
   or candidate-specific doubts. Instruct Codex to map the space of
   defensible answers, not to pick one, and not to edit files unless the
   underlying user request explicitly asks for it.

   Candidate-list format, used by both models:

   - As many genuinely distinct, relevant candidates as the question
     supports. Do not pad. Depending on the question, candidates are
     options, explanations or perspectives; unconventional ones are
     welcome and marked as such.
   - Per candidate: a short description, its main support, the conditions
     under which it holds or is the best choice, and its main weakness.
     Mark each factual claim `[verified]` with evidence or
     `[judgment call]`.
   - Closing: assumptions that would change the list, and evidence that
     would rule candidates in or out.

3. If `--fast` is set, enable fast mode. Run the pre-flight. Start round 1,
   wait, collect. Merge both lists into one union. Combine two entries only
   if no relevant difference in preconditions, mechanism or consequences is
   lost; otherwise keep them separate. Tag each entry `[Claude]`, `[Codex]`
   or `[both]`; `[both]` means both models proposed it independently, not
   that they weigh it the same. Add Claude's assessment per entry: agree,
   disagree with reason, or evidence missing.

4. With `--steer`: pause here. If `--fast` is set, restore
   `service_tier = "default"` first, so the pause has no global side
   effect. Show the user the union in compact form, one line per entry
   with origin tag, name and Claude's assessment, and ask for steering:
   entries to deepen, entries to drop, perspectives or constraints to add,
   or "continue". End the turn and wait for the answer; do not start round
   2 before it. Keep the round-1 job id and Codex session ID. Entries the
   user drops leave the list and are not sent to Codex; renumber the rest so
   gaps do not reveal what was dropped. If `--fast` is set, enable fast mode
   again before round 2.

5. Round-2 handoff with `--resume-last`: the merged, tagged list with
   Claude's assessments, and the exact entries where Claude's assessment
   differs from Codex's or where Codex gave none. With `--steer`, also the
   user's steering: which entries to deepen, which were dropped by the
   user, what to add. Ask
   Codex to add candidates still missing, undo merges that lost a relevant
   difference, challenge weak entries with reasons, rank the list where
   candidates are comparable and state the criteria, and say where and why
   it weighs differently than Claude. It must not repeat descriptions
   already in the list. After starting, check the status output: the
   "Codex session ID" must be the one from round 1. `--resume-last` picks
   the newest tracked thread in this repository, and after a pause that can
   be another job. On mismatch, cancel the job, do not retry, and report.

6. Start round 2, wait, collect, stop. Fold Codex's additions and challenges
   into the union. Claude decides the weight of every entry and does not
   average the two rankings.

### Final response in wide mode

- The union as a map: every surviving candidate with origin tag, when it
  holds or is the best choice, its main weakness, and Claude's assessment.
  Candidates refuted during the exchange appear in one line each with the
  reason, not as options. Entries dropped by the user appear as dropped by
  the user, not as refuted. Claims refuted inside a surviving candidate
  appear under it, one line each.
- The divergences that remain after round 2: where the two models rank or
  weigh differently, with each side's reason. Left open, not averaged. Do
  not keep resolved differences open.
- Claude's own recommendation only if the question asks for one, marked as
  Claude's judgment.
- The assumptions that bound the map. Do not call the map complete.
- One line naming model, effort, fast mode, wide mode, steering and the two
  Codex turns. With `--steer`, one line on what the user steered.

## Final response

Wide mode uses its own final response, described above. Otherwise return
one integrated answer containing:

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
- Wide mode: off unless `--wide`; always two Codex turns; round-1 handoff
  without Claude's candidates
- Steering: off unless `--steer`; only with `--wide`; exactly one pause,
  after the merge; round 2 must resume the round-1 session

## CHANGELOG

### 1.3.1 (2026-09-14)

- First live run with `--wide --steer` (GPT-6 Astra, xhigh, Claude Opus 5
  as lead): round 1 6:40 min, round 2 9:03 min, 16 + 19 blind candidates,
  union of 25, 21 after steering. All three steering paths and the resume
  of the round-1 session worked.
- Six text fixes from that run: language follows the question; renumber
  after user drops so gaps reveal nothing; in round 2 also mark entries
  without a Codex assessment; list refuted claims inside surviving
  candidates; foreground waiting with a short timeout allowed; interactive
  sessions only, because the plugin's SessionEnd hook kills the Codex jobs
  under `claude -p`.

### 1.3.0 (2026-09-14)

- New `--wide` mode for open or broad questions. Round 1 is blind: the
  handoff carries the question, facts, gaps and constraints but none of
  Claude's candidates. Both models list the defensible answers
  independently (options, explanations or perspectives), Claude merges the
  lists with origin tags, round 2 adds, checks merges, challenges weak
  entries and ranks where candidates are comparable. The final response is
  a map of surviving candidates with the remaining weighting differences,
  not a single conclusion. Always two Codex turns; runtime, pinning and
  read-only unchanged.
- Reason: the standard mode is built to test and condense one answer. It
  asks for omitted alternatives but does not secure a systematic survey of
  several answers: the reviewer sees the provisional answer, the exchange
  stops on agreement after round 1, and the final response demands a
  conclusion.
- New `--steer` flag, only with `--wide`: one pause after the merge in
  which the user steers round 2 (deepen, drop, add). Idea from Lenny's
  Newsletter, "How to turn your AI into a world-class designer": feeding AI
  ideas back into the AI unfiltered yields results anyone gets; the human
  step between iterations makes the difference. Because the plugin only
  offers `--resume-last`, round 2 must confirm the round-1 session ID after
  the pause. With `--fast`, the tier is reset for the pause.
- Draft reviewed via codex-duel (GPT-6 Astra, xhigh, one round); candidate
  format, merge rule and handling of rejected candidates taken from that
  review.

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
