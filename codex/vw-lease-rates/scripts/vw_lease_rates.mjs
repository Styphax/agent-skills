#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PAGE_SIZE = 12;
const DEFAULT_PREFIX = "vw-lease-rates";
const DEFAULT_WEBCALC_CONCURRENCY = 4;
const DEFAULT_WEBCALC_ENDPOINT = "https://api.webcalc.vwfs.io/webcalc-frontend-service";
let timeoutMs = 30000;
const sensitiveValues = new Set();

const USAGE = `
Usage:
  node vw_lease_rates.mjs --url "<VW_SEARCH_URL>" [options]

Options:
  --url <url>             Volkswagen.de search URL. Required.
  --term <months>         Lease term in months. Default: 36.
  --terms <list|range>    Lease terms, e.g. 24,30,36 or 24-36. VWFS range step is 6 months.
  --mileage <km>          Annual mileage. Default: 10000.
  --down-payment <eur>    Down payment in EUR. Default: 0.
  --out <dir>             Output directory. Default: current directory.
  --page-size <n>         Search page size. Default: 12.
  --max-pages <n>         Limit pages for testing.
  --no-webcalc            Do not calculate VWFS WebCalc leasing rates.
  --webcalc-concurrency <n>
                           Parallel WebCalc requests. Default: 4.
  --prefix <name>         Output file prefix. Default: vw-lease-rates.
  --timeout-ms <n>        Timeout per HTTP attempt. Default: 30000; 2 retries.
  --help                  Show this help.

Exit codes: 0 complete; 2 partial search or unavailable quotes; 1 fatal error.
`;

function parseArgs(argv) {
  const args = {
    downPayment: 0,
    maxPages: null,
    mileage: 10000,
    out: process.cwd(),
    pageSize: DEFAULT_PAGE_SIZE,
    prefix: DEFAULT_PREFIX,
    term: 36,
    url: null,
    useWebCalc: true,
    webCalcConcurrency: DEFAULT_WEBCALC_CONCURRENCY,
    timeoutMs: 30000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--help" || flag === "-h") {
      args.help = true;
      continue;
    }
    if (flag === "--no-webcalc") {
      args.useWebCalc = false;
      continue;
    }

    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    i += 1;

    switch (flag) {
      case "--url":
        args.url = value;
        break;
      case "--term":
        args.term = toPositiveInteger(value, "term");
        break;
      case "--terms":
        args.terms = parseTerms(value);
        break;
      case "--mileage":
        args.mileage = toPositiveInteger(value, "mileage");
        break;
      case "--down-payment":
        args.downPayment = parseMoney(value);
        break;
      case "--out":
        args.out = value;
        break;
      case "--page-size":
        args.pageSize = toPositiveInteger(value, "page-size");
        break;
      case "--max-pages":
        args.maxPages = toPositiveInteger(value, "max-pages");
        break;
      case "--prefix":
        if (!/^[\w-]+$/.test(value)) throw new Error("prefix must be a filename without path separators");
        args.prefix = value;
        break;
      case "--timeout-ms":
        args.timeoutMs = toPositiveInteger(value, "timeout-ms");
        break;
      case "--webcalc-concurrency":
        args.webCalcConcurrency = toPositiveInteger(value, "webcalc-concurrency");
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }

  if (!args.help && !args.url) {
    throw new Error("--url is required");
  }
  args.terms = args.terms || [args.term];
  args.term = args.terms.includes(args.term) ? args.term : args.terms.at(-1);
  if (!args.help) validateUrl(args.url);

  return args;
}

function toPositiveInteger(value, name) {
  const parsed = Number(value);
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseMoney(value) {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(String(value))) throw new Error("down-payment must be a nonnegative EUR amount without thousands separators");
  const amount = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(amount) || !Number.isSafeInteger(Math.round(amount * 100))) throw new Error("Invalid down-payment");
  return amount;
}

function validateUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || !['www.volkswagen.de', 'volkswagen.de'].includes(url.hostname) || url.username || url.password || url.port ||
      !/\/verfuegbare-fahrzeuge-suche\.html(?:\/.*)?$/.test(url.pathname) || url.hash) throw new Error('Expected an HTTPS Volkswagen.de vehicle search URL');
  return url;
}

function parseAmount(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let normalized = String(value).trim().replace(/(?:EUR|€)/gi, '').replace(/[\s\u00a0]/g, '');
  if (!/^-?\d[\d.,]*$/.test(normalized)) return null;
  if (normalized.includes(',') && normalized.includes('.')) {
    if (/^-?\d{1,3}(?:\.\d{3})*,\d{1,2}$/.test(normalized)) normalized = normalized.replaceAll('.', '').replace(',', '.');
    else if (/^-?\d{1,3}(?:,\d{3})*\.\d{1,2}$/.test(normalized)) normalized = normalized.replaceAll(',', '');
    else return null;
  } else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(normalized)) normalized = normalized.replaceAll('.', '');
  else if (/^-?\d{1,3}(?:,\d{3})+$/.test(normalized)) normalized = normalized.replaceAll(',', '');
  else if (/^-?\d+(?:[.,]\d{1,2})?$/.test(normalized)) normalized = normalized.replace(',', '.');
  else return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIntegerAmount(value) {
  const amount = parseAmount(value);
  return amount == null ? null : Math.round(amount);
}

function parseTerms(value) {
  const raw = String(value || "").trim();
  const range = raw.match(/^(\d+)\s*-\s*(\d+)$/);
  if (range) {
    const start = toPositiveInteger(range[1], "terms range start");
    const end = toPositiveInteger(range[2], "terms range end");
    if (end < start || (end - start) % 6 !== 0 || end - start > 600) throw new Error("terms range must end on a 6-month step and span at most 600 months");
    const out = [];
    for (let term = start; term <= end; term += 6) out.push(term);
    return out;
  }

  const terms = raw
    .split(",")
    .map((part) => part.trim())
    .map((part) => toPositiveInteger(part, "terms"));
  if (terms.length === 0) throw new Error("--terms must include at least one term");
  return [...new Set(terms)].sort((a, b) => a - b);
}

function safeError(value) {
  let text = String(value).replace(/([?&](?:oneapiKey|apiKey)=)[^&\s]*/gi, '$1[redacted]');
  for (const secret of sensitiveValues) text = text.replaceAll(secret, '[redacted]');
  return text;
}

