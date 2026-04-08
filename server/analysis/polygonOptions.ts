// ============================================================
// POLYGON OPTION CHAIN ENGINE
// Ported from netlify-options-scanner-polygon/netlify/functions/option-chain.js
// Uses Polygon /v3/snapshot/options/{ticker} to fetch chain-level snapshot data
// including Greeks and IV. Filters by volume, OI, spread %, and delta range.
// Ranks contracts by composite score (spread, volume, OI, delta proximity).
// ============================================================

const POLYGON_BASE = "https://api.polygon.io";

export interface PolygonOptionContract {
  ticker: string;
  expiration: string;
  contractType: "call" | "put";
  strike: number;
  bid: number;
  ask: number;
  spreadPct: number;
  volume: number;
  openInterest: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  iv: number;
  contractScore: number;
}

export interface PolygonOptionChainResult {
  symbol: string;
  side: "calls" | "puts";
  underlyingPrice: number;
  expirationCount: number;
  expirationsUsed: string[];
  contracts: PolygonOptionContract[];
}

export interface PolygonOptionChainFilters {
  side: "calls" | "puts";
  minVolume: number;
  minOpenInterest: number;
  maxSpreadPct: number;
  minDeltaAbs: number;
  maxDeltaAbs: number;
  expirationCount: number;
}

// ── Helpers ───────────────────────────────────────────────────
function parseNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(num: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, num));
}

// ── Scoring ───────────────────────────────────────────────────
/**
 * Composite contract score (0-100).
 * Weights: spread 35%, volume 25%, open interest 25%, delta proximity 15%.
 * Target delta: 0.45 for calls, -0.45 for puts.
 */
export function polygonContractScore(
  contract: Omit<PolygonOptionContract, "contractScore">,
  side: "calls" | "puts"
): number {
  const spreadScore = clamp(100 - contract.spreadPct * 8, 0, 100);
  const volumeScore = clamp(Math.log10((contract.volume || 0) + 1) * 28, 0, 100);
  const oiScore = clamp(Math.log10((contract.openInterest || 0) + 1) * 28, 0, 100);
  const targetDelta = side === "calls" ? 0.45 : -0.45;
  const deltaDistance = Math.abs(parseNumber(contract.delta, 0) - targetDelta);
  const deltaScore = clamp(100 - deltaDistance * 180, 0, 100);
  return Math.round(
    spreadScore * 0.35 +
    volumeScore * 0.25 +
    oiScore * 0.25 +
    deltaScore * 0.15
  );
}

// ── Normalise raw Polygon snapshot contract ───────────────────
export function normalizePolygonContract(
  raw: Record<string, unknown>
): Omit<PolygonOptionContract, "contractScore"> {
  const details = (raw.details ?? {}) as Record<string, unknown>;
  const quote = (raw.last_quote ?? {}) as Record<string, unknown>;
  const day = (raw.day ?? {}) as Record<string, unknown>;
  const greeks = (raw.greeks ?? {}) as Record<string, unknown>;
  const impliedVol = raw.implied_volatility;

  const bid = parseNumber(quote.bid_price, 0);
  const ask = parseNumber(quote.ask_price, 0);
  const mark = bid > 0 && ask > 0 ? (bid + ask) / 2 : Math.max(bid, ask, 0);
  const spreadPct = mark > 0 ? ((ask - bid) / mark) * 100 : 999;

  return {
    ticker: String(raw.ticker ?? ""),
    expiration: String(details.expiration_date ?? ""),
    contractType: String(details.contract_type ?? "call") as "call" | "put",
    strike: parseNumber(details.strike_price, 0),
    bid: Number(bid.toFixed(3)),
    ask: Number(ask.toFixed(3)),
    spreadPct: Number(spreadPct.toFixed(2)),
    volume: parseNumber(day.volume, 0),
    openInterest: parseNumber(raw.open_interest, 0),
    delta: parseNumber(greeks.delta, 0),
    gamma: parseNumber(greeks.gamma, 0),
    theta: parseNumber(greeks.theta, 0),
    vega: parseNumber(greeks.vega, 0),
    iv: parseNumber(impliedVol, 0),
  };
}

// ── Polygon HTTP helper ───────────────────────────────────────
async function polygonFetch(path: string, apiKey: string): Promise<unknown> {
  const sep = path.includes("?") ? "&" : "?";
  const response = await fetch(`${POLYGON_BASE}${path}${sep}apiKey=${encodeURIComponent(apiKey)}`);
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      String(data.error ?? data.message ?? `Polygon request failed for ${path}`)
    );
  }
  return data;
}

// ── Main option chain fetcher ─────────────────────────────────
export async function fetchPolygonOptionChain(
  symbol: string,
  filters: PolygonOptionChainFilters,
  apiKey: string
): Promise<PolygonOptionChainResult> {
  const {
    side,
    minVolume,
    minOpenInterest,
    maxSpreadPct,
    minDeltaAbs,
    maxDeltaAbs,
    expirationCount,
  } = filters;
  const expCount = clamp(expirationCount, 1, 6);

  // 1. Fetch underlying last trade price
  const underlyingData = await polygonFetch(
    `/v2/last/trade/${encodeURIComponent(symbol)}`,
    apiKey
  ) as Record<string, unknown>;
  const underlyingResults = (underlyingData.results ?? {}) as Record<string, unknown>;
  const underlyingPrice = parseNumber(underlyingResults.p, 0);

  // 2. Fetch option chain snapshot (up to 250 contracts, sorted by expiration asc)
  const chainData = await polygonFetch(
    `/v3/snapshot/options/${encodeURIComponent(symbol)}?limit=250&sort=expiration_date&order=asc`,
    apiKey
  ) as Record<string, unknown>;

  const all = Array.isArray(chainData.results)
    ? (chainData.results as Record<string, unknown>[])
    : [];

  if (!all.length) {
    throw new Error(`No option-chain snapshot data found for ${symbol}. This endpoint may require a higher Polygon plan.`);
  }

  // 3. Collect nearest N expirations
  const allDates = all
    .map((item) => (item.details as Record<string, unknown> | undefined)?.expiration_date as string | undefined)
    .filter((d): d is string => Boolean(d))
    .sort();
  const seen = new Set<string>();
  const expirations: string[] = [];
  for (const d of allDates) {
    if (!seen.has(d)) { seen.add(d); expirations.push(d); }
    if (expirations.length >= expCount) break;
  }

  // 4. Filter, normalise, score, sort
  const contractTypeWanted = side === "puts" ? "put" : "call";
  const contracts: PolygonOptionContract[] = all
    .filter((item) => {
      const d = (item.details ?? {}) as Record<string, unknown>;
      return (
        d.contract_type === contractTypeWanted &&
        expirations.includes(d.expiration_date as string)
      );
    })
    .map((item) => normalizePolygonContract(item))
    .filter((c) => {
      const absDelta = Math.abs(c.delta);
      return (
        c.bid > 0 &&
        c.ask >= c.bid &&
        c.volume >= minVolume &&
        c.openInterest >= minOpenInterest &&
        c.spreadPct <= maxSpreadPct &&
        absDelta >= minDeltaAbs &&
        absDelta <= maxDeltaAbs
      );
    })
    .map((c) => ({ ...c, contractScore: polygonContractScore(c, side) }))
    .sort((a, b) => b.contractScore - a.contractScore)
    .slice(0, 30);

  return {
    symbol,
    side,
    underlyingPrice,
    expirationCount: expirations.length,
    expirationsUsed: expirations,
    contracts,
  };
}
