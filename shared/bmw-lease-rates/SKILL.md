---
name: bmw-lease-rates
description: Calculate current BMW.de used-car leasing rates for vehicles in a filtered results URL and produce a Markdown and JSON comparison. Use for BMW.de Gebrauchtwagen lease-rate comparisons with a requested term, annual mileage, down payment, and private gross prices.
metadata:
  version: "1.3.0"
---

# BMW Lease Rates

Berechne die BMWFS-Leasingrate aus den aktuellen Herstellerdaten. Kartenraten sind keine Ersatzquelle, da ihre Vertragsparameter abweichen können.

## Ausführen

```powershell
node "<skill>/scripts/bmw_lease_rates.mjs" --url "<BMW_RESULTS_URL>" --term 36 --mileage 10000 --down-payment 0 --out "<OUTPUT_DIR>"
```

Benötigt Node 18+ mit globalem `fetch`. Browser oder Playwright sind nicht erforderlich.

- `--url`: HTTPS-Such-URL unter BMW.de `/de-de/sl/gebrauchtwagen` oder `/results`.
- `--term`: Monate, Standard `36`; positive ganze Zahl. Die Verfügbarkeit wird pro Produkt geprüft.
- `--mileage`: Kilometer pro Jahr, Standard `10000`; positive ganze Zahl.
- `--down-payment`: **Brutto**-Sonderzahlung in Euro, Standard `0`. Ohne Tausendertrennzeichen, z. B. `1000.50` oder `1000,50`. Netto wird von BMW zurückgegeben und darf davon abweichen.
- `--out`: Ausgabeordner, Standard aktueller Ordner.
- `--page-size`: Treffer pro Seite, Standard `12`.
- `--max-pages`: Optionales Seitenlimit für Tests. Ein begrenzter Bestand wird ausdrücklich als unvollständig ausgewiesen.
- `--timeout-ms`: Zeitlimit je HTTP-Versuch, Standard `30000`. Netzwerkfehler, Zeitüberschreitungen, HTTP 408/429 und Serverfehler werden höchstens zweimal wiederholt.

Unbekannte Optionen und ungültige Zahlen werden vor dem Abruf abgelehnt.

## Suchumfang und Filter

Das Skript übernimmt diese URL-Filter:

- `MARKETING_MODEL_RANGE`, `COLOR`, `PAINT_TYPE`, `EQUIPMENT_GROUPS`.
- `PERFORMANCE`: Unter- und Obergrenze; die dritte Angabe bedeutet `true` für kW und `false` für PS. Ohne dritte Angabe gilt BMWs PS-Standard.
- `USED_CAR_MILEAGE`: Unter- und Obergrenze des Kilometerstands.
- `PRODUCT_CATEGORY_TYPE`: Nur `["LEASE"]`. Ohne Angabe wird auf Leasing begrenzt.
- `IS_INSTALLMENT`: Der boolesche URL-Wert bleibt erhalten; Standard `true`.

Andere Filter, etwa Kaufpreis, Erstzulassung oder Händlerfilter, werden **nicht stillschweigend entfernt**. Das Skript bricht mit einer konkreten Fehlermeldung ab. Den Link dann nicht eigenmächtig vereinfachen oder die Suche erweitern. Zusätzliche unbekannte URL-Parameter und mehrfach gesetzte Steuerparameter werden ebenfalls abgelehnt. `sorting`, `page` und übliche Trackingparameter dürfen vorhanden sein; die fertige Tabelle wird unabhängig von der ursprünglichen Sortierung nach der neu berechneten Rate sortiert.

BMWs öffentlich ausgelieferter, rotierender Stocklocator-Schlüssel wird frisch aus der Herstellerseite geladen. Er bleibt ausschließlich im Arbeitsspeicher und darf weder ausgegeben noch gespeichert werden.

## Ausgabe und Fehlerstatus

- `bmw-lease-rates.json`: Quell-URL, Erstellungszeit, Zielparameter, erwartete/eindeutige Trefferzahl, Vollständigkeit, Warnungen, Fehler, alle gültigen Privat-/Gewerbeangebote und ein Ergebnisstatus pro Fahrzeug.
- `bmw-lease-rates.md`: Private Bruttoraten, günstigste gültige Privatrate pro Fahrzeug, aufsteigend nach der neu berechneten Monatsrate. Einschließlich Modell, Kaufpreis und Händlername, soweit vorhanden; sonst Händlernummer und Ort.

Wichtige JSON-Felder:

- `searchComplete`: Eindeutige Suchtreffer stimmen mit BMWs Gesamtzahl überein und die Gesamtzahl blieb während der Seitennavigation stabil.
- `complete`: Zusätzlich liegt für jedes Fahrzeug eine gültige Privatrate vor und `failures` ist leer.
- `expectedHits`, `fetchedHits`, `pagesFetched`, `duplicatesRemoved`.
- `rows`: Alle gültigen Angebotsberechnungen; `privateQuotes`: eindeutige, sortierte Privatangebote für die Tabelle.
- `vehicleResults[]`: `ok`, `partial` oder `unavailable`, Anzahl gültiger Privatprodukte und konkrete Probleme.
- `failures[]`: Auch nicht verfügbare Parameter, abweichende Antwortparameter, fehlende Beträge und einzelne Produktfehler werden hier erfasst. Ein Produktfehler verhindert die Berechnung anderer Produkte desselben Fahrzeugs nicht.

Prozessstatus: `0` vollständig, `2` unvollständige Suche oder fehlende/fehlerhafte Berechnungen, `1` ungültige Eingabe oder fataler Abruf-/Schemafehler. Bei Status `2` werden die verfügbaren Ergebnisse samt Gründen gespeichert. Eine vollständige leere Suche kann Status `0` haben; sie enthält einen Hinweis auf null Fahrzeuge.

Fehlende Kaufpreise erscheinen als `n/a`, niemals als null Euro. Fehlende oder ungültige Raten werden nicht als gültiges Angebot ausgegeben. Laufzeit, Kilometerleistung und Brutto-Sonderzahlung jeder Berechnung müssen zum Auftrag passen; Netto- und Brutto-Sonderzahlung werden nicht gleichgesetzt.

## Vor der Antwort prüfen

Prüfe `searchComplete`, `complete`, `expectedHits`, `fetchedHits`, `failures` und `vehicleResults`. Nenne jeden verbleibenden Ausfall oder Teilabruf. Verwende bei Privatvergleichen `privateQuotes`, nicht die gemischte Liste `rows`.

Antworte in der Sprache des Nutzers. Nenne Laufzeit, Jahreskilometer, Brutto-Sonderzahlung, Privatkundentyp und Bruttoraten. Der Gesamtbetrag stammt aus der BMWFS-Rechnung; weitere Zulassungs- oder Händlerkosten können hinzukommen. Sage nur für tatsächlich geprüfte Fahrzeuge, dass die Finanzberechnung ausgeführt wurde. Unverfügbare Parameter sind keine erfolgreiche Berechnung. Behaupte keine manuellen Seitenklicks.

## Lokale Regressionstests

```powershell
node --test "<skill>/tests/lease-rates.test.mjs"
```

Die Tests verwenden kontrollierte Antworten und prüfen unter anderem aktuelle Datenfelder, Filtergrenzen und Einheiten, Teilabrufe, Duplikate, Vertragsparameter, fehlende Raten, Produktfehler, Sortierung, Zeitlimits und Schlüsselbereinigung. Ein Live-Test muss separat mit aktuellen Herstellerdaten erfolgen; `--max-pages` begrenzt die Stichprobe und kennzeichnet sie als Teilbestand.

## CHANGELOG

### 1.3.0 - 2026-10-19

- Aktuelle Fahrzeugfelder, Brutto-Sonderzahlung und korrekte Netto-Rückgabe.
- Vollständige Leistungs-/Kilometerbereiche; nicht unterstützte Filter werden abgelehnt.
- Explizite Ergebnisstatus, Prüfung von Beträgen und Antwortparametern, Fehlerisolation je Produkt.
- Eindeutige Privattabelle, Sortierung nach Neuberechnung und kontrollierte Seitennavigation.
- Eingabeprüfung, Zeitlimits, begrenzte Wiederholungen und lokale Regressionstests.

### 1.2.0 - 2026-08-15

- Replaced the Playwright/Chrome capture bootstrap with a single plain HTTPS fetch: the rotating API key is public, server-rendered config in the BMW.de page and is extracted with a regex. Removes the browser, Playwright, and bundled-runtime dependencies entirely.
- Dropped the search `hash` parameter — the endpoint accepts requests without it, while stale or wrong hashes return 404. Empirically verified (403 without key regardless of hash; 201 with key and no hash).
- Removed the captured-request template and `--template`/`--hash` options; the search body is built directly from the URL filters.
- Added a stderr warning for URL filter keys the script does not map.
- Reduced finance-flow concurrency from 10 to 4.
- End-to-end verified against the same-day capture-based run: identical gross rate for the shared vehicle, `fetchedHits` equal to the API's `totalCount`, zero failures.

### 1.1.0 - 2026-07-29

- Replaced the expired static search hash and cached request template with a live Chrome bootstrap.
- Preserved BMW's complete current filter body, sort order, dealer scope, and installment filter.
- Added secure in-memory handling of BMW's rotating access key.
- Added automatic pagination, current response-field mappings, private/business separation, and duplicate-free private output.

### 1.0.0 - 2026-07-02

- Initial BMW used-car lease-rate calculator.