async function fetchText(url, options = {}, retries = 2) {
  let lastError;
  const target = new URL(url);
  for (const name of ['oneapiKey', 'apiKey']) if (target.searchParams.get(name)) sensitiveValues.add(target.searchParams.get(name));
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs), headers: {
        accept: 'application/json,text/html;q=0.9,*/*;q=0.8', 'accept-language': 'de-DE,de;q=0.9,en;q=0.7',
        'user-agent': 'Mozilla/5.0 Chrome/145 Safari/537.36', ...options.headers,
      } });
      const text = await response.text();
      if (!response.ok) {
        const error = new Error(`${options.method || 'GET'} ${target.origin}${target.pathname} failed with ${response.status}: ${safeError(text).slice(0,500)}`);
        error.retryable = [408,429].includes(response.status) || response.status >= 500;
        throw error;
      }
      return text;
    } catch (error) {
      lastError = new Error(safeError(error.message));
      if (error.retryable === false) break;
      if (attempt < retries) await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function fetchJson(url, options) {
  const text = await fetchText(url, options);
  try { return JSON.parse(text); }
  catch { throw new Error(`Invalid JSON at ${new URL(url).pathname}`); }
}

async function postJson(url, body) {
  return fetchJson(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', referer: 'https://www.volkswagen.de/' } });
}

function parseInstanceConfig(html) {
  const match = html.match(/"instanceConfig":"((?:\\.|[^"\\])*)"/);
  if (!match) return null;

  try {
    const decoded = JSON.parse(`"${match[1]}"`);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function parseFeatureAppBaseUrl(html) {
  const match = html.match(/"baseUrl":"(https:\/\/[^"]*gsl\.feature-app\.io)"/);
  return match ? match[1] : null;
}

async function resolveRuntimeConfig(searchUrl) {
  const html = await fetchText(searchUrl.href);
  const instanceConfig = parseInstanceConfig(html) || {};

  const configUrls = [
    new URL("/de.global-config.json", searchUrl.origin),
    new URL(`/de.global-config.json${searchUrl.search}`, searchUrl.origin),
  ];

  let globalConfig = null;
  let lastError = null;
  for (const configUrl of configUrls) {
    try {
      globalConfig = await fetchJson(configUrl.href);
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!globalConfig) {
    throw lastError || new Error("Could not fetch Volkswagen global config");
  }

  const baseUrl = instanceConfig.baseUrl || parseFeatureAppBaseUrl(html);
  if (!baseUrl) throw new Error('Volkswagen page did not include the current search service URL');
  const spaConfig = globalConfig.spaAsyncConfig || {};
  const oneApiKey = spaConfig.oneApiConfiguration?.apiKey;
  const endpoint = spaConfig.serviceConfigEndpoint?.endpoint;

  if (!oneApiKey || !endpoint) {
    throw new Error("Volkswagen global config did not include oneApiKey and service endpoint");
  }
  sensitiveValues.add(oneApiKey);

  return {
    baseUrl,
    endpoint,
    instanceConfig,
    oneApiKey,
  };
}

function buildSearchParams(searchUrl, page, args, runtimeConfig) {
  const params = new URLSearchParams();
  const ignored = new Set(["pageIndex", "page", "viewMode", "priceMode"]);

  for (const [rawKey, value] of searchUrl.searchParams.entries()) {
    const key = rawKey.endsWith("-app") ? rawKey.slice(0, -4) : rawKey;
    if (ignored.has(key)) continue;
    if (rawKey === "---") continue;
    params.append(key, value);
  }

  params.set("pageitems", String(args.pageSize));
  params.set("page", String(page));
  params.set("country", "DE");
  params.set("language", "de");
  params.set("market", "passenger");
  params.set("oneapiKey", runtimeConfig.oneApiKey);
  params.set("endpoint", JSON.stringify(runtimeConfig.endpoint));
  return params;
}

async function fetchAllCars(searchUrl, runtimeConfig, args) {
  const allCars = [];
  const pageMetas = [];
  let page = 1;
  let pageMax = 1;
  const seen = new Set(), warnings = [];
  let expected = null, rawCars = 0, changedCount = false;

  while (true) {
    const bffUrl = new URL("/bff/car/search", runtimeConfig.baseUrl);
    bffUrl.search = buildSearchParams(searchUrl, page, args, runtimeConfig).toString();
    const data = await fetchJson(bffUrl.href);

    if (!Array.isArray(data.cars)) {
      throw new Error(`Volkswagen BFF response for page ${page} did not include cars[]`);
    }

    const count = Number(data.meta?.resultNumber);
    const max = Number(data.meta?.pageMax);
    if (data.meta?.resultNumber == null || !Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(max) || max < 0 || (count > 0 && max < 1)) throw new Error('VW search response has invalid resultNumber/pageMax');
    if (expected != null && expected !== count) changedCount = true;
    expected ??= count;
    const before = allCars.length;
    for (const car of data.cars) {
      if (!car.key) throw new Error('VW search result has no vehicle key');
      if (!seen.has(car.key)) { seen.add(car.key); allCars.push(car); }
    }
    rawCars += data.cars.length;
    pageMetas.push(data.meta || {});
    pageMax = max;

    const hitMaxPages = args.maxPages != null && page >= args.maxPages;
    if (page >= pageMax || hitMaxPages || !data.cars.length || allCars.length === before) break;
    page += 1;
  }

  const duplicatesRemoved = rawCars - allCars.length;
  const complete = allCars.length === expected && !changedCount;
  if (duplicatesRemoved) warnings.push(`Removed ${duplicatesRemoved} duplicate VW search hits`);
  if (changedCount) warnings.push('VW result count changed during pagination; repeat the search');
  if (!complete) warnings.push(`Incomplete VW search: ${allCars.length} distinct vehicles of ${expected}; pages=${pageMetas.length}${args.maxPages ? ', max-pages=' + args.maxPages : ''}`);
  return {
    cars: allCars,
    meta: pageMetas.at(-1) || {},
    pageMetas,
    pagesFetched: pageMetas.length,
    complete, warnings, duplicatesRemoved, expected,
  };
}

function valueOf(value) {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return value.value ?? value.label ?? value.text ?? value.name ?? null;
}

function batteryItem(car, key) {
  const items = Array.isArray(car.batteryCapacityAndRange) ? car.batteryCapacityAndRange : [];
  return items.find((item) => item.key === key) || null;
}

function asDateOnly(value) {
  const raw = valueOf(value);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toISOString().slice(0, 10);
}

function detailUrl(car, searchUrl) {
  if (car.key && searchUrl) {
    const url = new URL(searchUrl.href);
    const base = url.pathname.split('/__app/')[0].replace(/\/$/, '');
    url.pathname = `${base}/__app/search/car/${encodeURIComponent(car.key)}.app`;
    url.searchParams.delete('pageIndex-app');
    url.searchParams.delete('page-app');
    return url.href;
  }
  if (car.oneShopLink) return car.oneShopLink;
  return null;
}

function structuredCampaigns(car, type) {
  return (Array.isArray(car.campaigns) ? car.campaigns : [])
    .filter((campaign) => campaign.type === type)
    .map((campaign) => ({
      end: campaign.end || null,
      key: campaign.key || null,
      label: campaign.ui?.label || campaign.ui?.filterText || null,
      start: campaign.start || null,
    }));
}

function dealerId(car) {
  const hid = valueOf(car.dealer?.hid);
  if (hid) return hid.replace(/\D/g, "") || hid;
  const key = valueOf(car.dealer?.key);
  if (!key) return null;
  return key.replace(/^DEU/i, "").replace(/\D/g, "") || key;
}

function modelYear(car) {
  return valueOf(car.modelyear) || valueOf(car.modelYear) || null;
}

function modelCode(car) {
  return car.model?.mbv?.code || car.model?.code || valueOf(car.model?.mbv) || null;
}

function grossPrice(car) {
  return parseAmount(car.parsedPrice?.value ?? car.parsedPrice?.label);
}

function listPrice(car) {
  return parseAmount(car.parsedPrice?.list?.value ?? car.parsedPrice?.list?.label);
}

function mileageKm(car) {
  return parseIntegerAmount(car.mileage?.raw_value ?? car.mileage?.value);
}

function productionYear(car) {
  const date = asDateOnly(car.dateproduction);
  return date ? date.slice(0, 4) : null;
}

function previousUsage(car) {
  const typeCode = car.cartype?.code || car.carType?.code;
  const typeLabel = valueOf(car.cartype) || car.carTypeLabel || "";
  if (typeCode === "Y" || /junge/i.test(typeLabel)) return "OneYearOld";
  return null;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry != null && entry !== ""));
}

