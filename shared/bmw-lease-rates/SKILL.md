---
name: bmw-lease-rates
description: Calculate current BMW.de used-car leasing rates for every vehicle in a filtered results URL and produce a Markdown and JSON comparison. Use when the user provides a BMW.de Gebrauchtwagen results URL and asks for monthly lease rates, a rate comparison, a specific term, annual mileage, down payment, or private gross rates.
metadata:
  version: "1.2.0"
---

# BMW Lease Rates

## Workflow

Use the bundled script. Do not use installments shown on result cards as the final rates because those can use different default finance parameters.

The script:

1. Fetches the public BMW.de used-car page once over plain HTTPS and extracts BMW's current stocklocator API key from the server-rendered page config. No browser is involved.
2. Runs the live search with the filters decoded from the supplied results URL, paginating until all results are loaded.
3. Opens BMW finance data for every returned vehicle.
4. Recalculates every eligible lease with the requested term, annual mileage, and down payment.
5. Writes all valid quote rows to JSON and private-customer gross rates to the Markdown comparison.

The API key rotates and is served publicly inside the page config; the script fetches it fresh on every run, keeps it in memory only, and must never print or persist it. Filter keys in the URL that the script does not map are reported as a stderr warning — if one appears, compare `fetchedHits` against the result count BMW.de shows for the same URL before trusting the output.

## Run

```powershell
node "<skill>/scripts/bmw_lease_rates.mjs" --url "<BMW_RESULTS_URL>" --term 36 --mileage 10000 --down-payment 0 --out "."
```

Requires Node 18+ (global `fetch`). No browser, Playwright, or Chrome dependency.

Options:

- `--url`: Filtered BMW.de Gebrauchtwagen results URL. Required.
- `--term`: Contract term in months. Default `36`.
- `--mileage`: Annual mileage. Default `10000`.
- `--down-payment`: Gross and net down payment in euros. Default `0`.
- `--out`: Output directory. Default current directory.

Outputs:

- `bmw-lease-rates.json`: Metadata, failures, and every valid private or business quote returned by BMW.
- `bmw-lease-rates.md`: Private-customer gross rates, one row per vehicle, sorted from cheapest to most expensive.

## Verification

Before reporting the result:

- Check that `fetchedHits` equals the expected number of BMW search results.
- Check that `failures` is empty or disclose every failure.
- Check that the private Markdown table contains one distinct row per vehicle.
- Check that term, annual mileage, and both down-payment values exactly match the request.
- Do not fall back to visible card rates if the live search or finance flow fails.

## Response Rules

Answer in the user's language. For a German request, state the exact term, annual mileage, down payment, customer type, and that the rates are gross.

Paste the compact table when practical. If it is long, show the leading results and link the generated Markdown file.

Say that the BMW finance calculation was run for every search result. Do not claim that every visible page was clicked manually.

## CHANGELOG

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
