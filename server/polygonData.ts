/**
 * Stock OHLCV Data Fetcher
 *
 * Primary candles: Polygon.io (API key required, rate-limited queue at 5 req/min)
 * Earnings dates:  Polygon.io (same key, cached 24h)
 *
 * Cache strategy: 10-minute in-memory cache per (symbol, timeframe).
 *   - Cache hit  → instant, no API call
 *   - Cache miss → queued background fetch; returns empty for that symbol this scan
 *
 * Free-tier rate limit: 5 requests/minute → 1 request every 13 seconds.
 * With 5 primary + 5 HTF symbols = 10 requests → ~2.5 minutes to warm fully.
 * First symbols appear within ~13 seconds of server start.
 */

import type { Candle } from "./analysis/supplyDemand";
import { ENV } from "./_core/env";

export { STOCK_SYMBOLS, STOCK_SECTORS, STOCK_HTF_MAP } from "./stockData";

/**
 * Maps a primary timeframe to its higher timeframe for regime filtering.
 * Daily→Weekly is the only one used for the 5-symbol list.
 */
export const HTF_MAP: Record<string, string> = {
  "15m":   "1H",
  "30m":   "4H",
  "1H":    "4H",
  "4H":    "Daily",
  "Daily": "Weekly",
};

// ─── Polygon timeframe mapping ────────────────────────────────────────────────
// Maps our timeframe labels to Polygon aggregate params: multiplier + timespan + days back
const POLYGON_TF: Record<string, { multiplier: number; timespan: string; daysBack: number }> = {
  "15m":   { multiplier: 15,  timespan: "minute", daysBack: 10  },
  "30m":   { multiplier: 30,  timespan: "minute", daysBack: 20  },
  "1H":    { multiplier: 60,  timespan: "minute", daysBack: 40  },
  "4H":    { multiplier: 240, timespan: "minute", daysBack: 80  },
  "Daily": { multiplier: 1,   timespan: "day",    daysBack: 365 },
  "Weekly":{ multiplier: 1,   timespan: "week",   daysBack: 730 },
};

// ─── In-memory cache ──────────────────────────────────────────────────────────
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CacheEntry {
  candles: Candle[];
  fetchedAt: number;
}

const candleCache = new Map<string, CacheEntry>();

function cacheKey(symbol: string, timeframe: string): string {
  return `${symbol}:${timeframe}`;
}

function getCached(symbol: string, timeframe: string): Candle[] | null {
  const entry = candleCache.get(cacheKey(symbol, timeframe));
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    candleCache.delete(cacheKey(symbol, timeframe));
    return null;
  }
  return entry.candles;
}

function setCache(symbol: string, timeframe: string, candles: Candle[]): void {
  candleCache.set(cacheKey(symbol, timeframe), { candles, fetchedAt: Date.now() });
}

/** Returns the age of the oldest cache entry (in ms), or 0 if none cached. */
export function getCacheAge(symbols: string[], timeframe: string): number {
  let oldest = 0;
  for (const sym of symbols) {
    const entry = candleCache.get(cacheKey(sym, timeframe));
    if (entry) {
      const age = Date.now() - entry.fetchedAt;
      if (age > oldest) oldest = age;
    }
  }
  return oldest;
}

/** Returns true if all symbols have a valid cache entry. */
export function isCacheWarm(symbols: string[], timeframe: string): boolean {
  return symbols.every((sym) => getCached(sym, timeframe) !== null);
}

/** Returns how many symbols currently have a valid cache entry. */
export function getCachedCount(symbols: string[], timeframe: string): number {
  return symbols.filter((sym) => getCached(sym, timeframe) !== null).length;
}

// ─── Rate-limited request queue (5 req/min free tier = 1 per 13s) ────────────
const RATE_LIMIT_DELAY_MS = 13_000; // 13 seconds between requests
let lastRequestTime = 0;
let queueRunning = false;

interface QueueItem {
  symbol: string;
  timeframe: string;
  resolve: (candles: Candle[]) => void;
}

const requestQueue: QueueItem[] = [];
const inFlight = new Set<string>();