function webCalcPayloads(car, args, term) {
  const price = grossPrice(car);
  const key = modelCode(car);
  const year = modelYear(car);
  const regDate = asDateOnly(car.initialreg);
  const vin = car.vin || null;
  if (!price || !key || !year || !regDate || !vin) return [];

  const product = {
    "@ID": "PL",
    Parameter: [
      { "@ID": "Duration", "#text": String(term) },
      { "@ID": "Mileage", "#text": String(args.mileage) },
      { "@ID": "DownPayment", "#text": String(args.downPayment) },
    ],
  };

  const oneShopVehicle = compactObject({
    "@Type": "Used",
    Key: key,
    PriceModel: price.toFixed(2),
    PriceTotal: price.toFixed(2),
    RegDateFirst: regDate,
    VehicleId: vin,
    Year: year,
  });

  const dealer = dealerId(car);
  const vtpVehicle = compactObject({
    "@Type": "Used",
    ID: car.key || null,
    Key: key,
    Mileage: mileageKm(car) == null ? null : String(mileageKm(car)),
    PreviousUsage: previousUsage(car),
    PriceModel: String(price),
    PriceOriginal: listPrice(car) == null ? null : String(listPrice(car)),
    PriceTotal: String(price),
    ProductionYear: productionYear(car),
    RegDateFirst: regDate,
    VehicleId: vin,
    Year: year,
  });

  const oneShopRequest = {
    Request: {
      "@Culture": "de-DE",
      "@Domain": "VW.ONESHOP.ECOM.DE",
      "@Name": "CalculateRate",
      Product: product,
      Vehicle: oneShopVehicle,
    },
  };

  const vtpRequest =
    dealer && car.key
      ? {
          Request: {
            "@Culture": "de-DE",
            "@Domain": "VW.USEDCARS.VTP",
            "@Name": "CalculateRate",
            Dealer: { ID: dealer },
            Product: product,
            Vehicle: vtpVehicle,
          },
        }
      : null;

  const preferOneShop = car.buyOnlineType === "oneshop" || Boolean(car.oneShopLink);
  return preferOneShop
    ? [oneShopRequest, vtpRequest].filter(Boolean)
    : [vtpRequest, oneShopRequest].filter(Boolean);
}

