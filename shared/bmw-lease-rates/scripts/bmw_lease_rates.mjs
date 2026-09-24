#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PAGE_SIZE = 12;
const CONCURRENCY = 4;

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

function parseArgs(argv) {
  const args = { term: 36, mileage: 10000, downPayment: 0, out: '.' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--url') args.url = next, i += 1;
    else if (arg === '--term') args.term = Number(next), i += 1;
    else if (arg === '--mileage') args.mileage = Number(next), i += 1;
    else if (arg === '--down-payment') args.downPayment = Number(next), i += 1;
    else if (arg === '--out') args.out = next, i += 1;
    else if (arg === '--help') args.help = true;
  }
  return args;
}

function usage() {
  return `Usage:
node scripts/bmw_lease_rates.mjs --url "<BMW_URL>" [--term 36] [--mileage 10000] [--down-payment 0] [--out .]`;
}

// The stocklocator API key is public: BMW serves it to every visitor inside the
// server-rendered page config. One plain GET replaces the former browser capture.
// The key rotates and must stay in memory only — never log or persist it.
async function bootstrapApiKey() {
  const response = await fetch(BOOTSTRAP_URL, {
    headers: { 'User-Agent': HEADERS['User-Agent'], Accept: '*/*' },
  });
  if (!response.ok) throw new Error(`bootstrap page HTTP ${response.status}`);
  const html = (await response.text()).replaceAll('&quot;', '"');
  const apiKey = html.match(/"apiKey"\s*:\s*"([0-9a-f]{40,})"/)?.[1];
  if (!apiKey) throw new Error('apiKey not found in bootstrap page config');
  return apiKey;
}

async function fetchJson(url, options, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, options);
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError;
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
  if (!encoded) return null;
  return JSON.parse(decodeURIComponent(encoded));
}

const MAPPED_FILTER_KEYS = new Set([
  'MARKETING_MODEL_RANGE',
  'COLOR',
  'PAINT_TYPE',
  'PERFORMANCE',
  'EQUIPMENT_GROUPS',
  'PRODUCT_CATEGORY_TYPE',
  'IS_INSTALLMENT',
]);

function applyUrlFilters(searchContext, filters) {
  if (!filters) return;
  for (const key of Object.keys(filters)) {
    if (!MAPPED_FILTER_KEYS.has(key)) {
      console.error(`warning: URL filter ${key} is not mapped and will be ignored`);
    }
  }
  if (filters.MARKETING_MODEL_RANGE) {
    searchContext.model ??= {};
    searchContext.model.marketingModelRange = { value: filters.MARKETING_MODEL_RANGE };
  }
  if (filters.COLOR) searchContext.colorClusterRough = { value: filters.COLOR };
  if (filters.PAINT_TYPE) searchContext.paintType = { value: filters.PAINT_TYPE };
  if (filters.PERFORMANCE) {
    searchContext.technicalData ??= {};
    searchContext.technicalData.powerBasedOnDegreeOfElectrificationKw = [{ minValue: filters.PERFORMANCE[0] }];
  }
  if (filters.EQUIPMENT_GROUPS) {
    searchContext.categorizedOptionGroups = Object.entries(filters.EQUIPMENT_GROUPS).map(([category, value]) => ({
      category,
      operator: 'AND',
      value,
    }));
  }
}

function decodeOfferId(interactionId) {
  if (!interactionId) return '';
  return JSON.parse(Buffer.from(interactionId, 'base64').toString('utf8')).id ?? '';
}

function vehicleLabel(vehicle) {
  return (
    vehicle.model?.modelDescription ??
    vehicle.model?.description ??
    vehicle.model?.name ??
    vehicle.vehicleDescription ??
    ''
  );
}

function buildSearchBody(args) {
  const context = {};
  applyUrlFilters(context, decodeFilters(args.url));
  context.sfOfferCalculation = {
    productCategoryType: { value: ['LEASE'] },
  };
  return {
    searchContext: [context],
    resultsContext: { sort: [{ by: 'SF_OFFER_INSTALLMENT', order: 'ASC' }] },
    isMonthlyInstallmentFilterSelected: true,
  };
}

function searchUrl(startIndex) {
  const url = new URL(SEARCH_URL);
  url.searchParams.set('maxResults', String(PAGE_SIZE));
  url.searchParams.set('startIndex', String(startIndex));
  return url.toString();
}

