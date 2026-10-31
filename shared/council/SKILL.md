---
name: council
description: Put a question, decision, plan or review to a council of GPT-6 Astra, GPT-6.1 Sol, Claude Opus 5.5 and Claude Fable 5.1, only when the user explicitly asks for the council. Inspecting or editing the skill does not convene it.
allowed-tools: Bash(node:*)
metadata:
  version: 1.0.0
---

The lead puts the user's request to each member independently and in
parallel, then decides from evidence. Do not average positions, manufacture
disagreement or require consensus. If a member is unavailable, report it;
never substitute.

Flags before the request: `--members LIST` (subset of `astra,sol,opus,fable`,
default all four), `--effort LEVEL` (`low`, `medium`, `high`, `xhigh`
default, `max`, for every member), `--no-web` (supplied material only).
Without a request, use the latest substantive one. Preserve the
conversation's constraints and language. Unknown options require
clarification; never silently substitute settings.

## Round 1

1. Finish known fixes and run the relevant checks first, so members judge
   the current state. Announce members, effort and flags.
2. Form the lead's own answer before reading any member. If the lead's model
   is one of the four, that answer fills its seat and the member is not
   launched.
3. Write one UTF-8 handoff under a unique workspace `work/` directory: the
   exact request, facts, constraints, relevant sources and evidence gaps;
   only authorized material, never secrets, nothing that reveals the lead's
   answer. Ask for a conclusion, its support with verified facts apart from
   judgment, assumptions, the strongest counterargument and the evidence
   that would change it. For a review, also ask for findings by severity and
   a score out of 10. Members stay read-only and may not delegate. Impose no
   research, time or token budget unless the user asks.
4. Launch every member with the same handoff as described in
   [runtime](references/runtime.md), wait for all, then merge into one map
   of positions tagged `[Astra]`, `[Sol]`, `[Opus]`, `[Fable]` or `[all]`,
   with each side's reasons. The lead's seat is tagged like the others.

## Round 2

Run a second round only when the lead changed the artifact or answer after
round 1, or the user asks. Never a third. Resume each member's own session
with the revised artifact, check results and the merged map. Ask it to
challenge what remains, concede answered points and skip resolved findings.
If implementation is authorized, run tests or checks on the final files
after the last edit and report what was checked; agreement is not
verification. Keep scope fixed: findings beyond the request are reported,
not implemented.

## Result

Return one integrated answer: conclusion and surviving reasoning, material
corrections, remaining disagreements with each side's reasons, uncertainty
and next steps. For a review, add a table of scores per member and round;
write `no score` when a member gives none, and put the table in the pull
request description if the work ends in one. End with one line naming
members, requested effort, flags and completed rounds. Claim consensus only
when every member agrees on the conclusion and main reasons. No transcripts
unless asked.

On a member failure, report it and integrate the completed members; no
automatic retry. Distinguish a completed round 1 from a failed round 2.
