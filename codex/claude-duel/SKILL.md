---
name: claude-duel
description: Run a bounded adversarial exchange between Codex and Claude Code on one question, using Claude Fable 5.1 with high effort by default, then return one integrated answer. With --wide, both models map the range of defensible answers instead of converging on one; --steer adds one pause for the user to steer round 2.
metadata:
  version: 1.1.1
---

Codex answers first, Claude Code challenges the answer, and Codex integrates
what survives. Use at most two Claude turns. Keep the main Codex model unchanged.
With `--wide`, both models list the defensible answers independently and Codex
merges the lists into a map instead (see "Wide mode").

## Arguments

Parse optional flags followed by the question:

| Flag | Values | Default |
| --- | --- | --- |
| `--model` | `fable`, `fable-5.1`, `claude-fable-5-1`, or an explicitly requested full `claude-...` model ID | `claude-fable-5-1` |
| `--effort` | `low`, `medium`, `high`, `xhigh`, `max` | `high` |
| `--wide` | no value | off |
| `--steer` | no value | off |

Both Fable aliases map to the pinned ID `claude-fable-5-1`, not the moving
Claude CLI alias. An override changes only its own setting. An unsupported
flag or value requires clarification; never silently substitute a model or
effort. There is no `--fast` flag and no global configuration change.
`--wide` switches to wide mode (see below) and combines with any model and
effort. `--steer` pauses wide mode once after the merge so the user can
steer round 2; it requires `--wide`, and `--steer` alone requires
clarification.
Use the exact question after the flags, or the latest substantive question
if none is supplied. Preserve the surrounding conversation's constraints.
Handoffs and the final response use the language of the question unless the
user asks otherwise.

## Workflow

1. Announce the selected Claude model, effort and the active flags in one
   line.
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

## Wide mode (`--wide`)

For open or broad questions where the deliverable is the range of defensible
answers, not one conclusion. Runtime, research budget, model pinning, tool
restriction and error handling apply unchanged. Wide mode always uses both
Claude turns. It replaces workflow steps 2 to 7; step 1 applies as written.

1. Form Codex's own candidate list in the format below before reading any
   Claude output.

2. Write the round-1 handoff: the exact question, material facts and
   constraints, known gaps in the facts, relevant source excerpts or file
   paths, the research budget, and the format below. It contains none of
   Codex's candidates, leanings or candidate-specific doubts. The
   authorization and `--no-web` rules of standard step 3 apply. Instruct
   Claude to map the space of defensible answers, not to pick one.

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

3. Run round 1 with the helper. Merge both lists into one union. Combine
   two entries only if no relevant difference in preconditions, mechanism
   or consequences is lost; otherwise keep them separate. Tag each entry
   `[Codex]`, `[Claude]` or `[both]`; `[both]` means both models proposed
   it independently, not that they weigh it the same. Add Codex's
   assessment per entry: agree, disagree with reason, or evidence missing.

4. With `--steer`: pause here. Show the user the union in compact form, one
   line per entry with origin tag, name and Codex's assessment, and ask for
   steering: entries to deepen, entries to drop, perspectives or
   constraints to add, or "continue". End the turn and wait for the answer;
   do not run round 2 before it. The state file and the saved session stay
   valid across the pause; do not start another duel on the same state
   file meanwhile. Entries the user drops leave the list and are not sent
   to Claude; renumber the rest so gaps do not reveal what was dropped.

5. Write the round-2 handoff: the merged, tagged list with Codex's
   assessments, and the exact entries where Codex's assessment differs
   from Claude's or where Claude gave none. With `--steer`, also the
   user's steering: which entries to deepen, which were dropped by the
   user, what to add. Ask Claude to
   add candidates still missing, undo merges that lost a relevant
   difference, challenge weak entries with reasons, rank the list where
   candidates are comparable and state the criteria, and say where and why
   it weighs differently than Codex. It must not repeat descriptions
   already in the list. Run round 2 with `--resume`.

6. After round 2, stop the exchange. Fold Claude's additions and challenges
   into the union. Codex decides the weight of every entry and does not
   average the two rankings.

### Final response in wide mode

- The union as a map: every surviving candidate with origin tag, when it
  holds or is the best choice, its main weakness, and Codex's assessment.
  Candidates refuted during the exchange appear in one line each with the
  reason, not as options. Entries dropped by the user appear as dropped by
  the user, not as refuted. Claims refuted inside a surviving candidate
  appear under it, one line each.
- The divergences that remain after round 2: where the two models rank or
  weigh differently, with each side's reason. Left open, not averaged. Do
  not keep resolved differences open.
- Codex's own recommendation only if the question asks for one, marked as
  Codex's judgment.
- The assumptions that bound the map. Do not call the map complete.
- One line naming model, requested effort, wide mode, steering and the two
  completed Claude turns. With `--steer`, one line on what the user
  steered.

## Final response

Wide mode uses its own final response, described above. Otherwise return
one integrated answer: best-supported conclusion, surviving reasoning,
corrections prompted by Claude, unresolved disagreements, and calibrated
uncertainty. Include a short line naming the model, requested effort and number
of completed Claude turns. The reviewer model is checked from runtime messages; effort
is explicitly requested via CLI, not independently measured. Do not provide
the transcript unless asked, or claim consensus without actual agreement on
the conclusion and its main reasons.

## CHANGELOG

### 1.1.1 (2026-09-14)

- Text fixes mirrored from codex-duel v1.3.1, which had its first live
  `--wide --steer` run: language follows the question; renumber after user
  drops so gaps reveal nothing; in round 2 also mark entries the reviewer
  did not assess; list refuted claims inside surviving candidates. No live
  run of claude-duel with `--wide` yet.

### 1.1.0 (2026-09-14)

- Added `--wide` for open or broad questions. Round 1 is blind: the handoff
  carries the question, facts, gaps and constraints but none of Codex's
  candidates. Both models list the defensible answers independently
  (options, explanations or perspectives), Codex merges the lists with
  origin tags, round 2 adds, checks merges, challenges weak entries and
  ranks where candidates are comparable. The final response is a map of
  surviving candidates with the remaining weighting differences, not a
  single conclusion. Always two Claude turns; runtime, pinning and tool
  restriction unchanged. Mirrors codex-duel v1.3.0.
- Reason: the standard mode is built to test and condense one answer. It
  asks for omitted alternatives but does not secure a systematic survey of
  several answers: the reviewer sees the provisional answer, the exchange
  stops on agreement after round 1, and the final response demands a
  conclusion.
- Added `--steer`, only with `--wide`: one pause after the merge in which
  the user steers round 2 (deepen, drop, add). Idea from Lenny's
  Newsletter, "How to turn your AI into a world-class designer": feeding AI
  ideas back into the AI unfiltered yields results anyone gets; the human
  step between iterations makes the difference. The helper's state file
  and exact-session resume make the pause safe.
- Draft reviewed via codex-duel (GPT-6 Astra, xhigh, one round); candidate
  format, merge rule and handling of rejected candidates taken from that
  review. No live run with `--wide` or `--steer`.

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
