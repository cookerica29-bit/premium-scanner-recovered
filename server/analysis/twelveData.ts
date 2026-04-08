// ============================================================
// TWELVE DATA STOCK SCANNER ENGINE
// Ported from netlify-options-scanner-live/netlify/functions/scan.js
// Uses Twelve Data API for daily OHLCV candles
// Computes Call/Put scores, setup type, and directional bias
// ============================================================

const API_BASE = "https://api.twelvedata.com";

// ── Math helpers ─────────────────────────────────────────────
function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  return average(values.slice(0, period));
}

function rsi(closes: number[], period = 14): number | null {
  if (closes.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 0; i < period; i++) {
    const delta = closes[i] - closes[i + 1];
    if (delta >= 0) gains += delta;
    else losses += Math.abs(delta);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period; i < closes.length - 1; i++) {
    const delta = closes[i] - closes[i + 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function clamp(num: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, num));
}

// ── Scoring functions (faithful port from scan.js) ────────────
export interface StockMetrics {
  ticker: string;
  exchange: string;
  price: number;
  percentChange: number;
  trend: "bullish" | "bearish" | "neutral";
  emaStack: "bullish" | "bearish" | "mixed";
  rsi: number;
  relVolume: number;
  distanceToSupport: number;
  distanceToResistance: number;
  support20: number;
  resistance20: number;
  pullbackQuality: number;
}

export interface StockScanResult extends StockMetrics {
  callScore: number;
  putScore: number;
  bestScore: number;
  bias: "Calls" | "Puts" | "Neutral";
  setupType: string;
}

function computeCallScore(stock: StockMetrics): number {
  let score = 0;
  if (stock.trend === "bullish") score += 25;
  if (stock.emaStack === "bullish") score += 20;
  score += clamp(20 - Math.abs(stock.rsi - 58), 0, 20);
  score += clamp(stock.relVolume * 8, 0, 16);
  score += clamp(12 - stock.distanceToSupport * 2.5, 0, 12);
  score += clamp(stock.distanceToResistance * 1.4, 0, 10);
  return Math.round(clamp(score, 0, 100));
}

function computePutScore(stock: StockMetrics): number {
  let score = 0;
  if (stock.trend === "bearish") score += 25;
  if (stock.emaStack === "bearish") score += 20;
  score += clamp(20 - Math.abs(stock.rsi - 42), 0, 20);
  score += clamp(stock.relVolume * 8, 0, 16);
  score += clamp(12 - stock.distanceToResistance * 2.5, 0, 12);
  score += clamp(stock.distanceToSupport * 1.4, 0, 10);
  return Math.round(clamp(score, 0, 100));
}

function getSetupType(callScore: number, putScore: number, pullbackQuality: number): string {
  if (callScore >= 75 && pullbackQuality >= 70) return "Call Pullback";
  if (callScore >= 75) return "Call Breakout";
  if (putScore >= 75 && pullbackQuality >= 60) return "Put Rejection";
  if (putScore >= 75) return "Put Breakdown";
  if (Math.abs(callScore - putScore) <= 8) return "Wait / Range";
  return callScore > putScore ? "Call Watch" : "Put Watch";
}

function getDirectionalBias(callScore: number, putScore: number): "Calls" | "Puts" | "Neutral" {
  if (callScore - putScore >= 10) return "Calls";
  if (putScore - callScore >= 10) return "Puts";
  return "Neutral";
}

// ── Twelve Data API fetch ─────────────────────────────────────
export async function fetchSymbolData(symbol: string, apiKey: string): Promise<StockScanResult> {
  const url = `${API_BASE}/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=60&apikey=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url);
  const data = await response.json() as {
    status?: string;
    message?: string;
    meta?: { exchange?: string };
    values?: Array<{
      open: string; high: string; low: string; close: string;
      volume?: string; datetime: string;
    }>;
  };

  if (!response.ok || data.status === "error" || !Array.isArray(data.values)) {
    const message = data.message || `Failed to load data for ${symbol}`;
    throw new Error(message);
  }

  const values = data.values.map((bar) => ({
    open: Number(bar.open),
    high: Number(bar.high),
    low: Number(bar.low),
    close: Number(bar.close),
    volume: Number(bar.volume || 0),
    datetime: bar.datetime,
  }));

  const closes = values.map((v) => v.close);
  const volumes = values.map((v) => v.volume);
  const highs20 = values.slice(0, 20).map((v) => v.high);
  const lows20 = values.slice(0, 20).map((v) => v.low);
  const current = values[0];
  const previous = values[1];

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const rsi14 = rsi(closes, 14);
  const avgVol20 = average(volumes.slice(1, 21).filter(Boolean));
  const relVolume = avgVol20 ? current.volume / avgVol20 : 1;

  const support20 = Math.min(...lows20);
  const resistance20 = Math.max(...highs20);
  const distanceToSupport = support20 > 0 ? ((current.close - support20) / current.close) * 100 : 0;
  const distanceToResistance = resistance20 > 0 ? ((resistance20 - current.close) / current.close) * 100 : 0;

  const trend: StockMetrics["trend"] = sma20 && sma50
    ? current.close > sma20 && sma20 > sma50
      ? "bullish"
      : current.close < sma20 && sma20 < sma50
        ? "bearish"
        : "neutral"
    : "neutral";

  const emaStack: StockMetrics["emaStack"] = sma20 && sma50
    ? sma20 > sma50 ? "bullish" : sma20 < sma50 ? "bearish" : "mixed"
    : "mixed";

  const range = resistance20 - support20 || 1;
  const pullbackQuality = trend === "bullish"
    ? clamp(100 - (distanceToSupport / Math.max(range / current.close * 100, 0.01)) * 100, 0, 100)
    : trend === "bearish"
      ? clamp(100 - (distanceToResistance / Math.max(range / current.close * 100, 0.01)) * 100, 0, 100)
      : 50;

  const percentChange = previous?.close
    ? ((current.close - previous.close) / previous.close) * 100
    : 0;

  const stock: StockMetrics = {
    ticker: symbol,
    exchange: data.meta?.exchange || "",
    price: Number(current.close.toFixed(2)),
    percentChange: Number(percentChange.toFixed(2)),
    trend,
    emaStack,
    rsi: Number((rsi14 || 50).toFixed(1)),
    relVolume: Number(relVolume.toFixed(2)),
    distanceToSupport: Number(distanceToSupport.toFixed(2)),
    distanceToResistance: Number(distanceToResistance.toFixed(2)),
    support20: Number(support20.toFixed(2)),
    resistance20: Number(resistance20.toFixed(2)),
    pullbackQuality: Number(pullbackQuality.toFixed(0)),
  };

  const callScore = computeCallScore(stock);
  const putScore = computePutScore(stock);
  const bestScore = Math.max(callScore, putScore);

  return {
    ...stock,
    callScore,
    putScore,
    bestScore,
    bias: getDirectionalBias(callScore, putScore),
    setupType: getSetupType(callScore, putScore, stock.pullbackQuality),
  };
}

// ── In-memory cache (10 minutes TTL) ─────────────────────────
interface CacheEntry {
  result: StockScanResult;
  fetchedAt: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const symbolCache = new Map<string, CacheEntry>();

export function getCachedResult(symbol: string): StockScanResult | null {
  const entry = symbolCache.get(symbol.toUpperCase());
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    symbolCache.delete(symbol.toUpperCase());
    return null;
  }
  return entry.result;
}

export function setCachedResult(symbol: string, result: StockScanResult): void {
  symbolCache.set(symbol.toUpperCase(), { result, fetchedAt: Date.now() });
}

export function getCacheAgeMs(symbol: string): number | null {
  const entry = symbolCache.get(symbol.toUpperCase());
  if (!entry) return null;
  return Date.now() - entry.fetchedAt;
}

// ── Batch scan with cache ─────────────────────────────────────
// Twelve Data free tier: 8 req/min, 800 req/day
// Stagger requests by 8 seconds to stay under rate limit
const STAGGER_MS = 8000;

export async function scanSymbols(
  symbols: string[],
  apiKey: string,
  onProgress?: (symbol: string, result: StockScanResult) => void
): Promise<{ results: StockScanResult[]; failures: string[] }> {
  const results: StockScanResult[] = [];
  const failures: string[] = [];

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    // Check cache first
    const cached = getCachedResult(symbol);
    if (cached) {
      results.push(cached);
      onProgress?.(symbol, cached);
      continue;
    }
    // Stagger live fetches
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, STAGGER_MS));
    }
    try {
      const result = await fetchSymbolData(symbol, apiKey);
      setCachedResult(symbol, result);
      results.push(result);
      onProgress?.(symbol, result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`${symbol}: ${msg}`);
      console.error(`[TwelveData] Failed to fetch ${symbol}:`, msg);
    }
  }

  return { results, failures };
}

// ── Exported scoring functions for testing ────────────────────
export { computeCallScore, computePutScore, getSetupType, getDirectionalBias };
