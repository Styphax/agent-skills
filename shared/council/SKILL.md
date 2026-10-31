---
name: council
description: Put a question, decision, plan or review to a council of GPT-6 Astra, GPT-6.1 Sol, ChatGPT Pro, Claude Opus 5.5, Claude Fable 5.1 and optionally Claude Sonnet 5.5, only when the user explicitly asks for the council. Inspecting or editing the skill does not convene it.
allowed-tools: Bash(node:*), Bash(npx -y @steipete/oracle@latest:*)
metadata:
  version: 1.4.0
  source: https://github.com/t3dotgg/tstack/blob/main/skills/council/SKILL.md
---

The lead puts the user's request to every member independently and in
parallel, then judges from evidence. The lead is not a member. Do not
average positions, manufacture disagreement or require consensus. Keep
scope fixed: findings beyond the request are reported, not implemented.

Flags before the request: `--members LIST` (subset of
`astra,sol,pro,opus,fable,sonnet`), `--effort LEVEL` (`low`, `medium`,
`high`, `xhigh`, `max`; one level for all or `member=LEVEL` pairs; Pro
always runs at ChatGPT's Pro tier), `--no-web` (supplied material only;
state it in the handoff). If members or effort are not given, ask first with
the picker in [runtime](references/runtime.md), as an optional question
whose text names every member and effort level. Defaults: Astra, Sol, Pro,
Opus and Fable at `xhigh`; Sonnet only when chosen. If no question tool is
listed, ask in one plain-text line naming all options and the defaults. If
the tool returns no answer, use the defaults and say so. Without a request,
use the latest substantive one. Preserve the conversation's constraints and
language. Unknown options or members require clarification; never silently
substitute settings.

## Round 1

1. If the request concerns existing work and edits are authorized, finish
   known fixes first, except on work being replaced, and run the relevant
   checks, so members judge the current state. Announce members, effort
   and flags.
2. Form the lead's own view before reading any member.
3. Write one UTF-8 handoff under a unique workspace `work/` directory: the
   exact request, facts, constraints, relevant sources and evidence gaps;
   only authorized material, never secrets, nothing that reveals the lead's
   view. Ask for an answer, its support separating verified facts from
   judgment, assumptions, alternatives, the strongest counterargument and
   the evidence that would change it. For a review, also ask for findings
   by severity and a score out of 10. Members stay read-only, may not
   delegate and must not read `work/` beyond the handoff. Impose no
   research, time or token budget unless the user asks.
4. Launch every member with the same handoff as described in
   [runtime](references/runtime.md) and wait for all. If a member fails,
   report it and never substitute; if every selected member of one
   provider fails, stop and ask before integrating. Merge the answers into one map of
   positions, each tagged with the members holding it, for example
   `[Sol, Fable]` or `[all]`, with each side's reasons, then add the
   lead's assessment.

## Further rounds

After each round, if authorized, apply the recommendations the lead
accepts, run tests or checks on the final files after the last edit, and
report what was checked; agreement is not verification. Start the next
round when a member still objects materially to the current answer or
artifact, or the user asks. Resume each member's own session with what
changed since its last turn: the merged map, the lead's assessment and any
revised artifact with its test results. Ask it to challenge what remains,
concede answered points, skip resolved findings and say whether it is
satisfied. Stop when every member is satisfied, when a round changed
nothing (report the remaining disagreement as unresolved), or when the user
stops. Announce each round.

## Result

Return one integrated answer: the lead's conclusion and surviving
reasoning, material corrections, remaining disagreements with their tags
and each side's reasons, uncertainty and next steps. For a review, add a
table of scores per member and round; write `no score` when a member gives
none. If the work ends in a pull request, put the table in its description
by editing it, not in a comment. End with one line naming members,
requested effort, flags, completed rounds and any failed member. Claim
consensus only when every member agrees on the conclusion and main reasons.
No transcripts unless asked. A failed round does not undo completed ones;
no automatic retry.
