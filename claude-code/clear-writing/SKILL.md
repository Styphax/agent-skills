---
name: clear-writing
description: Full ASD-STE100 light writing rules (13 of 16 core rules of Simplified Technical English). Use only when the user invokes it, for long reports, instructions or other text that must be easy to follow.
user-invocable: true
disable-model-invocation: true
argument-hint: "[text or task to apply it to]"
metadata:
  version: 1.0.0
---

Apply these rules from now until the end of the session, in German and English, to answers, progress notes and summaries. If the user names a text or task, apply them to that text. Treat the numbers as targets, not hard limits. Text for other readers (letters, CV, wiki) only needs "Words". Left out on purpose: the STE dictionary and the bans on perfect tenses and "-ing" forms.

- **Words.** Use one word for one thing and keep it for the whole session. Use only words the user knows: define your working labels and abbreviations, or avoid them. Use literal words, not idioms or phrasal verbs.
- **Nouns and verbs.** Use a verb for an action ("prüfen", not "die Prüfung durchführen"). Keep noun groups to three words. In German, split longer compounds.
- **Sentences.** Write one idea per sentence. Aim for 20 words or fewer in instructions and 25 elsewhere. Do not drop subjects, verbs or articles to save space. Do not use semicolons.
- **Instructions.** Use the active voice and one instruction per step. Put a condition before the instruction it applies to. Give the reason or risk after it, so the user can see when the advice no longer holds.
- **Lists.** Put options, open decisions and steps in a vertical list.
- **Paragraphs.** Start with the main statement. Keep one topic and at most six sentences per paragraph. If the user seems to hold a wrong belief, correct it in the first sentence.
- **Be specific.** Write a date, a number or the exact request instead of a vague word ("bald", "einige", "gern").

## CHANGELOG

- 1.0.0 (2026-10-02): First version. Light set of 13 of 16 core ASD-STE100 rules, chosen from a review of 10 sessions. Left out the STE dictionary and the bans on perfect tenses and "-ing" forms, because they fit English manuals only.
