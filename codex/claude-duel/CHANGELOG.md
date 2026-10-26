# Changelog

## 1.2.0 (2026-10-26)

- Shortened SKILL.md and moved runtime and wide-mode details into references.
- Added `--blind`: an independent first answer followed by comparison in round 2.
- Kept `--wide` for mapping alternatives and `--steer` for user direction.
- Require checks on the final revised code after the last edit. Use the revised artifact in round 2 when available.
- Kept the existing Claude helper unchanged. Both skill files passed validation. The shared update passed 13 offline runtime tests, including checks of the Claude helper. No live reviewer calls were made.

## 1.1.5 (2026-10-12)

- Enabled skill discovery for explicit natural-language requests as well as
  `$claude-duel`. The description and invocation rules require an explicit
  user request to run Claude Duel; general review requests do not authorize it.

## 1.1.4 (2026-10-11)

- Removed the helper's per-turn runtime deadline. Interruption handling and
  the two-turn limit remain in place.

## 1.1.3 (2026-10-11)

- Removed the default research budget from standard and wide-mode handoffs.
- Handoff budgets now require an explicit user request. Runtime timeouts and
  the two-turn limit are unchanged.

## 1.1.2 (2026-10-02)

- Changed the default effort from `high` to `xhigh`; kept the pinned
  `claude-fable-5-1` model. Updated the helper, examples and UI label together.
- Disabled content-based automatic model switching per invocation with
  `switchModelsOnFlag: false`; retained assistant-message model validation.
- Corrected the documented Fable 5.1 minimum Claude Code version to 2.1.257
  and clarified that managed settings policy still applies in safe mode.
- Verified argument construction, exact-session resume, model-mismatch
  rejection and the two-turn limit offline. No live model call in this update.

## 1.1.1 (2026-09-14)

- Text fixes mirrored from codex-duel v1.3.1, which had its first live
  `--wide --steer` run: language follows the question; renumber after user
  drops so gaps reveal nothing; in round 2 also mark entries the reviewer
  did not assess; list refuted claims inside surviving candidates. No live
  run of claude-duel with `--wide` yet.

## 1.1.0 (2026-09-14)

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

## 1.0.1 (2026-09-05)

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

## 1.0.0 (2026-09-05)

- Adapted the local `Skills/codex-duel` v1.2.0 workflow for Codex as lead and
  Claude Code as reviewer. Default: `claude-fable-5-1`, `high`.
- Replaced the Codex plugin runtime with a read-only Claude CLI helper,
  exact-session resume and bounded turns. Global fast-mode switching omitted.
- Runtime flags checked against local Claude Code 2.1.207 and the official
  [CLI reference](https://code.claude.com/docs/en/cli-reference).
  Model ID checked against the official
  [model configuration guide](https://support.claude.com/en/articles/11940350-claude-code-model-configuration).
