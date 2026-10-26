---
name: claude-duel
description: Run a bounded Codex-Claude review only when the user explicitly requests Claude Duel. Supports a blind first pass and exploration of multiple answers. Inspecting or editing the skill does not start a duel.
metadata:
  version: 1.2.0
---

Codex leads; Claude reviews. Keep the lead model unchanged. Use at most
two reviewer turns, then the lead decides from evidence. Do not average
positions, manufacture disagreement, or require consensus.

## Options

Parse flags before the question. If absent, use the latest substantive
question. Preserve the conversation's constraints and language.

| Flag | Meaning |
| --- | --- |
| `--model ID` | Reviewer model; default `claude-fable-5-1`. Aliases in [runtime](references/runtime.md). |
| `--effort LEVEL` | `low`, `medium`, `high`, `xhigh` (default), `max`. |
| `--blind` | Independently answer first, then compare and challenge in round 2. |
| `--wide` | Map viable answers instead of converging on one; includes a blind first pass. |
| `--steer` | With `--wide`, pause after merging options for user direction. |

Unknown options require clarification. Never silently substitute settings.
`--blind --wide` is valid but redundant; `--steer` requires `--wide`.

## Review

For every mode, write UTF-8 handoffs under a unique workspace `work/`
directory. Include the exact question, facts, constraints, relevant sources
and evidence gaps; only authorized material, never secrets. Do not impose
research, time, token, cost or tool budgets unless the user asks. Require
evidence for verified claims, distinguish judgment and identify gaps.
Keep review read-only unless implementation is explicitly authorized;
prohibit further delegation in the handoff.

1. Announce the reviewer, requested effort and modes. Form the lead's own
   provisional answer before reading reviewer output. For `--wide`, use the
   short [wide workflow](references/wide.md) instead of steps 2-4.
2. Prepare the first handoff:
   - **Standard:** include the provisional answer and its weak points. Ask
     for its own conclusion, factual corrections, unsupported claims, hidden
     assumptions, missing alternatives, strongest counterargument and
     evidence that would change the conclusion. No fixed headings needed.
   - **Blind:** withhold the lead's answer, leanings and answer-specific
     doubts, including files that reveal them. Ask for an independent
     conclusion, support, assumptions, alternatives and uncertainties.
3. Run round 1 using [runtime](references/runtime.md). Assess the findings
   against evidence and user constraints. Standard mode stops if no material
   disagreement remains. Blind mode always uses round 2: reveal the lead's
   independently formed answer and compare the conclusions and reasons.
4. For round 2, resume this duel's exact session. Send the lead's assessment,
   supporting evidence, corrections and unresolved questions. Ask the
   reviewer to challenge what remains, concede answered points and avoid
   repeating resolved findings. Stop after this turn.

## Verify code changes

If implementation is authorized, apply accepted corrections and inspect the
final diff. Run the relevant tests, build or behavior checks on the final
revised files, after the last edit. When round 2 is still available, give the
reviewer the revised artifact and check results, not just an explanation of
the fix. If edits follow round 2, rerun affected checks yourself; do not add
a third reviewer turn. Report what was actually checked and any blocked or
unverified behavior. Agreement alone is not verification. Review-only tasks
do not authorize edits.

## Result

Return one integrated answer: conclusion and surviving reasoning, material
corrections, remaining disagreements and uncertainty. Include code-check
results where applicable and one line with reviewer, requested effort,
active modes and completed turns. Do not claim consensus unless both agree
on the conclusion and main reasons. Do not include transcripts unless asked.

On failure or missing required runtime evidence, stop and report the limit;
no automatic retry or replacement reviewer. Distinguish a completed first
review from a failed follow-up.
