#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE_SIZE = 12;
const CONCURRENCY = 4;
let timeoutMs = 30000;

const BOOTSTRAP_URL = 'https://www.bmw.de/de-de/sl/gebrauchtwagen';
const SEARCH_URL =
  'https://stolo-data-service.prod.stolo.eu-central-1.aws.bmw.cloud/vehiclesearch/search/de-de/gebrauchtwagen';
const OPEN_URL =
  'https://sf-mco.aws.bmw.cloud/gateway-service/channels/STOCKLOCATOR/clients/customer/brands/bmwCar/countries/DE/languages/de/operations/open?retentionPeriod=SHORT';
const DETAIL_URL =
  'https://sf-mco.aws.bmw.cloud/gateway-service/channels/STOCKLOCATOR/clients/customer/brands/bmwCar/countries/DE/languages/de/operations/detail-calculation';

const HEADERS = {
  Origin: 'https://www.bmw.de',
  Referer: 'https://www.bmw.de/',
  Accept: '*/*',
  'Content-Type': 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145 Safari/537.36',
};

function positiveInteger(value, name) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Number(value);
}

function parseMoney(value) {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(String(value))) {
    throw new Error('down-payment must be a nonnegative EUR amount without thousands separators');
  }
  const amount = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(amount) || !Number.isSafeInteger(Math.round(amount * 100))) throw new Error('Invalid down-payment');
  return amount;
}

function validateUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || !['www.bmw.de', 'bmw.de'].includes(url.hostname) || url.username || url.password || url.port ||
      !/^\/de-de\/sl\/gebrauchtwagen(?:\/results)?\/?$/.test(url.pathname)) {
    throw new Error('Expected an HTTPS BMW.de used-car search URL');
  }
  for (const key of url.searchParams.keys()) {
    if (!['filters', 'sorting', 'page'].includes(key) && !/^utm_|^(?:cid|gclid)$/.test(key)) {
      throw new Error(`Unsupported BMW URL parameter: ${key}; refusing to change the search scope`);
    }
    if (url.searchParams.getAll(key).length > 1) throw new Error(`Duplicate BMW URL parameter: ${key}`);
  }
  if (url.hash) throw new Error('BMW URL fragments are not supported');
  return url;
}

function parseArgs(argv) {
  const args = { term: 36, mileage: 10000, downPayment: 0, out: '.', pageSize: PAGE_SIZE, maxPages: null, timeoutMs: 30000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { args.help = true; continue; }
    if (!['--url', '--term', '--mileage', '--down-payment', '--out', '--page-size', '--max-pages', '--timeout-ms'].includes(arg)) throw new Error(`Unknown option: ${arg}`);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    if (arg === '--url') args.url = next, i += 1;
    else if (arg === '--term') args.term = positiveInteger(next, 'term'), i += 1;
    else if (arg === '--mileage') args.mileage = positiveInteger(next, 'mileage'), i += 1;
    else if (arg === '--down-payment') args.downPayment = parseMoney(next), i += 1;
    else if (arg === '--out') args.out = next, i += 1;
    else if (arg === '--page-size') args.pageSize = positiveInteger(next, 'page-size'), i += 1;
    else if (arg === '--max-pages') args.maxPages = positiveInteger(next, 'max-pages'), i += 1;
    else if (arg === '--timeout-ms') args.timeoutMs = positiveInteger(next, 'timeout-ms'), i += 1;
  }
  if (!args.help) {
    if (!args.url) throw new Error('--url is required');
    validateUrl(args.url);
    buildSearchBody(args); // Reject unsupported filters before fetching any data.
  }
  return args;
}

function usage() {
  return `Usage:
node scripts/bmw_lease_rates.mjs --url "<BMW_URL>" [--term 36] [--mileage 10000] [--down-payment 0] [--out .]
Optional: --page-size 12 --max-pages <n> (partial test run), --timeout-ms 30000.
Exit codes: 0 complete; 2 partial search, unavailable private quotes or product failures; 1 fatal input/network/schema error.`;
}

