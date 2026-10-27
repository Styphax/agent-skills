---
name: vw-lease-rates
description: Berechne aktuelle VWFS-Privatleasingraten für Volkswagen.de Gebrauchtwagen-Such-URLs, mit mehreren Laufzeiten, Jahreskilometern, Brutto-Sonderzahlung, Gesamtbetrag und Fahrzeuglinks.
metadata:
  version: "1.1.0"
---

# VW Lease Rates

Für deutsche Volkswagen.de Pkw-Suchen nach Gebrauchtwagen und Jungen Gebrauchten, insbesondere:

`https://www.volkswagen.de/de/modelle/verfuegbare-fahrzeuge-suche.html/__app/search/cars.app?...`

Auch die normale Suchseiten-URL mit ableitbaren Query-Filtern wird akzeptiert. Die Suche beginnt bei Seite 1 und übernimmt wiederholte Filter, etwa mehrere Modelle. Privatkunden, Bruttopreise und Euro sind der Standard.

## Ausführen

```powershell
node "<skill>/scripts/vw_lease_rates.mjs" --url "<VW_SEARCH_URL>" --term 36 --mileage 10000 --down-payment 0 --out "<OUTPUT_DIR>"
```

Mehrere Laufzeiten:

```powershell
node "<skill>/scripts/vw_lease_rates.mjs" --url "<VW_SEARCH_URL>" --terms 24-36 --mileage 10000 --down-payment 0 --out "<OUTPUT_DIR>"
```

Benötigt Node 18+ mit globalem `fetch`; kein Browser erforderlich.

- `--url`: HTTPS-Such-URL von Volkswagen.de; Pflicht.
- `--term`: Einzelne Laufzeit, Standard `36` Monate.
- `--terms`: Liste wie `24,30,36` oder Bereich wie `24-36` in Sechsmonatsschritten. Die Berechenbarkeit hängt vom Fahrzeug ab. Der Bereichsendwert muss auf einem Schritt liegen.
- `--mileage`: Jahreskilometer, Standard `10000`.
- `--down-payment`: Brutto-Sonderzahlung, Standard `0` Euro. Ohne Tausendertrennzeichen, z. B. `1000.50` oder `1000,50`.
- `--out`: Ausgabeordner; Standard aktueller Ordner.
- `--page-size`: Treffer pro Seite, Standard `12`.
- `--max-pages`: Optionales Testlimit; ein Teilbestand wird deutlich gekennzeichnet.
- `--no-webcalc`: Nur Fahrzeugdaten und Kampagnen; **keine** berechneten Leasingraten.
- `--webcalc-concurrency`: Gleichzeitig bearbeitete Fahrzeuge, Standard `4`.
- `--prefix`: Dateipräfix ohne Pfadbestandteile, Standard `vw-lease-rates`.
- `--timeout-ms`: Zeitlimit je HTTP-Versuch, Standard `30000`. Vorübergehende Netzwerk-/Serverfehler, HTTP 408/429 und Zeitüberschreitungen werden höchstens zweimal wiederholt.

Monate, Kilometer und Seitenparameter müssen positive ganze Zahlen sein. Unlesbare oder negative Sonderzahlungen und unbekannte Optionen werden abgelehnt.

## Berechnung

Die aktuelle VW-Seitenkonfiguration liefert die Suchschnittstelle. Echte Leasingraten kommen ausschließlich von `https://api.webcalc.vwfs.io/webcalc-frontend-service`, Produkt `PL`, Anfrage `CalculateRate`.

- Normaler Gebrauchtwagenweg: Domain `VW.USEDCARS.VTP`, mit `Dealer.ID` und `Vehicle.ID = car.key`.
- Alternativer Herstellerweg für geeignete Fahrzeuge: `VW.ONESHOP.ECOM.DE`.
- Vertragsparameter als `#text` in `Product.Parameter`, nicht als `Value` oder `@Value` senden.
- Fahrzeugpreise bleiben centgenau. Die Monatsrate wird nur übernommen, wenn die Antwort Laufzeit, Jahreskilometer und Sonderzahlung bestätigt, entweder über strukturierte Parameter oder die konkreten Hersteller-Angebotstexte. Widersprüche oder fehlende Bestätigung ergeben einen Fehler.

