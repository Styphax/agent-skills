#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_BFF_BASE = "https://v3-115-2.gsl.feature-app.io";
const DEFAULT_PAGE_SIZE = 12;
const DEFAULT_PREFIX = "vw-lease-rates";
const DEFAULT_WEBCALC_CONCURRENCY = 4;
const DEFAULT_WEBCALC_ENDPOINT = "https://api.webcalc.vwfs.io/webcalc-frontend-service";

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
  --help                  Show this help.
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
        args.downPayment = parseAmount(value);
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
        args.prefix = value;
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

  return args;
}

function toPositiveInteger(value, name) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseAmount(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = String(value)
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number.parseFloat(normalized);
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
    if (end < start) throw new Error("terms range end must be greater than range start");
    const out = [];
    for (let term = start; term <= end; term += 6) out.push(term);
    return out;
  }

  const terms = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => toPositiveInteger(part, "terms"));
  if (terms.length === 0) throw new Error("--terms must include at least one term");
  return [...new Set(terms)].sort((a, b) => a - b);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      "accept-language": "de-DE,de;q=0.9,en;q=0.7",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${response.status}: ${text.slice(0, 500)}`);
  }
  return text;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "accept-language": "de-DE,de;q=0.9,en;q=0.7",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${response.status}: ${text.slice(0, 500)}`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON from ${url}: ${error.message}`);
  }
}

async function postJson(url, body) {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: {
      accept: "application/json",
      "accept-language": "de-DE,de;q=0.9,en;q=0.7",
      "content-type": "application/json",
      referer: "https://www.volkswagen.de/",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
    },
    method: "POST",
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`POST ${url} failed with ${response.status}: ${text.slice(0, 500)}`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON from ${url}: ${error.message}`);
  }
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

  const baseUrl = instanceConfig.baseUrl || parseFeatureAppBaseUrl(html) || DEFAULT_BFF_BASE;
  const spaConfig = globalConfig.spaAsyncConfig || {};
  const oneApiKey = spaConfig.oneApiConfiguration?.apiKey;
  const endpoint = spaConfig.serviceConfigEndpoint?.endpoint;

  if (!oneApiKey || !endpoint) {
    throw new Error("Volkswagen global config did not include oneApiKey and service endpoint");
  }

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

  while (true) {
    const bffUrl = new URL("/bff/car/search", runtimeConfig.baseUrl);
    bffUrl.search = buildSearchParams(searchUrl, page, args, runtimeConfig).toString();
    const data = await fetchJson(bffUrl.href);

    if (!Array.isArray(data.cars)) {
      throw new Error(`Volkswagen BFF response for page ${page} did not include cars[]`);
    }

    allCars.push(...data.cars);
    pageMetas.push(data.meta || {});
    pageMax = Number.parseInt(data.meta?.pageMax ?? "1", 10) || 1;

    const hitMaxPages = args.maxPages != null && page >= args.maxPages;
    if (page >= pageMax || hitMaxPages) break;
    page += 1;
  }

  return {
    cars: allCars,
    meta: pageMetas.at(-1) || {},
    pageMetas,
    pagesFetched: pageMetas.length,
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
    url.pathname = url.pathname.replace(/\/__app\/search\/[^/]+\.app$/, `/__app/search/car/${encodeURIComponent(car.key)}.app`);
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

function extractStructuredRate(car) {
  const roots = [
    ["prices", car.prices],
    ["leasing", car.leasing],
    ["finance", car.finance],
    ["financing", car.financing],
    ["rateData", car.rateData],
    ["payment", car.payment],
    ["offer", car.offer],
  ].filter(([, value]) => value && typeof value === "object");

  for (const [name, value] of roots) {
    const found = scanForRate(value, [name], 0);
    if (found) return found;
  }
  return null;
}

function scanForRate(value, pathParts, depth) {
  if (depth > 8 || value == null) return null;
  const pathName = pathParts.join(".");
  const lastKey = pathParts.at(-1) || "";
  const lowerPath = pathName.toLowerCase();
  const lowerKey = lastKey.toLowerCase();

  if (typeof value === "string" || typeof value === "number") {
    if (looksLikeMonthlyRatePath(lowerPath, lowerKey)) {
      const amount = parseAmount(value);
      if (amount != null && amount >= 10 && amount <= 5000) {
        return { amount, sourcePath: pathName };
      }
    }
    return null;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = scanForRate(value[index], [...pathParts, String(index)], depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof value === "object") {
    if (looksLikeMonthlyRatePath(lowerPath, lowerKey)) {
      const amount = parseAmount(value.value ?? value.valueString ?? value.text ?? value.label);
      if (amount != null && amount >= 10 && amount <= 5000) {
        return { amount, sourcePath: pathName };
      }
    }

    for (const [key, child] of Object.entries(value)) {
      const found = scanForRate(child, [...pathParts, key], depth + 1);
      if (found) return found;
    }
  }

  return null;
}

function looksLikeMonthlyRatePath(lowerPath, lowerKey) {
  if (/interest|zinssatz|apr|nominal|effektiv|percent|percentage/.test(lowerPath)) {
    return false;
  }
  if (/monthly|month|rate|leasing|payment|installment|ratevalue|monthlypayments/.test(lowerKey)) {
    return true;
  }
  return /monthly|leasingrate|monthlyrate|monthlypayments|payment\.rate|ratevalue/.test(lowerPath);
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
  return parseIntegerAmount(car.parsedPrice?.value ?? car.parsedPrice?.label);
}

function listPrice(car) {
  return parseIntegerAmount(car.parsedPrice?.list?.value ?? car.parsedPrice?.list?.label);
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

function totalGross(monthlyGross, termMonths, downPaymentGross) {
  if (monthlyGross == null || termMonths == null) return null;
  return monthlyGross * termMonths + (downPaymentGross || 0);
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
      const rate = extractWebCalcRate(response);
      if (rate != null) {
        return {
          domain: request.Request["@Domain"],
          error: null,
          monthlyGross: rate,
          source: `webcalc.${request.Request["@Domain"]}.PL.CalculateRate`,
          termMonths: term,
          totalGross: totalGross(rate, term, args.downPayment),
        };
      }
      const error = webCalcError(response);
      if (error) errors.push(`${request.Request["@Domain"]}: ${error}`);
    } catch (error) {
      errors.push(`${request.Request["@Domain"]}: ${error.message}`);
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
  const rate = extractStructuredRate(car);
  const leasingCampaigns = structuredCampaigns(car, "LEASING");
  const financingCampaigns = structuredCampaigns(car, "FINANCING");

  return {
    annualMileage: args.mileage,
    batteryKwh: parseIntegerAmount(capacity?.raw_value ?? capacity?.text),
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
    grossPrice: parseIntegerAmount(car.parsedPrice?.value ?? car.parsedPrice?.label),
    isLeasing: Boolean(car.isLeasing),
    leasingCampaigns,
    mileageKm: parseIntegerAmount(car.mileage?.raw_value ?? car.mileage?.value),
    monthlyGross: rate?.amount ?? null,
    paymentOptions: Array.isArray(car.paymentOptions) ? car.paymentOptions : [],
    powerKw: parseIntegerAmount(car.motor?.powerKw?.value),
    powerPs: parseIntegerAmount(car.motor?.powerPs?.value),
    rank: index + 1,
    rangeKm: parseIntegerAmount(range?.raw_value ?? range?.text),
    rateSource: rate?.sourcePath ?? null,
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
  lines.push(
    `Annahmen: Laufzeiten ${terms.join(", ")} Monate, ${formatNumber(result.assumptions.annualMileage)} km/Jahr, ${formatEuro(result.assumptions.downPaymentGross)} Anzahlung`,
  );
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
        formatEuro(row.grossPrice),
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }

  const searchUrl = new URL(args.url);
  if (!/volkswagen\.de$/i.test(searchUrl.hostname) && searchUrl.hostname !== "www.volkswagen.de") {
    throw new Error(`Expected a volkswagen.de URL, got ${searchUrl.hostname}`);
  }

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

  const warnings = [];

  if (rows.length === 0) {
    warnings.push("Volkswagen returned no vehicles for this filter.");
  }

  if (!rows.some((row) => row.monthlyGross != null)) {
    warnings.push(
      "VW liefert fuer diese Treffer in der Suchantwort keine strukturierte Monatsrate, nur Fahrzeugdaten und Kampagnen.",
    );
  }

  const webCalcErrors = webCalcResults.flat().filter((item) => item?.error).length;
  if (args.useWebCalc && webCalcErrors > 0) {
    warnings.push(`VWFS WebCalc konnte fuer ${webCalcErrors} von ${webCalcResults.flat().length} Laufzeitberechnungen keine Leasingrate berechnen.`);
  }

  const result = {
    assumptions: {
      annualMileage: args.mileage,
      downPaymentGross: args.downPayment,
      termMonths: args.term,
      terms: args.terms,
    },
    generatedAt: new Date().toISOString(),
    meta: {
      pageMetas: fetched.pageMetas,
      pagesFetched: fetched.pagesFetched,
      resultNumber: fetched.meta.resultNumber ?? rows.length,
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
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
