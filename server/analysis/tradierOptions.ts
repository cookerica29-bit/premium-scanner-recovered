// ============================================================
// TRADIER OPTION CHAIN ENGINE
// Ported from netlify-options-scanner/netlify/functions/option-chain.js
// Fetches option expirations, chains, and Greeks from Tradier API.
// Filters contracts by volume, open interest, and bid/ask spread.
// Ranks contracts by a composite score favouring tight spreads,
// high liquidity, and usable delta.
// ============================================================

export interface OptionContract {
  symbol: string;
  expiration: string;
  optionType: "call" | "put";
  strike: number;
  bid: number;
  ask: number;
  last: number;
  mark: number;
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

export interface OptionChainResult {
  symbol: string;
  side: "calls" | "puts";
  underlyingPrice: number;
  expirationCount: number;
  expirationsUsed: string[];
  contracts: OptionContract[];
}

export interface OptionChainFilters {
  side: "calls" | "puts";
  minVolume: number;
  minOpenInterest: number;
  maxSpreadPct: number;
  expirationCount: number;
}

// ── Helpers ───────────────────────────────────────────────────
function parseNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function arrayify<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function clamp(num: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, num));
}

// ── Scoring ───────────────────────────────────────────────────
/**
 * Composite contract score (0-100).
 * Weights: spread 35%, volume 25%, open interest 25%, delta proximity 15%.
 */
export function contractScore(contract: Omit<OptionContract, "contractScore">, side: "calls" | "puts"): number {
  const spreadScore = clamp(100 - contract.spreadPct * 8, 0, 100);
  const volumeScore = clamp(Math.log10((contract.volume || 0) + 1) * 28, 0, 100);
  const oiScore = clamp(Math.log10((contract.openInterest || 0) + 1) * 28, 0, 100);
  // Target delta: 0.45 for calls, -0.45 for puts (slightly ITM, good liquidity)
  const deltaTarget = side === "calls" ? 0.45 : -0.45;
  const deltaDistance = Math.abs(contract.delta - deltaTarget);
  const deltaScore = clamp(100 - deltaDistance * 180, 0, 100);
  return Math.round(spreadScore * 0.35 + volumeScore * 0.25 + oiScore * 0.25 + deltaScore * 0.15);
}

// ── Normalise raw Tradier contract ────────────────────────────
export function normalizeContract(raw: Record<string, unknown>): Omit<OptionContract, "contractScore"> {
  const bid = parseNumber(raw.bid);
  const ask = parseNumber(raw.ask);
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : Math.max(bid, ask, 0);
  const spreadPct = mid > 0 ? ((ask - bid) / mid) * 100 : 999;
  const greeks = (raw.greeks ?? {}) as Record<string, unknown>;
  return {
    symbol: String(raw.symbol ?? ""),
    expiration: String(raw.expiration_date ?? ""),
    optionType: String(raw.option_type ?? "call") as "call" | "put",
    strike: parseNumber(raw.strike),
    bid,
    ask,
    last: parseNumber(raw.last),
    mark: Number(mid.toFixed(3)),
    spreadPct: Number(spreadPct.toFixed(2)),
    volume: parseNumber(raw.volume, 0),
    openInterest: parseNumber(raw.open_interest, 0),
    delta: parseNumber(greeks.delta, 0),
    gamma: parseNumber(greeks.gamma, 0),
    theta: parseNumber(greeks.theta, 0),
    vega: parseNumber(greeks.vega, 0),
    iv: parseNumber(greeks.mid_iv, parseNumber(greeks.smv_vol, 0)),
  };
}

// ── Tradier HTTP helper ───────────────────────────────────────
async function tradierFetch(path: string, token: string, baseUrl: string): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const fault = data?.fault as Record<string, unknown> | undefined;
    throw new Error(String(fault?.faultstring ?? data?.errors ?? `Tradier request failed for ${path}`));
  }
  return data;
}

// ── Main option chain fetcher ─────────────────────────────────
export async function fetchOptionChain(
  symbol: string,
  filters: OptionChainFilters,
  token: string,
  baseUrl: string
): Promise<OptionChainResult> {
  const { side, minVolume, minOpenInterest, maxSpreadPct, expirationCount } = filters;
  const expCount = clamp(expirationCount, 1, 6);

  // 1. Fetch available expirations
  const expData = await tradierFetch(
    `/markets/options/expirations?symbol=${encodeURIComponent(symbol)}&includeAllRoots=true&strikes=false`,
    token,
    baseUrl
  ) as Record<string, unknown>;
  const expirationList = arrayify((expData?.expirations as Record<string, unknown>)?.date as string[]).slice(0, expCount);
  if (!expirationList.length) {
    throw new Error(`No option expirations found for ${symbol}.`);
  }

  // 2. Fetch underlying quote for current price
  const quotesData = await tradierFetch(
    `/markets/quotes?symbols=${encodeURIComponent(symbol)}&greeks=false`,
    token,
    baseUrl
  ) as Record<string, unknown>;
  const underlyingQuote = arrayify((quotesData?.quotes as Record<string, unknown>)?.quote as Record<string, unknown>[])[0] ?? {};
  const underlyingPrice = parseNumber(
    underlyingQuote?.last ?? underlyingQuote?.close ?? underlyingQuote?.bid ?? underlyingQuote?.ask,
    0
  );

  // 3. Fetch option chains for each expiration (in parallel)
  const chainResults = await Promise.all(
    expirationList.map((exp) =>
      tradierFetch(
        `/markets/options/chains?symbol=${encodeURIComponent(symbol)}&expiration=${encodeURIComponent(exp)}&greeks=true`,
        token,
        baseUrl
      ) as Promise<Record<string, unknown>>
    )
  );

  // 4. Filter, normalise, score, sort
  const typeWanted = side === "puts" ? "put" : "call";
  const contracts: OptionContract[] = chainResults
    .flatMap((chain) => arrayify((chain?.options as Record<string, unknown>)?.option as Record<string, unknown>[]))
    .filter((raw) => raw.option_type === typeWanted)
    .map((raw) => normalizeContract(raw))
    .filter(
      (c) =>
        c.bid > 0 &&
        c.ask >= c.bid &&
        c.volume >= minVolume &&
        c.openInterest >= minOpenInterest &&
        c.spreadPct <= maxSpreadPct
    )
    .map((c) => ({ ...c, contractScore: contractScore(c, side) }))
    .sort((a, b) => b.contractScore - a.contractScore)
    .slice(0, 30);

  return {
    symbol,
    side,
    underlyingPrice,
    expirationCount: expirationList.length,
    expirationsUsed: expirationList,
    contracts,
  };
}
