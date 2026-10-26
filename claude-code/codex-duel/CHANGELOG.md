# Changelog

## 1.5.0 (2026-10-26)

- Shortened SKILL.md and moved runtime and wide-mode details into references.
- Added `--blind`: an independent first answer followed by comparison in round 2. Kept `--wide` and `--steer` for exploring alternatives.
- Replaced the companion-plugin route with a local helper calling `codex exec`. It resumes the saved session ID directly, enforces the two-turn limit and runs reviews in the background.
- Fast mode now applies per invocation. The helper leaves saved settings untouched, including after failure or a pause.
- Require checks on the final revised code after the last edit. Use the revised artifact in round 2 when available.
- Passed 13 offline runtime tests, including exact-session resume, cancellation, unchanged settings and the turn limit. Both skill files passed validation. No live reviewer calls were made.

## 1.4.3 (2026-10-12)

- Technische Aufrufsperre entfernt. Claude kann den Skill jetzt auch
  auf eine ausdrückliche Aufforderung in natürlicher Sprache starten.
- Kurzbeschreibung und Aufrufregel verlangen einen ausdrücklichen
  Auftrag für Codex Duel; allgemeine Prüfaufträge reichen nicht aus.

## 1.4.2 (2026-10-11)

- Laufzeitgrenze pro Runde entfernt. Statusabfragen werden wiederholt,
  solange der Auftrag aktiv ist, statt ihn nach fester Wartezeit abzubrechen.
- Die Beschränkung auf zwei Runden bleibt bestehen.

## 1.4.1 (2026-10-11)

- Standard-Recherchebudget aus den Handoffs im normalen und im Wide-Modus
  entfernt. Budgets werden nur auf ausdrücklichen Nutzerwunsch vorgegeben.
- Laufzeitgrenzen und die Beschränkung auf zwei Runden bleiben bestehen.

## 1.4.0 (2026-10-02)

- Aliase aktualisiert: `sol` auf `gpt-6.1-sol`, `luna` auf `gpt-6-luna`;
  `terra` bleibt ausdrücklich Legacy. Alte volle IDs bleiben wählbar,
  `gpt-6-sol` ergänzt. Standard bleibt GPT-6 Astra mit `xhigh`.
- `max` optional ergänzt und unverändert durchgereicht; Companion 1.0.6
  braucht dafür den lokalen Parser-Patch. Vor `max` die gewählte Runtime
  prüfen, da Pluginupdates den Patch überschreiben können.
- Pre-flight prüft Jobstatus und Worker-PID statt Logstillstand. Nur
  bestätigte tote Jobs dieses Duells werden bereinigt; fremde, aktive oder
  unklare Jobs bleiben unberührt.

## 1.3.1 (2026-09-14)

- Erster Live-Lauf mit `--wide --steer` (GPT-6 Astra, xhigh, Claude Opus 5
  als Lead): Runde 1 6:40 min, Runde 2 9:03 min, 16 + 19 blinde Kandidaten,
  Union 25, nach Steuerung 21. Alle drei Steuerungspfade und das Resume der
  Runde-1-Session haben funktioniert.
- Sechs Textkorrekturen aus dem Lauf: Sprache folgt der Frage; nach dem
  Streichen neu nummerieren, damit Lücken nichts verraten; in Runde 2 auch
  Einträge ohne Codex-Bewertung markieren; widerlegte Teilbehauptungen
  überlebender Kandidaten in der Karte ausweisen; Vordergrund-Warten mit
  kurzem Timeout erlaubt; nur interaktive Sitzungen, weil der SessionEnd-
  Hook des Plugins bei `claude -p` die Codex-Jobs killt.

## 1.3.0 (2026-09-14)