function processQueue(): void {
  if (queueRunning || requestQueue.length === 0) return;
  queueRunning = true;

  async function runNext(): Promise<void> {
    const item = requestQueue.shift();
    if (!item) {
      queueRunning = false;
      return;
    }

    const now = Date.now();
    const wait = Math.max(0, lastRequestTime + RATE_LIMIT_DELAY_MS - now);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    lastRequestTime = Date.now();
    try {
      const candles = await fetchFromPolygon(item.symbol, item.timeframe);
      if (candles.length > 0) {
        setCache(item.symbol, item.timeframe, candles);
        console.log(`[Polygon] Cached ${candles.length} candles for ${item.symbol} ${item.timeframe}`);
      }
      item.resolve(candles);
    } catch (err) {
      console.warn(`[Polygon] Fetch failed for ${item.symbol}:`, (err as Error).message);
      item.resolve([]);
    } finally {
      inFlight.delete(cacheKey(item.symbol, item.timeframe));
    }

    // Continue processing
    runNext();
  }

  runNext();
}

// ─── Core Polygon fetcher ─────────────────────────────────────────────────────
async function fetchFromPolygon(symbol: string, timeframe: string): Promise<Candle[]> {
  const apiKey = ENV.polygonApiKey;
  if (!apiKey) throw new Error("POLYGON_API_KEY not configured");

  const tf = POLYGON_TF[timeframe] ?? POLYGON_TF["Daily"];
  const toDate = new Date();
  const fromDate = new Date(Date.now() - tf.daysBack * 24 * 60 * 60 * 1000);
  const from = fromDate.toISOString().split("T")[0];
  const to = toDate.toISOString().split("T")[0];

  const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/${tf.multiplier}/${tf.timespan}/${from}/${to}?adjusted=true&sort=asc&limit=500&apiKey=${apiKey}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });

  if (res.status === 429) {
    throw new Error(`Polygon.io rate limit hit for ${symbol}`);
  }
  if (!res.ok) {
    throw new Error(`Polygon.io error for ${symbol}: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as {
    results?: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>;
    status?: string;
    error?: string;
  };

  if (data.error) throw new Error(`Polygon.io error for ${symbol}: ${data.error}`);

  const results = data.results ?? [];
  return results.map((bar) => ({
    time: new Date(bar.t).toISOString(),
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
  }));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch candles for a single symbol, using the cache when available.
 * Cache misses are queued through the rate limiter.
 */
export async function fetchStockCandles(
  symbol: string,
  timeframe: string = "Daily"
): Promise<Candle[]> {
  const cached = getCached(symbol, timeframe);
  if (cached) return cached;

  return new Promise<Candle[]>((resolve) => {
    const key = cacheKey(symbol, timeframe);
    if (!inFlight.has(key)) {
      inFlight.add(key);
      requestQueue.push({ symbol, timeframe, resolve });
      processQueue();
    } else {
      // Already queued — poll cache until it arrives (max 60s)
      const start = Date.now();
      const poll = setInterval(() => {
        const c = getCached(symbol, timeframe);
        if (c || Date.now() - start > 60_000) {
          clearInterval(poll);
          resolve(c ?? []);
        }
      }, 500);
    }
  });
}

/**
 * CACHE-ONLY batch fetch — returns immediately with whatever is already cached.
 * Symbols not in cache are skipped (not fetched).
 * Use warmCacheInBackground() to populate the cache for future calls.
 */
export function fetchStockCandlesCached(
  symbols: string[],
  timeframe: string
): Map<string, Candle[]> {
  const results = new Map<string, Candle[]>();
  for (const sym of symbols) {
    const cached = getCached(sym, timeframe);
    if (cached && cached.length > 0) {
      results.set(sym, cached);
    }
  }
  return results;
}

/**
 * Fire-and-forget background cache warmer.
 * Queues all uncached symbols through the rate limiter.
 * Does NOT block the caller — returns immediately.
 * Safe to call on every scan request; already-cached and in-flight symbols are skipped.
 */
export function warmCacheInBackground(symbols: string[], timeframe: string): void {
  const uncached = symbols.filter(
    (sym) => !getCached(sym, timeframe) && !inFlight.has(cacheKey(sym, timeframe))
  );

  if (uncached.length === 0) return;

  console.log(`[Polygon] Queuing ${uncached.length} symbols for ${timeframe} (${Math.round(uncached.length * RATE_LIMIT_DELAY_MS / 1000)}s est.)...`);

  for (const sym of uncached) {
    const key = cacheKey(sym, timeframe);
    inFlight.add(key);
    requestQueue.push({
      symbol: sym,
      timeframe,
      resolve: () => { /* fire-and-forget */ },
    });
  }

  processQueue();
}

/**
 * CACHE-ONLY fetch for a single symbol on the HTF — returns instantly.
 * Returns null if not yet cached.
 */
export function fetchHTFCandlesCached(symbol: string, htfTimeframe: string): Candle[] | null {
  return getCached(symbol, htfTimeframe);
}

/**
 * Fire-and-forget background warmer for HTF candles.
 * Same queue as primary warming — interleaved automatically.
 */
export function warmHTFCacheInBackground(symbols: string[], htfTimeframe: string): void {
  const uncached = symbols.filter(
    (sym) => !getCached(sym, htfTimeframe) && !inFlight.has(cacheKey(sym, htfTimeframe))
  );
  if (uncached.length === 0) return;
  console.log(`[Polygon] Queuing HTF (${htfTimeframe}) for ${uncached.length} symbols...`);
  for (const sym of uncached) {
    const key = cacheKey(sym, htfTimeframe);
    inFlight.add(key);
    requestQueue.push({
      symbol: sym,
      timeframe: htfTimeframe,
      resolve: () => { /* fire-and-forget */ },
    });
  }
  processQueue();
}

/**
 * Fetch multiple symbols sequentially (respects rate limit queue).
 */
export async function fetchStockCandlesBatch(
  symbols: string[],
  timeframe: string,
  _batchSize?: number,
  _delayMs?: number
): Promise<Map<string, Candle[]>> {
  const results = new Map<string, Candle[]>();
  for (const sym of symbols) {
    try {
      const candles = await fetchStockCandles(sym, timeframe);
      if (candles.length > 0) results.set(sym, candles);
    } catch (err) {
      console.warn(`[Polygon] Failed to fetch ${sym}:`, (err as Error).message);
    }
  }
  return results;
}

// ─── Earnings Calendar (Polygon.io) ──────────────────────────────────────────

/** In-memory earnings cache: symbol → next earnings date (or null if none found) */
const earningsCache = new Map<string, { date: string | null; fetchedAt: number }>();
const EARNINGS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetch the next upcoming earnings date for a symbol from Polygon.io.
 * Returns the date string "YYYY-MM-DD" or null if no upcoming earnings found.
 * Results are cached for 24 hours.
 * NOTE: This uses a direct fetch (not the rate limit queue) since it's a different endpoint.
 */
export async function fetchNextEarningsDate(symbol: string): Promise<string | null> {
  const now = Date.now();
  const cached = earningsCache.get(symbol);
  if (cached && now - cached.fetchedAt < EARNINGS_CACHE_TTL_MS) {
    return cached.date;
  }

  try {
    const apiKey = ENV.polygonApiKey;
    if (!apiKey) {
      earningsCache.set(symbol, { date: null, fetchedAt: now });
      return null;
    }
    const today = new Date().toISOString().split("T")[0];
    const ahead = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const url = `https://api.polygon.io/vX/reference/financials?ticker=${symbol}&filing_date.gte=${today}&filing_date.lte=${ahead}&limit=5&apiKey=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      earningsCache.set(symbol, { date: null, fetchedAt: now });
      return null;
    }
    const data = await res.json() as { results?: Array<{ filing_date?: string; period_of_report_date?: string }> };
    const results = data.results ?? [];
    const dates = results
      .map((r) => r.filing_date ?? r.period_of_report_date)
      .filter((d): d is string => !!d)
      .sort();
    const nextDate = dates[0] ?? null;
    earningsCache.set(symbol, { date: nextDate, fetchedAt: now });
    return nextDate;
  } catch {
    earningsCache.set(symbol, { date: null, fetchedAt: now });
    return null;
  }
}

/**
 * Check if a symbol has earnings within the next `withinDays` days.
 */
export function isNearEarnings(earningsDate: string | null, withinDays = 3): boolean {
  if (!earningsDate) return false;
  const todayStr = new Date().toISOString().split("T")[0];
  const todayMs = new Date(todayStr).getTime();
  const earningsMs = new Date(earningsDate).getTime();
  const diffDays = (earningsMs - todayMs) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= withinDays;
}