function firstArray(value) {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function extractWebCalcRate(response) {
  const root = response.Response || response;
  const payments = firstArray(root.Payment);
  const ratePayment = payments.find((item) => item?.["@ID"] === "Rate");
  const paymentRate = parseAmount(ratePayment?.Value?.["@Value"] ?? ratePayment?.Value?.["#text"]);
  if (paymentRate != null) return paymentRate;

  for (const result of firstArray(root.Result)) {
    const rate = parseAmount(result?.Calculation?.Rate);
    if (rate != null) return rate;
  }

  const summaries = firstArray(root.Result?.Summaries?.Summary);
  for (const summary of summaries) {
    const details = firstArray(summary?.DetailGroups?.DetailGroup?.Details?.Detail);
    const rateDetail = details.find((item) => item?.["@ID"] === "Rate");
    const rate = parseAmount(rateDetail?.Value?.["@Value"] ?? rateDetail?.Value);
    if (rate != null) return rate;
  }

  return null;
}

function webCalcError(response) {
  const root = response.Response || response;
  return root.Error?.Description || root.Error?.["@Code"] || null;
}

function verifyWebCalcParameters(response, args, term) {
  const root = response.Response || response;
  const evidence = { termMonths: [], annualMileage: [], downPaymentGross: [] };
  const add = (key, value) => {
    if (value != null) evidence[key].push(parseAmount(value));
  };
  const ids = { Duration: 'termMonths', Mileage: 'annualMileage', DownPayment: 'downPaymentGross' };
  for (const product of firstArray(root.Product)) {
    if (product?.['@ID'] && product['@ID'] !== 'PL') throw new Error('WebCalc returned a different finance product');
    for (const p of firstArray(product?.Parameter)) {
      if (ids[p?.['@ID']]) add(ids[p['@ID']], p['#text'] ?? p.Value?.['@Value'] ?? p.Value?.['#text'] ?? p['@Value']);
    }
  }
  for (const p of firstArray(root.Payment)) if (p?.['@ID'] === 'DownPayment') add('downPaymentGross', p.Value?.['@Value'] ?? p.Value?.['#text']);
  for (const name of ['CalculationDisclaimer', 'RateDetails']) {
    const block = root.Disclaimers?.[name];
    const text = typeof block === 'string' ? block : block?.['#cdata-section'] ?? block?.['#text'] ?? '';
    const duration = text.match(/Laufzeit\s+(\d+)\s+Monate/i) ?? text.match(/(?:bei\s+)?(\d+)\s+Monaten?\s+Laufzeit/i);
    const mileage = text.match(/Fahrleistung\s+([\d.]+)\s*km/i) ?? text.match(/([\d.]+)\s*km\s+j[aä]hrl/i);
    const down = text.match(/Sonderzahlung\s+(?:von\s+)?([\d.,]+)\s*(?:EUR|€)/i);
    if (duration) add('termMonths', duration[1]);
    if (mileage) add('annualMileage', mileage[1]);
    if (down) add('downPaymentGross', down[1]);
  }
  const requested = { termMonths: term, annualMileage: args.mileage, downPaymentGross: args.downPayment };
  for (const [key, wanted] of Object.entries(requested)) {
    if (!evidence[key].length) throw new Error(`WebCalc response does not confirm ${key}`);
    if (evidence[key].some(value => value == null || Math.abs(value - wanted) > 0.005)) throw new Error(`WebCalc returned different ${key}; requested ${wanted}`);
  }
  return { ...requested, verified: true };
}

function totalGross(monthlyGross, termMonths, downPaymentGross) {
  if (monthlyGross == null || termMonths == null) return null;
  return (Math.round(monthlyGross * 100) * termMonths + Math.round((downPaymentGross || 0) * 100)) / 100;
}

async function fetchWebCalcRate(car, args, term = args.term) {
  const requests = webCalcPayloads(car, args, term);
  if (requests.length === 0) {
    return { error: "Missing required WebCalc vehicle fields", monthlyGross: null, source: null, termMonths: term, totalGross: null };
  }

  const errors = [];
  for (const request of requests) {
    try {
      const response = await postJson(DEFAULT_WEBCALC_ENDPOINT, request);
      const error = webCalcError(response);
      if (error) throw new Error(error);
      const rate = extractWebCalcRate(response);
      if (rate != null && rate > 0) {
        const confirmedParameters = verifyWebCalcParameters(response, args, term);
        return {
          domain: request.Request["@Domain"],
          error: null,
          monthlyGross: rate,
          source: `webcalc.${request.Request["@Domain"]}.PL.CalculateRate`,
          termMonths: term,
          totalGross: totalGross(rate, term, args.downPayment),
          confirmedParameters,
        };
      }
      errors.push(`${request.Request["@Domain"]}: WebCalc returned no positive Rate payment`);
    } catch (error) {
      errors.push(`${request.Request["@Domain"]}: ${safeError(error.message)}`);
    }
  }

  return {
    error: errors.join("; ") || "WebCalc returned no Rate payment",
    monthlyGross: null,
    source: null,
    termMonths: term,
    totalGross: null,
  };
}

async function fetchWebCalcTermRates(car, args) {
  const results = [];
  for (const term of args.terms) {
    results.push(await fetchWebCalcRate(car, args, term));
  }
  return results;
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function normalizeCar(car, index, args, searchUrl) {
  const range = batteryItem(car, "electric-range");
  const capacity = batteryItem(car, "battery-capacity");
  const charging = batteryItem(car, "battery-charging-dc-max-10-80");
  const leasingCampaigns = structuredCampaigns(car, "LEASING");
  const financingCampaigns = structuredCampaigns(car, "FINANCING");

  return {
    annualMileage: args.mileage,
    batteryKwh: parseAmount(capacity?.raw_value ?? capacity?.text),
    carType: valueOf(car.cartype),
    carid: car.carid || null,
    dcCharging10To80: charging?.text || null,
    dealerCity: valueOf(car.dealer?.city),
    dealerName: valueOf(car.dealer?.name),
    dealerZip: valueOf(car.dealer?.zip),
    detailUrl: detailUrl(car, searchUrl),
    downPaymentGross: args.downPayment,
    financingCampaigns,
    firstRegistration: asDateOnly(car.initialreg),
    grossPrice: grossPrice(car),
    isLeasing: Boolean(car.isLeasing),
    leasingCampaigns,
    mileageKm: parseIntegerAmount(car.mileage?.raw_value ?? car.mileage?.value),
    monthlyGross: null,
    totalGross: null,
    paymentOptions: Array.isArray(car.paymentOptions) ? car.paymentOptions : [],
    powerKw: parseIntegerAmount(car.motor?.powerKw?.value),
    powerPs: parseIntegerAmount(car.motor?.powerPs?.value),
    rank: index + 1,
    rangeKm: parseIntegerAmount(range?.raw_value ?? range?.text),
    rateSource: null,
    subtitle: valueOf(car.subtitle),
    termRates: [],
    termMonths: args.term,
    title: car.title || valueOf(car.model) || null,
    vehicleKey: car.key || null,
    vin: car.vin || null,
  };
}

function formatEuro(value, digits = 0) {
  if (value == null) return "n/a";
  return new Intl.NumberFormat("de-DE", {
    currency: "EUR",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
    style: "currency",
  }).format(value);
}

function formatNumber(value) {
  if (value == null) return "";
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(value);
}

function escapeMd(value) {
  if (value == null || value === "") return "";
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function createMarkdown(result) {
  const lines = [];
  const terms = result.assumptions.terms?.length ? result.assumptions.terms : [result.assumptions.termMonths];
  const termHeaders = terms.flatMap((term) => [`Rate ${term}m`, `Gesamt ${term}m`]);
  lines.push("# VW Lease Rates");
  lines.push("");
  lines.push(`Quelle: ${result.sourceUrl}`);
  lines.push(`Erstellt: ${result.generatedAt}`);
  lines.push(`Treffer: ${result.rows.length}`);
  lines.push(`Suchbestand: ${result.rows.length}/${result.meta.resultNumber}; vollständig: ${result.meta.searchComplete ? 'ja' : 'nein'}. Privatkunden, brutto.`);
  lines.push(
    `Annahmen: Laufzeiten ${terms.join(", ")} Monate, ${formatNumber(result.assumptions.annualMileage)} km/Jahr, ${formatEuro(result.assumptions.downPaymentGross)} Anzahlung`,
  );
  lines.push('Gesamt = Monatsrate × Laufzeit + Sonderzahlung; zusätzliche Händlerkosten sind nicht enthalten.');
  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("## Hinweise");
    for (const warning of result.warnings) {
      lines.push(`- ${warning}`);
    }
  }
  lines.push("");
  lines.push("## Tabelle");
  lines.push("");
  const headers = [
    "#",
    "Preis",
    "Fahrzeug",
    "km",
    "EZ",
    "Reichweite",
    "DC 10-80",
    ...termHeaders,
    "Leasingkampagne",
    "Haendler",
    "Link",
  ];
  lines.push(`| ${headers.join(" | ")} |`);
  lines.push(`|${headers.map((header) => (/^#|Preis|km|Reichweite|Rate|Gesamt/.test(header) ? "---:" : "---")).join("|")}|`);

  for (const row of result.rows) {
    const campaign = row.leasingCampaigns
      .map((item) => item.label || item.key)
      .filter(Boolean)
      .join(", ");
    const dealer = [row.dealerName, row.dealerZip, row.dealerCity].filter(Boolean).join(", ");
    const link = row.detailUrl ? `[VW](${row.detailUrl})` : "";
    const termValues = terms.flatMap((term) => {
      const rate = row.termRates?.find((item) => item.termMonths === term);
      return [
        rate?.monthlyGross == null ? "n/a" : formatEuro(rate.monthlyGross, 2),
        rate?.totalGross == null ? "n/a" : formatEuro(rate.totalGross, 2),
      ];
    });
    lines.push(
      [
        row.rank,
        formatEuro(row.grossPrice, 2),
        escapeMd(row.title),
        formatNumber(row.mileageKm),
        row.firstRegistration || "",
        formatNumber(row.rangeKm),
        escapeMd(row.dcCharging10To80),
        ...termValues,
        escapeMd(campaign || ""),
        escapeMd(dealer),
        link,
      ].join(" | ").replace(/^/, "| ").replace(/$/, " |"),
    );
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }

  const searchUrl = validateUrl(args.url);
  timeoutMs = args.timeoutMs;

  const runtimeConfig = await resolveRuntimeConfig(searchUrl);
  const fetched = await fetchAllCars(searchUrl, runtimeConfig, args);
  let rows = fetched.cars.map((car, index) => normalizeCar(car, index, args, searchUrl));
  let webCalcResults = [];

  if (args.useWebCalc && fetched.cars.length > 0) {
    webCalcResults = await mapLimit(fetched.cars, args.webCalcConcurrency, (car) => fetchWebCalcTermRates(car, args));
    rows = rows.map((row, index) => {
      const termRates = webCalcResults[index] || [];
      const selected = termRates.find((item) => item.termMonths === args.term) || termRates.at(-1);
      if (!selected || selected.monthlyGross == null) {
        return {
          ...row,
          monthlyGross: null,
          totalGross: null,
          rateSource: null,
          termRates,
          webCalc: selected,
        };
      }
      return {
        ...row,
        monthlyGross: selected.monthlyGross,
        rateSource: selected.source,
        termRates,
        totalGross: selected.totalGross,
        webCalc: selected,
      };
    });
  }

  const warnings = [...fetched.warnings];

  if (rows.length === 0) {
    warnings.push("Volkswagen returned no vehicles for this filter.");
  }

  if (!args.useWebCalc) warnings.push('WebCalc disabled: no leasing rates calculated.');

  const webCalcErrors = webCalcResults.flat().filter((item) => item?.error).length;
  if (args.useWebCalc && webCalcErrors > 0) {
    warnings.push(`VWFS WebCalc konnte fuer ${webCalcErrors} von ${webCalcResults.flat().length} Laufzeitberechnungen keine Leasingrate berechnen.`);
  }

  const result = {
    complete: fetched.complete && (!args.useWebCalc || webCalcErrors === 0),
    assumptions: {
      annualMileage: args.mileage,
      downPaymentGross: args.downPayment,
      termMonths: args.term,
      terms: args.terms,
      customerType: 'PRIVATE', currency: 'EUR', gross: true,
    },
    generatedAt: new Date().toISOString(),
    meta: {
      pageMetas: fetched.pageMetas,
      pagesFetched: fetched.pagesFetched,
      resultNumber: fetched.expected,
      searchComplete: fetched.complete,
      duplicatesRemoved: fetched.duplicatesRemoved,
      webCalcRateCells: webCalcResults.flat().filter((item) => item?.monthlyGross != null).length,
      webCalcRequests: webCalcResults.flat().length,
    },
    rows,
    sourceUrl: searchUrl.href,
    warnings,
  };

  const outputDir = path.resolve(args.out);
  await fs.mkdir(outputDir, { recursive: true });

  const jsonPath = path.join(outputDir, `${args.prefix}.json`);
  const markdownPath = path.join(outputDir, `${args.prefix}.md`);

  await fs.writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await fs.writeFile(markdownPath, createMarkdown(result), "utf8");

  process.stdout.write(
    `${JSON.stringify(
      {
        cars: rows.length,
        complete: result.complete,
        searchComplete: fetched.complete,
        json: jsonPath,
        markdown: markdownPath,
        pagesFetched: fetched.pagesFetched,
        rateRows: rows.filter((row) => row.monthlyGross != null).length,
        webCalcRateCells: webCalcResults.flat().filter((row) => row?.monthlyGross != null).length,
        warnings,
      },
      null,
      2,
    )}\n`,
  );
  if (!result.complete) process.exitCode = 2;
  return result;
}

export { parseArgs, parseMoney, parseAmount, parseTerms, validateUrl, buildSearchParams, fetchText, fetchJson,
  fetchAllCars, resolveRuntimeConfig, detailUrl, normalizeCar, webCalcPayloads, extractWebCalcRate,
  verifyWebCalcParameters, fetchWebCalcRate, fetchWebCalcTermRates, totalGross, createMarkdown, main };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`${safeError(error.message)}\n`); process.exitCode = 1; });
}