- Neuer Modus `--wide` für offene oder breite Fragen. Runde 1 läuft blind:
  das Handoff enthält Frage, Fakten, Lücken und Constraints, aber nicht
  Claudes Kandidaten. Beide Modelle listen unabhängig die vertretbaren
  Antworten (Optionen, Erklärungen oder Perspektiven), Claude vereinigt die
  Listen mit Herkunfts-Tags, Runde 2 ergänzt, prüft Zusammenlegungen, ficht
  Schwaches an und rankt, wo Kandidaten vergleichbar sind. Die Endantwort
  ist eine Karte der überlebenden Kandidaten mit den verbleibenden
  Gewichtungsunterschieden statt einer einzelnen Schlussfolgerung. Immer
  zwei Codex-Turns; Runtime, Pinning und Read-only unverändert.
- Grund: Der Standardmodus ist auf Prüfung und Verdichtung einer Antwort
  ausgelegt. Er fragt zwar nach ausgelassenen Alternativen, sichert eine
  systematische Erkundung mehrerer Antworten aber nicht ab: der Reviewer
  sieht die vorläufige Antwort, der Austausch endet bei Einigkeit nach
  Runde 1, und die Endantwort verlangt eine Schlussfolgerung.
- Neues Flag `--steer`, nur mit `--wide`: eine Pause nach dem Merge, in der
  der Nutzer Runde 2 steuert (vertiefen, streichen, ergänzen). Idee aus
  Lennys Newsletter, "How to turn your AI into a world-class designer":
  KI-Ideen ungefiltert zurück in die KI ergeben Ergebnisse, die jeder
  bekommt; der Eingriff zwischen den Iterationen macht den Unterschied.
  Weil das Plugin nur `--resume-last` kennt, muss Runde 2 nach der Pause
  die Session-ID von Runde 1 bestätigen. Mit `--fast` wird der Tier für
  die Pause zurückgesetzt.
- Entwurf per codex-duel (GPT-6 Astra, xhigh, eine Runde) gegengelesen;
  Kandidatenformat, Merge-Regel und Behandlung verworfener Kandidaten
  daraus übernommen. Kein Live-Lauf mit `--wide` oder `--steer`.

## 1.2.0 (2026-09-04)

- Standardmodell auf GPT-6 Astra (`gpt-6-astra`) umgestellt; Denkaufwand
  bleibt `xhigh`. Ohne Flags werden beide Werte explizit übergeben.
- `--model astra` und `--model gpt-6-astra` ergänzt. Sol, Terra und Luna
  bleiben wählbar; ihre bisherigen Kurzformen gelten weiterhin.

## 1.1.0 (2026-09-03)

- Codex läuft jetzt im Hintergrund (`task --background`) mit Warten über
  `status --wait` und Abholen über `result`. Grund: Im Vordergrund starb der
  Aufruf nach 10 Minuten, der Job blieb im Plugin-Status auf "running" und
  blockierte jedes Resume.
- Der Subagent `codex:codex-rescue` wird nicht mehr genutzt. Er entscheidet
  selbst zwischen Vorder- und Hintergrund und gibt die Job-ID nicht
  verlässlich zurück. Stattdessen direkter Aufruf des Plugin-Skripts.
- Pre-flight: hängende Jobs werden vor jedem Turn per `cancel` bereinigt.
- Neue Flags: `--model sol|terra|luna`, `--effort low|medium|high|xhigh`,
  `--fast`. Fast schaltet `service_tier` in `~/.codex/config.toml` für die
  Dauer des Duells auf "fast" und danach zurück. Geprüft am 03.09.2026: der
  laufende App-Server liest die Config je Thread neu, kein Neustart nötig.
- Handoff enthält jetzt ein Recherchebudget und ein festes Antwortformat.
- Lange Handoffs gehen per `--prompt-file` statt als Shell-Argument.

## 1.0.0 (2026-09-03)

- Erstfassung. Eigenbau, kein Import. Zweck: eine Frage gegen GPT-5.6 Sol
  gegenlesen lassen, in höchstens zwei Codex-Runden, und daraus eine
  integrierte Antwort bauen statt eines Transkripts.
- Bindet den Codex-Plugin-Subagenten `codex:codex-rescue` ein, nicht die
  Skills `codex:rescue` / `codex:codex-rescue`.
- Modell und Effort sind fest: `gpt-5.6-sol`, `xhigh`. Ein stiller Fallback
  auf ein anderes Modell ist ausdrücklich verboten.
