---
name: vw-lease-rates
description: Erfasse Volkswagen.de Gebrauchtwagen- und Junge-Gebrauchtwagen-Such-URLs, berechne echte VWFS PrivatLeasing-Raten ueber WebCalc, vergleiche Laufzeiten, Jahreskilometer, 0 EUR Sonderzahlung, Gesamtbetrag und korrigierte Fahrzeug-Deep-Links.
---

# VW Lease Rates

## Einsatz

Nutze diesen Skill fuer Volkswagen.de Pkw-Such-URLs wie:

`https://www.volkswagen.de/de/modelle/verfuegbare-fahrzeuge-suche.html/__app/search/cars.app?...`

Der Skill ist fuer deutsche VW Gebrauchtwagen/Junge Gebrauchtwagen gebaut. Er paginiert die VW-BFF-Suche, normalisiert Fahrzeugdaten und berechnet die PrivatLeasing-Rate pro Fahrzeug ueber VWFS WebCalc.

Standardannahmen:

- Privatkunden-Bruttopreise.
- `36` Monate Laufzeit.
- `10.000` km/Jahr.
- `0` EUR Sonderzahlung.
- Alle Treffer des exakten Filters, beginnend mit Seite 1.

Wenn der Nutzer mehrere Laufzeiten oder einen Bereich nennt, nutze `--terms`, z.B. `--terms 24,30,36` oder `--terms 24-36`. VWFS bietet in diesem Bereich typischerweise 6-Monats-Schritte, also `24`, `30`, `36`.

## Workflow

1. Pruefe, ob die URL eine VW.de Such-URL oder ein daraus ableitbarer VW Fahrzeugfilter ist.
2. Fuehre das Skript aus:

```powershell
node "<skill>/scripts/vw_lease_rates.mjs" --url "<VW_SEARCH_URL>" --term 36 --mileage 10000 --down-payment 0 --out "."
```

Mehrere Laufzeiten:

```powershell
node "<skill>/scripts/vw_lease_rates.mjs" --url "<VW_SEARCH_URL>" --terms 24-36 --mileage 10000 --down-payment 0 --out "."
```

3. Lies die erzeugten Dateien:

- `vw-lease-rates.md` fuer die Vergleichstabelle.
- `vw-lease-rates.json` fuer strukturierte Weiterverarbeitung.

4. Antworte mit den wichtigsten Treffern und verweise auf die lokale Ergebnisdatei.

## Technische Kerndetails

- Die VW-Suchergebnisse enthalten meist nur Finanzierungsraten oder Kampagnenlabels, nicht die Leasingrate.
- Echte Leasingraten kommen aus `https://api.webcalc.vwfs.io/webcalc-frontend-service`.
- WebCalc-Produkt fuer PrivatLeasing: `PL`.
- Rechenrequest: `Request.@Name = "CalculateRate"`.
- VTP-Domain: `VW.USEDCARS.VTP` mit `Dealer.ID` und `Vehicle.ID = car.key`.
- Online-Angebote koennen auch ueber `VW.ONESHOP.ECOM.DE` berechnet werden.
- Parameterwerte muessen als `#text` in `Product.Parameter` gesendet werden, nicht als `Value` oder `@Value`.
- Korrekte VW-Fahrzeuglinks sind `.../__app/search/car/<car.key>.app?...`; `details.app?productId-app=...` landet nur auf der Suche oder ist unzuverlaessig.

## Ausgabe

Bei einer einzelnen Laufzeit stehen die Hauptwerte in:

- `monthlyGross`
- `totalGross`
- `rateSource`

Bei mehreren Laufzeiten stehen die Werte in `termRates[]`:

- `termMonths`
- `monthlyGross`
- `totalGross`
- `domain`
- `source`
- `error`

Der Gesamtbetrag ist:

`monthlyGross * termMonths + downPaymentGross`

Bei `0` EUR Sonderzahlung ist das einfach Monatsrate mal Laufzeit.

## Grenzen

Erfinde oder interpoliere keine Rate. Wenn VWFS fuer einzelne Fahrzeuge oder Laufzeiten Fehler liefert, lasse diese Werte als `n/a` stehen und nenne den Fehler knapp. Ein typischer VWFS-Fehler ist:

`Cannot read properties of undefined (reading 'Slope')`

Das bedeutet: VWFS kann diese Laufzeit fuer dieses Fahrzeug nicht berechnen, obwohl andere Laufzeiten desselben Fahrzeugs funktionieren koennen.

## Parameter

- `--url`: Pflicht, VW Such-URL.
- `--term`: Einzelne Laufzeit in Monaten, Default `36`.
- `--terms`: Laufzeitenliste oder Bereich, z.B. `24,30,36` oder `24-36`.
- `--mileage`: Jahreskilometer, Default `10000`.
- `--down-payment`: Sonderzahlung in EUR, Default `0`.
- `--out`: Ausgabeordner, Default aktueller Ordner.
- `--page-size`: Treffer pro Seite, Default `12`.
- `--max-pages`: Optionaler Deckel fuer Tests.
- `--no-webcalc`: Nur Suchdaten/Kampagnen extrahieren, keine VWFS-Raten berechnen.
- `--webcalc-concurrency`: Parallelitaet fuer WebCalc, Default `4`.
- `--prefix`: Dateipraefix, Default `vw-lease-rates`.

## Antwortprioritaeten

Bevorzuge:

- Monatsrate und Gesamtbetrag je gewuenschter Laufzeit.
- Fahrzeugtitel, Preis, km, Erstzulassung, Reichweite, 10-80% DC-Ladezeit.
- Leasingkampagne.
- Haendler.
- Korrigierten VW-Deep-Link.
- Anzahl erfolgreicher WebCalc-Zellen und `n/a`-Faelle.