// The stocklocator API key is public: BMW serves it to every visitor inside the
// server-rendered page config. One plain GET replaces the former browser capture.
// The key rotates and must stay in memory only — never log or persist it.
async function bootstrapApiKey() {
  const html = (await fetchText(BOOTSTRAP_URL, {
    headers: { 'User-Agent': HEADERS['User-Agent'], Accept: '*/*' },
  })).replaceAll('&quot;', '"');
  const apiKey = html.match(/"apiKey"\s*:\s*"([0-9a-f]{40,})"/)?.[1];
  if (!apiKey) throw new Error('apiKey not found in bootstrap page config');
  return apiKey;
}

function safeError(value) {
  let text = String(value);
  if (HEADERS['x-api-key']) text = text.replaceAll(HEADERS['x-api-key'], '[redacted]');
  return text;
}

async function fetchText(url, options = {}, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
      const text = await response.text();
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status} at ${new URL(url).pathname}: ${safeError(text).slice(0, 500)}`);
        error.retryable = [408, 429].includes(response.status) || response.status >= 500;
        throw error;
      }
      return text;
    } catch (error) {
      lastError = new Error(safeError(error.message));
      if (error.retryable === false) break;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function fetchJson(url, options, retries = 2) {
  const text = await fetchText(url, options, retries);
  try { return JSON.parse(text); }
  catch { throw new Error(`Invalid JSON at ${new URL(url).pathname}`); }
}

function getMeta(parameterValues, key, metaKey) {
  const entry = parameterValues?.find((item) => item.key === key);
  const meta = entry?.value?.find((item) => item.key === metaKey);
  return meta?.value;
}

function currentValue(parameterValues, key) {
  return getMeta(parameterValues, key, 'value');
}

function decodeFilters(rawUrl) {
  const url = new URL(rawUrl);
  const encoded = url.searchParams.get('filters');
  if (!encoded) return {};
  let filters;
  try { filters = JSON.parse(encoded); }
  catch { filters = JSON.parse(decodeURIComponent(encoded)); }
  if (!filters || Array.isArray(filters) || typeof filters !== 'object') throw new Error('filters must be a JSON object');
  return filters;
}

const MAPPED_FILTER_KEYS = new Set([
  'MARKETING_MODEL_RANGE',
  'COLOR',
  'PAINT_TYPE',
  'PERFORMANCE',
  'EQUIPMENT_GROUPS',
  'PRODUCT_CATEGORY_TYPE',
  'IS_INSTALLMENT',
  'USED_CAR_MILEAGE',
]);

function range(value, name, maxLength = 2) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxLength) throw new Error(`Invalid ${name} range`);
  const [min, max] = value;
  if ([min, max].some(v => v != null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) ||
      (min != null && max != null && min > max) || (min == null && max == null)) throw new Error(`Invalid ${name} bounds`);
  return [{ ...(min != null ? { minValue: min } : {}), ...(max != null ? { maxValue: max } : {}) }];
}

function stringValues(value, name) {
  if (!Array.isArray(value) || !value.length || value.some(v => typeof v !== 'string' || !v.trim())) throw new Error(`Invalid ${name} values`);
  return { value };
}

function applyUrlFilters(searchContext, filters) {
  if (!filters) return;
  for (const key of Object.keys(filters)) {
    if (!MAPPED_FILTER_KEYS.has(key)) {
      throw new Error(`Unsupported BMW filter: ${key}; refusing to ignore it`);
    }
  }
  if (filters.MARKETING_MODEL_RANGE) {
    searchContext.model ??= {};
    searchContext.model.marketingModelRange = stringValues(filters.MARKETING_MODEL_RANGE, 'MARKETING_MODEL_RANGE');
  }
  if (filters.COLOR) searchContext.colorClusterRough = stringValues(filters.COLOR, 'COLOR');
  if (filters.PAINT_TYPE) searchContext.paintType = stringValues(filters.PAINT_TYPE, 'PAINT_TYPE');
  if (filters.PERFORMANCE) {
    const unit = filters.PERFORMANCE[2];
    if (unit != null && typeof unit !== 'boolean') throw new Error('PERFORMANCE unit must be a boolean (true=kW, false=PS)');
    searchContext.technicalData ??= {};
    searchContext.technicalData[unit === true ? 'powerBasedOnDegreeOfElectrificationKw' : 'powerBasedOnDegreeOfElectrificationPs'] = range(filters.PERFORMANCE, 'PERFORMANCE', 3);
  }
  if (filters.USED_CAR_MILEAGE) searchContext.usedCarData = { mileageRanges: range(filters.USED_CAR_MILEAGE, 'USED_CAR_MILEAGE') };
  if (filters.EQUIPMENT_GROUPS) {
    if (typeof filters.EQUIPMENT_GROUPS !== 'object' || Array.isArray(filters.EQUIPMENT_GROUPS)) throw new Error('Invalid EQUIPMENT_GROUPS');
    searchContext.categorizedOptionGroups = Object.entries(filters.EQUIPMENT_GROUPS).map(([category, value]) => ({
      category,
      operator: 'AND',
      value: stringValues(value, 'EQUIPMENT_GROUPS').value,
    }));
  }
  if (filters.PRODUCT_CATEGORY_TYPE && JSON.stringify(filters.PRODUCT_CATEGORY_TYPE) !== '["LEASE"]') throw new Error('Only PRODUCT_CATEGORY_TYPE=["LEASE"] is supported for leasing');
  if ('IS_INSTALLMENT' in filters && typeof filters.IS_INSTALLMENT !== 'boolean') throw new Error('IS_INSTALLMENT must be boolean');
}

function decodeOfferId(interactionId) {
  if (!interactionId) return '';
  return JSON.parse(Buffer.from(interactionId, 'base64').toString('utf8')).id ?? '';
}

function vehicleLabel(vehicle) {
  return localized(vehicle.vehicleSpecification?.modelAndOption?.model?.modelDescription) ||
    localized(vehicle.vehicleSpecification?.modelAndOption?.model?.modelName) || localized(
    vehicle.model?.modelDescription ??
    vehicle.model?.description ??
    vehicle.model?.name ??
    vehicle.vehicleDescription ??
    ''
  );
}

function localized(value) {
  if (typeof value === 'string') return value;
  return value?.de_DE ?? value?.default_DE ?? value?.value ?? '';
}

function numberValue(value) {
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function vehicleBase(hit, index = 0) {
  const v = hit.vehicle ?? {};
  const address = v.ordering?.retailData?.locationOutletAddress ?? {};
  const dealerNumber = v.ordering?.retailData?.buNo ?? '';
  return {
    rank: index + 1, vssId: v.vssId ?? '', vin: v.ordering?.productionData?.vin17 ?? '',
    offerNumber: v.ordering?.retailData?.offerNumber ?? '', model: vehicleLabel(v),
    price: numberValue(v.price?.grossSalesPrice ?? v.pricing?.price?.value),
    dealer: localized(v.ordering?.distributionData?.destinationLocationDomesticDealerName) ||
      [dealerNumber ? `BMW Partner ${dealerNumber}` : '', address.town].filter(Boolean).join(', '),
    dealerNumber, postalCode: address.postalCode ?? '',
    detailUrl: `https://www.bmw.de/de-de/sl/gebrauchtwagen/details/${encodeURIComponent(v.vssId ?? '')}`,
  };
}