Suchkarten können Finanzierungsraten enthalten. Diese dürfen weder bei WebCalc-Ausfällen noch bei `--no-webcalc` als Leasingrate erscheinen. Es gibt keinen solchen Ersatzwert.

## Ausgabe und Prüfung

Das Skript schreibt `<prefix>.json` und `<prefix>.md`.

Bei einer Laufzeit: `monthlyGross`, `totalGross`, `rateSource`. Bei mehreren Laufzeiten: `termRates[]` mit `termMonths`, `monthlyGross`, `totalGross`, `domain`, `source`, `confirmedParameters` und `error`. Die obersten Ratenfelder beziehen sich auf die ausgewählte Laufzeit; für Mehrfachvergleiche immer `termRates` verwenden.

`totalGross = monthlyGross × termMonths + downPaymentGross`, centgenau. Weitere Händler-, Zulassungs-, Liefer- oder Servicekosten sind darin nicht automatisch enthalten.

- `meta.searchComplete`: Anzahl eindeutiger Fahrzeuge stimmt mit der angekündigten Gesamtzahl überein; der Bestand blieb während der Seitennavigation stabil.
- `meta.resultNumber`, `meta.pagesFetched`, `meta.duplicatesRemoved`: Umfang und Seitennavigation.
- `meta.webCalcRateCells`: Anzahl erfolgreicher, bestätigter Fahrzeug-/Laufzeitkombinationen.
- `meta.webCalcRequests`: Anzahl bearbeiteter Fahrzeug-/Laufzeitkombinationen, nicht die Anzahl aller HTTP-Versuche einschließlich Alternativdomain und Wiederholungen.
- `complete`: Vollständige Suche und alle angefragten Raten berechnet. Bei bewusstem `--no-webcalc` bezieht es sich nur auf die Suche.
- `warnings`: Unvollständigkeit, geänderter Bestand, entfernte Duplikate oder fehlende Raten.

Prozessstatus: `0` vollständig, `2` Teilbestand oder fehlende Raten, `1` ungültige Eingabe oder fataler Abruf-/Schemafehler. Bei Status `2` bleiben verfügbare Ergebnisse gespeichert. Ein vollständiger leerer Bestand kann Status `0` haben; die Ausgabe nennt null Fahrzeuge.

Prüfe vor der Antwort die Vollständigkeit, die eindeutige Trefferzahl, `webCalcRateCells` und die Fehler in `termRates`. Keine Raten erfinden oder interpolieren. Fehlerwerte bleiben in JSON `null` und in Markdown `n/a`. Ein VWFS-Fehler wie `Cannot read properties of undefined (reading 'Slope')` bedeutet, dass der Dienst die betreffende Kombination nicht berechnen konnte; er beweist für sich allein keine dauerhafte Nichtverfügbarkeit der Laufzeit.

Antworte in der Sprache des Nutzers. Nenne Monatsrate und Gesamtbetrag je gewünschter Laufzeit, Kilometer, Brutto-Sonderzahlung und Privatkundentyp. Zeige außerdem Fahrzeugtitel, Kaufpreis, Kilometerstand, Erstzulassung, Reichweite, DC-Ladezeit, Kampagne und Händler, soweit vorhanden. Nenne erfolgreiche und fehlende Berechnungen sowie jeden Teilabruf.

Fahrzeuglinks werden als `.../__app/search/car/<URL-kodierter car.key>.app` aufgebaut, auch wenn der Eingabelink nur die Basissuchseite enthält. Linke die generierten Ergebnisdateien aus dem jeweiligen Arbeitsauftrag.

Öffentlich geladene Dienstschlüssel bleiben im Arbeitsspeicher und werden aus Fehlerprotokollen entfernt.

## Lokale Regressionstests

```powershell
node --test "<skill>/tests/lease-rates.test.mjs"
```

Die Tests decken Filterweitergabe, Seitennavigation, Duplikate, Centgenauigkeit, Fahrzeuglinks, Vertragsbestätigung, WebCalc-Ausfälle, mehrere Laufzeiten, Eingaben, Zeitlimits und bereinigte Fehlermeldungen ab. Liveprüfungen mit aktuellen Herstellerdaten separat ausführen und Seitenlimits offenlegen.
