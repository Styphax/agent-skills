---
name: council
description: Put a question, decision, plan or review to a council of GPT-6 Astra, GPT-6.1 Sol, Claude Opus 5.5 and Claude Fable 5.1, only when the user explicitly asks for the council. Inspecting or editing the skill does not convene it.
allowed-tools: Bash(node:*)
metadata:
  version: 1.0.0
---

The lead puts the user's request to every member independently and in
parallel, then judges from evidence. The lead is not a member. Do not
average positions, manufacture disagreement or require consensus. Keep
scope fixed: findings beyond the request are reported, not implemented.

Flags before the request: `--members LIST` (subset of `astra,sol,opus,fable`,
default all four), `--effort LEVEL` (`low`, `medium`, `high`, `xhigh`
default, `max`, for every member), `--no-web` (supplied material only;
state it in the handoff). Without a request, use the latest substantive
one. Preserve the conversation's constraints and language. Unknown options
or members require clarification; never silently substitute settings.

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
   report it and never substitute; if no member of one provider completes,
   stop and ask before integrating. Merge the answers into one map of
   positions, each tagged with the members holding it, for example
   `[Sol, Fable]` or `[all]`, with each side's reasons, then add the
   lead's assessment.

## Round 2

Run a second round only when material disagreement remains after the
lead's assessment, the artifact changed, or the user asks. Never a third.
If authorized, first apply the recommendations the lead accepts, run tests
or checks on the final files after the last edit, and report what was
checked; agreement is not verification. Resume each member's own session
with the merged map, the lead's assessment and any revised artifact with
its test results. Ask it to challenge what remains, concede answered points
and skip resolved findings.

## Result

Return one integrated answer: the lead's conclusion and surviving
reasoning, material corrections, remaining disagreements with their tags
and each side's reasons, uncertainty and next steps. For a review, add a
table of scores per member and round; write `no score` when a member gives
none. If the work ends in a pull request, put the table in its description
by editing it, not in a comment. End with one line naming members,
requested effort, flags, completed rounds and any failed member. Claim
consensus only when every member agrees on the conclusion and main reasons.
No transcripts unless asked. Distinguish a completed round 1 from a failed
round 2; no automatic retry.
