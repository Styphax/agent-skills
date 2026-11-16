---
name: council
description: Put a question, decision, plan or review to a council of GPT-6 Astra, GPT-6.1 Sol, ChatGPT Pro, Claude Opus 5.5, Claude Fable 5.2 and optionally Claude Sonnet 5.5, only when the user explicitly asks for the council. Inspecting or editing the skill does not convene it.
allowed-tools: Bash(node:*), Bash(npx -y @steipete/oracle@latest:*)
metadata:
  version: 1.6.1
  source: https://github.com/t3dotgg/tstack/blob/main/skills/council/SKILL.md
---

The lead puts the user's request to every member independently and in
parallel, then judges from evidence. The lead is not a member. Do not
average positions, manufacture disagreement or require consensus. Keep
scope fixed: findings beyond the request are reported, not implemented.

Claude members always use the user's Claude account login. Do not use an API
key or a cloud-provider route. The CLI helper removes inherited API auth
overrides for its child process and verifies `claude.ai` login before sending
the prompt. Keep stored keys and the parent environment unchanged.

Flags before the request: `--members LIST` (subset of
`astra,sol,pro,opus,fable,sonnet`), `--effort LEVEL` (`low`, `medium`,
`high`, `xhigh`, `max`; one level for all or `member=LEVEL` pairs; Pro
always runs at ChatGPT's Pro tier), `--target-score N` (reviews only: N
from 0 to 10 with a decimal comma or point, default 8.5; further rounds
continue while a member's latest score is below it, within the stop rules
under Further rounds; a bare number before the request, as in
`/council 9 <request>`, sets it too; ask when the number could belong to
the request, and say so when it is set for a request that is not a
review), `--no-web` (supplied
material only; state it in the handoff). If members or effort are not
given, ask first with the picker in [runtime](references/runtime.md), as
an optional question whose text names every member and effort level.
Defaults: Astra, Sol, Pro, Opus and Fable at `xhigh`; Sonnet only when
chosen. If no question tool is listed, ask in one plain-text line naming
all options and the defaults. If the tool returns no answer, use the
defaults and say so. Without a request, use the latest substantive one.
Preserve the conversation's constraints and language. Unknown options or
members require clarification; never silently substitute settings.

Web access is on by default. Use `--no-web` only when the user wrote the
flag or asked in words for no web access in this call, or said yes to a
direct question about it for this council. If the lead thinks supplied
material only would fit, it asks the user before Round 1, in a question of
its own that gives the reason, and treats no answer as no. Never infer it
from the topic, the material or an earlier council. Once Round 1 has
started, web access stays as it is for the whole council: the helpers
refuse a change on resume.

## Round 1

1. If the request concerns existing work and edits are authorized, finish
   known fixes first, except on work being replaced, and run the relevant
   checks, so members judge the current state. Announce members, effort,
   flags and, for a review, the target score.
2. Form the lead's own view before reading any member.
3. Write one UTF-8 handoff under a unique workspace `work/` directory: the
   exact request without any target score, facts, constraints, relevant
   sources and evidence gaps;
   only authorized material, never secrets, nothing that reveals the lead's
   view or the target score. Ask for an answer, its support separating
   verified facts from judgment, assumptions, alternatives, the strongest
   counterargument and the evidence that would change it. For a review,
   also ask for findings by severity and a score out of 10, half points
   allowed. Members stay read-only, may not delegate and must not read
   `work/` beyond the handoff. Impose no research, time or token budget
   unless the user asks.
4. Launch every member with the same handoff as described in
   [runtime](references/runtime.md) and wait for all. If a member fails,
   report it and never substitute; if every selected member of one
   provider fails, stop and ask before integrating. Merge the answers into
   one map of positions, each tagged with the members holding it, for
   example `[Sol, Fable]` or `[all]`, with each side's reasons, then add
   the lead's assessment.

## Further rounds

After each round, if authorized, apply the recommendations the lead
accepts, run tests or checks on the final files after the last edit, and
report what was checked; agreement is not verification. Start the next
round when a member still objects materially to the current answer or
artifact, when a member's latest review score is below the target score
and the artifact has changed since that member scored it, or when the user
asks. Resume each member's own session with what changed since its last
turn: the merged map, the lead's assessment and any revised artifact with
its test results. Ask it to challenge what remains, concede answered
points, skip resolved findings, say whether it is satisfied and, for a
review, give a new score. Never tell a member the target score. Announce
each round.

Stop when every member is satisfied and no score calls for another round;
when a round changed nothing; or when the user stops. For a review, a
round after which no score below the target rose counts as one that
changed nothing, and so does a score below the target when the artifact
will not change (edits not authorized, or the lead accepts no further
change). When the council stops below the target, report the remaining
disagreement and every latest score below the target as unresolved. A
member that gives no score counts by its satisfaction alone, and a score
given as a range counts as its lower end. A failed member no longer
starts or blocks a round; its earlier scores stay in the table.

## Result

Return one integrated answer: the lead's conclusion and surviving
reasoning, material corrections, remaining disagreements with their tags
and each side's reasons, uncertainty and next steps. For a review, add a
table of scores per member and round, the target score and whether every
member's latest score reached it; write `no score` when a member gives
none. If the work ends in a pull request, put the table in its description
by editing it, not in a comment. End with one line naming members,
requested effort, flags, the target score for a review, completed rounds
and any failed member. Claim consensus only when every member agrees on
the conclusion and main reasons.
No transcripts unless asked. A failed round does not undo completed ones;
no automatic retry.

## CHANGELOG

### 1.6.1 (2026-11-16)

In Codex, every member launch and resume runs outside the sandbox with
`require_escalated`. Inside the sandbox a Claude member failed with
`ENOTFOUND`, and Claude Code could not write its session to `~/.claude`.

### 1.6.0 (2026-11-16)

Added `--target-score N` for reviews, default 8.5, also set by a bare
number before the request. Further rounds continue while a member's latest
score is below it, within the stop rules, and members never learn it.
`--no-web` is used only when the user asked for it in the call or said yes
to a direct question before Round 1; the lead never chooses it alone.

### 1.5.1 (2026-11-11)

Claude members use the user's Claude account login. The CLI helper excludes
inherited API credentials and provider overrides from its child environment
and checks account authentication before sending a prompt. Stored keys and
the parent environment remain unchanged. Added five auth-routing tests.