function buildSearchBody(args) {
  const context = {};
  const filters = decodeFilters(args.url);
  applyUrlFilters(context, filters);
  context.sfOfferCalculation = {
    productCategoryType: { value: ['LEASE'] },
  };
  return {
    searchContext: [context],
    resultsContext: { sort: [{ by: 'SF_OFFER_INSTALLMENT', order: 'ASC' }] },
    isMonthlyInstallmentFilterSelected: filters.IS_INSTALLMENT ?? true,
  };
}

function searchUrl(startIndex, pageSize = PAGE_SIZE) {
  const url = new URL(SEARCH_URL);
  url.searchParams.set('maxResults', String(pageSize));
  url.searchParams.set('startIndex', String(startIndex));
  return url.toString();
}

async function loadHits(args) {
  const body = buildSearchBody(args);
  const hits = [];
  const seen = new Set(), warnings = [];
  let expectedHits, rawHits = 0, pagesFetched = 0, changedCount = false;
  for (let startIndex = 0; ; ) {
    const page = await fetchJson(searchUrl(startIndex, args.pageSize ?? PAGE_SIZE), {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(body),
    });
    if (!Array.isArray(page.hits)) throw new Error('BMW search response is missing hits[]');
    const count = page.metadata?.totalCount ?? page.totalCount;
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('BMW search response has no valid totalCount');
    if (expectedHits != null && count !== expectedHits) changedCount = true;
    expectedHits ??= count;
    const pageHits = page.hits;
    const before = hits.length;
    for (const hit of pageHits) {
      const id = hit.vehicle?.vssId;
      if (!id) throw new Error('BMW search hit has no vssId');
      if (!seen.has(id)) { seen.add(id); hits.push(hit); }
    }
    rawHits += pageHits.length;
    pagesFetched++;
    console.error(`search ${hits.length}`);
    if (rawHits >= expectedHits || pageHits.length === 0 || hits.length === before ||
        (args.maxPages != null && pagesFetched >= args.maxPages)) break;
    startIndex += pageHits.length;
  }
  const duplicatesRemoved = rawHits - hits.length;
  if (duplicatesRemoved) warnings.push(`Removed ${duplicatesRemoved} duplicate BMW search hits`);
  if (changedCount) warnings.push('BMW result count changed during pagination; repeat the search');
  const complete = hits.length === expectedHits && !changedCount;
  if (!complete) warnings.push(`Incomplete BMW search: ${hits.length} distinct vehicles of ${expectedHits}; pages=${pagesFetched}${args.maxPages ? ', max-pages=' + args.maxPages : ''}`);
  return { hits, expectedHits, rawHits, pagesFetched, duplicatesRemoved, complete, warnings };
}