async function loadHits(args) {
  const body = buildSearchBody(args);
  const hits = [];
  for (let startIndex = 0; ; startIndex += PAGE_SIZE) {
    const page = await fetchJson(searchUrl(startIndex), {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(body),
    });
    const pageHits = Array.isArray(page.hits) ? page.hits : [];
    hits.push(...pageHits);
    console.error(`search ${hits.length}`);
    if (pageHits.length < PAGE_SIZE) break;
  }
  return hits;
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
          { key: 'downPaymentAmount/netAmount', value: String(args.downPayment) },
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
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function markdown(rows) {
  const lines = [
    '| # | Rate brutto | Gesamt brutto | Preis | PLZ | Auto |',
    '|---:|---:|---:|---:|:---:|---|',
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.rank} | ${formatDe(row.monthlyGross)} EUR | ${formatDe(row.totalGross)} EUR | ${formatDe(
        row.price,
      )} EUR | ${row.postalCode || ''} | [anschauen](${row.detailUrl}) |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.url) {
  console.log(usage());
  process.exit(args.help ? 0 : 1);
}

HEADERS['x-api-key'] = await bootstrapApiKey();
console.error('bootstrap ok');

const hits = await loadHits(args);
const rows = [];
const failures = [];

await mapLimit(hits, CONCURRENCY, async (hit, index) => {
  const vehicle = hit.vehicle ?? {};
  const base = {
    rank: index + 1,
    vssId: vehicle.vssId ?? '',
    vin: vehicle.ordering?.productionData?.vin17 ?? '',
    offerNumber: vehicle.ordering?.retailData?.offerNumber ?? '',
    model: vehicleLabel(vehicle),
    price: vehicle.pricing?.price?.value ?? null,
    dealer: vehicle.ordering?.distributionData?.destinationLocationDomesticDealerName ?? '',
    postalCode: vehicle.ordering?.retailData?.locationOutletAddress?.postalCode ?? '',
    detailUrl: `https://www.bmw.de/de-de/sl/gebrauchtwagen/details/${vehicle.vssId ?? ''}`,
  };
  try {
    const open = await openFinance(hit);
    const leases = (Array.isArray(open.data) ? open.data : []).filter(
      (row) => row?.info?.productBaseType === 'LEASE' || String(row?.info?.productType ?? '').includes('LEASE'),
    );
    for (const leaseRow of leases) {
      const params = Array.isArray(leaseRow.parameterValues) ? leaseRow.parameterValues : [];
      const termOptions = getMeta(params, 'term', 'allowedValues') ?? [];
      const mileageOptions = getMeta(params, 'annualMileage', 'allowedValues') ?? [];
      const downRangeNet = getMeta(params, 'downPaymentAmount/netAmount', 'allowedRange');
      const downRangeGross = getMeta(params, 'downPaymentAmount/grossAmount', 'allowedRange');
      if (!termOptions.includes(args.term)) continue;
      if (!mileageOptions.includes(args.mileage)) continue;
      if (!(typeof downRangeNet?.minimum === 'number' && downRangeNet.minimum <= args.downPayment)) continue;
      if (!(typeof downRangeGross?.minimum === 'number' && downRangeGross.minimum <= args.downPayment)) continue;

      const calc = await recalculateLease(leaseRow, args);
      const calcParams = Array.isArray(calc.parameterValues) ? calc.parameterValues : [];
      rows.push({
        ...base,
        customerType: calc.info?.customerType ?? leaseRow.info?.customerType ?? '',
        selectedCustomerType: calc.info?.selectedCustomerType ?? leaseRow.info?.selectedCustomerType ?? '',
        productName: String(calc.info?.productName ?? leaseRow.info?.productName ?? '').trim(),
        term: Number(currentValue(calcParams, 'term')),
        annualMileage: Number(currentValue(calcParams, 'annualMileage')),
        downPaymentNet: Number(currentValue(calcParams, 'downPaymentAmount/netAmount')),
        downPaymentGross: Number(currentValue(calcParams, 'downPaymentAmount/grossAmount')),
        monthlyNet: Number(currentValue(calcParams, 'totalInstallment/netAmount')),
        monthlyGross: Number(currentValue(calcParams, 'totalInstallment/grossAmount')),
        totalNet: Number(currentValue(calcParams, 'sumOfAllTotalPayments/netAmount')),
        totalGross: Number(currentValue(calcParams, 'sumOfAllTotalPayments/grossAmount')),
      });
    }
    console.error(`priced ${index + 1}/${hits.length}`);
  } catch (error) {
    failures.push({ ...base, error: error.message });
    console.error(`failed ${index + 1}/${hits.length} ${base.vssId}: ${error.message}`);
  }
});

const validRows = rows.filter(
  (row) =>
    row.term === args.term &&
    row.annualMileage === args.mileage &&
    row.downPaymentGross === args.downPayment,
);
const privateRows = validRows
  .filter((row) => row.customerType === 'PRIVATE')
  .sort((a, b) => a.rank - b.rank);

await mkdir(args.out, { recursive: true });
const jsonPath = path.join(args.out, 'bmw-lease-rates.json');
const mdPath = path.join(args.out, 'bmw-lease-rates.md');
const summary = {
  fetchedHits: hits.length,
  rawQuoteRows: rows.length,
  validQuoteRows: validRows.length,
  privateRows: privateRows.length,
  failures,
  target: {
    term: args.term,
    annualMileage: args.mileage,
    downPaymentGross: args.downPayment,
  },
  rows: validRows,
};

await writeFile(jsonPath, JSON.stringify(summary, null, 2), 'utf8');
await writeFile(mdPath, markdown(privateRows), 'utf8');

console.log(
  JSON.stringify(
    {
      fetchedHits: hits.length,
      validQuoteRows: validRows.length,
      privateRows: privateRows.length,
      failures: failures.length,
      jsonPath,
      mdPath,
      cheapestPrivate: [...privateRows].sort((a, b) => a.monthlyGross - b.monthlyGross)[0] ?? null,
    },
    null,
    2,
  ),
);