async function openFinance(hit) {
  const vehicle = hit.vehicle ?? {};
  const body = {
    context: {
      channel: 'STOCKLOCATOR',
      client: 'customer',
      brand: 'bmwCar',
      country: 'DE',
      language: 'de',
      buno: vehicle.ordering?.retailData?.buNo ?? '',
    },
    assetReference: {
      vssId: vehicle.vssId ?? '',
      vin: vehicle.ordering?.productionData?.vin17 ?? '',
    },
    externalReference: {
      offerIds: [vehicle.offering?.sfOffers?.[0]?.offerId ?? ''],
    },
    customer: { customerToken: '' },
    requestInfo: { requestType: 'NewPriceAndReferencesRequest' },
  };
  return fetchJson(OPEN_URL, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
}

async function recalculateLease(leaseRow, args) {
  const termUrl = new URL(DETAIL_URL);
  termUrl.searchParams.set('interactionId', leaseRow.interactionId);
  termUrl.searchParams.set('retentionPeriod', 'LONG');

  const termResponse = await fetchJson(termUrl.toString(), {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      externalReference: {
        selectedCalculation: leaseRow.calculationId,
        offerIds: [decodeOfferId(leaseRow.interactionId)],
      },
      changedParameters: {
        lastChangedParameter: 'term',
        changedParameters: [
          { key: 'term', value: String(args.term) },
          { key: 'annualMileage', value: String(args.mileage) },
        ],
      },
    }),
  });
  const termRow = termResponse.data ?? termResponse;

  const downUrl = new URL(DETAIL_URL);
  downUrl.searchParams.set('interactionId', termRow.interactionId ?? leaseRow.interactionId);
  downUrl.searchParams.set('retentionPeriod', 'LONG');

  const downResponse = await fetchJson(downUrl.toString(), {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      externalReference: {
        selectedCalculation: termRow.calculationId ?? leaseRow.calculationId,
        offerIds: [decodeOfferId(termRow.interactionId ?? leaseRow.interactionId)],
      },
      changedParameters: {
        lastChangedParameter: 'downPaymentAmount/grossAmount',
        changedParameters: [
          { key: 'term', value: String(args.term) },
          { key: 'annualMileage', value: String(args.mileage) },
          { key: 'downPaymentAmount/grossAmount', value: String(args.downPayment) },
        ],
      },
    }),
  });
  return downResponse.data ?? downResponse;
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function formatDe(value) {
  if (value == null || !Number.isFinite(value)) return 'n/a';
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function markdown(rows, summary) {
  const lines = [
    '# BMW Privatleasing', '', `Quelle: ${summary.sourceUrl}`, `Erstellt: ${summary.generatedAt}`,
    `Privat, brutto: ${summary.target.term} Monate, ${summary.target.annualMileage} km/Jahr, ${formatDe(summary.target.downPaymentGross)} EUR Sonderzahlung.`,
    `Suche: ${summary.fetchedHits}/${summary.expectedHits} Fahrzeuge; vollständig: ${summary.searchComplete ? 'ja' : 'nein'}.`,
    'Gesamtbetrag laut BMW-Leasingrechnung; zusätzliche Zulassungs- oder sonstige Händlerkosten können hinzukommen.', '',
    ...summary.warnings.map(w => `- ${w}`),
    ...summary.failures.map(f => `- ${f.vssId} (${f.customerType || 'Fahrzeug'}): ${f.error}`), '',
    '| # | Rate brutto | Gesamt brutto | Preis | Modell | Händler | PLZ | Auto |',
    '|---:|---:|---:|---:|---|---|:---:|---|',
  ];
  const escape = value => String(value ?? '').replaceAll('|', '\\|').replace(/[\r\n]/g, ' ');
  for (const row of rows) {
    lines.push(
      `| ${row.rank} | ${formatDe(row.monthlyGross)} EUR | ${formatDe(row.totalGross)} EUR | ${formatDe(
        row.price,
      )} EUR | ${escape(row.model)} | ${escape(row.dealer)} | ${row.postalCode || ''} | [anschauen](${row.detailUrl}) |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function quoteRow(base, leaseRow, calc, args) {
  const params = Array.isArray(calc.parameterValues) ? calc.parameterValues : [];
  const row = {
    ...base,
    customerType: calc.info?.customerType ?? leaseRow.info?.customerType ?? '',
    selectedCustomerType: calc.info?.selectedCustomerType ?? leaseRow.info?.selectedCustomerType ?? '',
    productName: String(calc.info?.productName ?? leaseRow.info?.productName ?? '').trim(),
    term: numberValue(currentValue(params, 'term')),
    annualMileage: numberValue(currentValue(params, 'annualMileage')),
    downPaymentNet: numberValue(currentValue(params, 'downPaymentAmount/netAmount')),
    downPaymentGross: numberValue(currentValue(params, 'downPaymentAmount/grossAmount')),
    monthlyNet: numberValue(currentValue(params, 'totalInstallment/netAmount')),
    monthlyGross: numberValue(currentValue(params, 'totalInstallment/grossAmount')),
    totalNet: numberValue(currentValue(params, 'sumOfAllTotalPayments/netAmount')),
    totalGross: numberValue(currentValue(params, 'sumOfAllTotalPayments/grossAmount')),
  };
  if (row.term !== args.term || row.annualMileage !== args.mileage || row.downPaymentGross == null ||
      Math.abs(row.downPaymentGross - args.downPayment) > 0.005) throw new Error('BMW returned different term, mileage or gross down payment');
  if (!['PRIVATE', 'BUSINESS'].includes(row.customerType)) throw new Error('BMW returned an unknown customer type');
  if (leaseRow.info?.customerType && row.customerType !== leaseRow.info.customerType) throw new Error('BMW returned a different customer type');
  if (row.downPaymentNet == null || row.downPaymentNet < 0 || row.monthlyGross == null || row.monthlyGross <= 0 ||
      row.totalGross == null || row.totalGross < row.monthlyGross) throw new Error('BMW returned missing or invalid quote amounts');
  return row;
}

async function priceVehicle(hit, index, args) {
  const base = vehicleBase(hit, index);
  const rows = [], issues = [];
  const fail = (error, lease) => issues.push({ vssId: base.vssId, customerType: lease?.info?.customerType ?? '', productName: lease?.info?.productName ?? '', error: safeError(error) });
  if (!base.model) fail('BMW search response has no model name');
  if (base.price == null || base.price <= 0) fail('BMW search response has no valid purchase price');
  try {
    const open = await openFinance(hit);
    if (!Array.isArray(open.data)) throw new Error('BMW finance response is missing data[]');
    const leases = open.data.filter(
      (row) => row?.info?.productBaseType === 'LEASE' || String(row?.info?.productType ?? '').includes('LEASE'),
    );
    if (!leases.length) fail('No leasing products returned');
    for (const leaseRow of leases) {
      try {
        const params = leaseRow.parameterValues;
        for (const [key, wanted] of [['term', args.term], ['annualMileage', args.mileage]]) {
          const values = getMeta(params, key, 'allowedValues');
          if (Array.isArray(values) && !values.map(Number).includes(wanted)) throw new Error(`${key}=${wanted} unavailable; allowed: ${values.join(',')}`);
        }
        const downRange = getMeta(params, 'downPaymentAmount/grossAmount', 'allowedRange');
        if (downRange && ((downRange.minimum != null && args.downPayment < downRange.minimum) ||
            (downRange.maximum != null && args.downPayment > downRange.maximum))) throw new Error('Gross down payment outside BMW allowed range');
        rows.push(quoteRow(base, leaseRow, await recalculateLease(leaseRow, args), args));
      } catch (error) { fail(error.message, leaseRow); }
    }
  } catch (error) { fail(error.message); }
  const privateQuoteCount = rows.filter(r => r.customerType === 'PRIVATE').length;
  if (!privateQuoteCount && !issues.some(i => i.customerType === 'PRIVATE' || !i.customerType)) fail('No valid private lease for the requested parameters');
  return { ...base, status: privateQuoteCount ? (issues.length ? 'partial' : 'ok') : 'unavailable', privateQuoteCount, issues, rows };
}

function selectPrivateRows(rows) {
  const chosen = new Map();
  for (const row of rows.filter(r => r.customerType === 'PRIVATE')) {
    const before = chosen.get(row.vssId);
    if (!before || row.monthlyGross < before.monthlyGross || (row.monthlyGross === before.monthlyGross && row.totalGross < before.totalGross)) chosen.set(row.vssId, row);
  }
  return [...chosen.values()].sort((a, b) => a.monthlyGross - b.monthlyGross || a.totalGross - b.totalGross || a.vssId.localeCompare(b.vssId))
    .map((row, index) => ({ ...row, searchRank: row.rank, rank: index + 1 }));
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) { console.log(usage()); return; }
  timeoutMs = args.timeoutMs;
  HEADERS['x-api-key'] = await bootstrapApiKey();
  const search = await loadHits(args);
  const results = await mapLimit(search.hits, CONCURRENCY, (hit, index) => priceVehicle(hit, index, args));
  const rows = results.flatMap(r => r.rows), failures = results.flatMap(r => r.issues);
  const privateRows = selectPrivateRows(rows);
  const warnings = [...search.warnings];
  if (!search.hits.length) warnings.push('BMW returned no vehicles for this filter');
  const complete = search.complete && failures.length === 0 && privateRows.length === search.hits.length;
  const summary = {
    sourceUrl: args.url, generatedAt: new Date().toISOString(), complete,
    searchComplete: search.complete, expectedHits: search.expectedHits, fetchedHits: search.hits.length,
    pagesFetched: search.pagesFetched, duplicatesRemoved: search.duplicatesRemoved,
    rawQuoteRows: rows.length, validQuoteRows: rows.length, privateRows: privateRows.length, failures, warnings,
    target: { term: args.term, annualMileage: args.mileage, downPaymentGross: args.downPayment, customerType: 'PRIVATE', currency: 'EUR', gross: true },
    rows, privateQuotes: privateRows, vehicleResults: results.map(({ rows, ...result }) => result),
  };
  await mkdir(args.out, { recursive: true });
  const jsonPath = path.join(args.out, 'bmw-lease-rates.json'), mdPath = path.join(args.out, 'bmw-lease-rates.md');
  await writeFile(jsonPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  await writeFile(mdPath, markdown(privateRows, summary), 'utf8');
  console.log(JSON.stringify({ fetchedHits: summary.fetchedHits, expectedHits: summary.expectedHits, complete, searchComplete: search.complete,
    validQuoteRows: rows.length, privateRows: privateRows.length, failures: failures.length, warnings, jsonPath, mdPath, cheapestPrivate: privateRows[0] ?? null }, null, 2));
  if (!complete) process.exitCode = 2;
  return summary;
}

export { parseArgs, parseMoney, validateUrl, decodeFilters, applyUrlFilters, buildSearchBody, vehicleBase, quoteRow,
  selectPrivateRows, loadHits, priceVehicle, recalculateLease, bootstrapApiKey, HEADERS, fetchText, fetchJson, formatDe, markdown, main };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(safeError(error.message)); process.exitCode = 1; });
}
