/**
 * Price Action Analysis Engine
 * PremiumScan — Raw price action signals, strategy-agnostic
 *
 * Detects 4 signal types:
 * 1. MOMENTUM  — Strong directional candle with above-average body and volume
 * 2. KEY_LEVEL — Price testing a significant support/resistance level
 * 3. BREAKOUT  — Inside bar or consolidation range breakout with volume
 * 4. TREND     — Sustained trend with ADX-proxy strength (directional move over N candles)
 */

import type { Candle } from "./supplyDemand";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PaSignalType = "MOMENTUM" | "KEY_LEVEL" | "BREAKOUT" | "TREND";
export type PaDirection = "BULLISH" | "BEARISH" | "NEUTRAL";
export type PaStrength = "STRONG" | "MODERATE" | "WEAK";

export interface PriceActionSignal {
  signalType: PaSignalType;
  direction: PaDirection;
  strength: PaStrength;
  currentPrice: number;
  keyLevel?: number;        // nearest S/R level (KEY_LEVEL signals)
  rangeHigh?: number;       // breakout range high (BREAKOUT signals)
  rangeLow?: number;        // breakout range low (BREAKOUT signals)
  trendBars?: number;       // how many bars in the trend (TREND signals)
  bodyRatio?: number;       // body / range ratio (MOMENTUM signals)
  volumeRatio?: number;     // candle vol / avg vol
  atrPct?: number;          // candle range as % of ATR
  tags: string[];           // human-readable confluence tags
}

export interface PriceActionResult {
  hasSignal: boolean;
  signals: PriceActionSignal[];
  dominantDirection: PaDirection;
  overallStrength: PaStrength;
  currentPrice: number;
  atr: number;
  avgVolume: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Average True Range over the last `period` candles */
export function calcATR(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

/** Average volume over the last `period` candles (excluding the last candle = current) */
export function calcAvgVolume(candles: Candle[], period = 20): number {
  const slice = candles.slice(-period - 1, -1);
  if (slice.length === 0) return 0;
  return slice.reduce((a, c) => a + c.volume, 0) / slice.length;
}

/** Identify swing highs/lows as key S/R levels using a simple n-bar pivot */
export function findKeyLevels(candles: Candle[], n = 3): number[] {
  const levels: number[] = [];
  for (let i = n; i < candles.length - n; i++) {
    const c = candles[i];
    // Swing high
    const isSwingHigh = candles.slice(i - n, i).every((x) => x.high <= c.high) &&
      candles.slice(i + 1, i + n + 1).every((x) => x.high <= c.high);
    if (isSwingHigh) levels.push(c.high);
    // Swing low
    const isSwingLow = candles.slice(i - n, i).every((x) => x.low >= c.low) &&
      candles.slice(i + 1, i + n + 1).every((x) => x.low >= c.low);
    if (isSwingLow) levels.push(c.low);
  }
  return levels;
}

/** Find the nearest key level to the current price */
export function nearestLevel(price: number, levels: number[]): { level: number; distPct: number } | null {
  if (levels.length === 0) return null;
  let best = levels[0];
  let bestDist = Math.abs(price - levels[0]) / price;
  for (const l of levels) {
    const d = Math.abs(price - l) / price;
    if (d < bestDist) { bestDist = d; best = l; }
  }
  return { level: best, distPct: bestDist * 100 };
}

// ─── Signal Detectors ─────────────────────────────────────────────────────────

/**
 * MOMENTUM: Last candle has a large body (>55% of range) and above-average volume (>1.1x).
 * Candle range must be > 0.6x ATR to filter noise.
 */
function detectMomentum(candles: Candle[], atr: number, avgVolume: number): PriceActionSignal | null {
  if (candles.length < 2) return null;
  const c = candles[candles.length - 1];
  const range = c.high - c.low;
  if (range === 0) return null;

  const bodySize = Math.abs(c.close - c.open);
  const bodyRatio = bodySize / range;
  const volumeRatio = avgVolume > 0 ? c.volume / avgVolume : 1;
  const atrPct = atr > 0 ? range / atr : 0;

  if (bodyRatio < 0.55) return null;
  if (atrPct < 0.6) return null;

  const direction: PaDirection = c.close > c.open ? "BULLISH" : "BEARISH";
  const tags: string[] = [];

  // Strength scoring
  let score = 0;
  if (bodyRatio >= 0.75) { score += 2; tags.push("Strong Body"); }
  else if (bodyRatio >= 0.55) { score += 1; tags.push("Decent Body"); }
  if (volumeRatio >= 1.5) { score += 2; tags.push("Volume Surge"); }
  else if (volumeRatio >= 1.1) { score += 1; tags.push("Above-Avg Volume"); }
  if (atrPct >= 1.5) { score += 1; tags.push("Wide Range"); }

  const strength: PaStrength = score >= 4 ? "STRONG" : score >= 2 ? "MODERATE" : "WEAK";

  return {
    signalType: "MOMENTUM",
    direction,
    strength,
    currentPrice: c.close,
    bodyRatio,
    volumeRatio,
    atrPct,
    tags,
  };
}

/**
 * KEY_LEVEL: Price is within 0.8% of a significant swing high/low.
 * Direction is determined by whether price is approaching from above (resistance) or below (support).
 */
function detectKeyLevel(candles: Candle[], atr: number): PriceActionSignal | null {
  if (candles.length < 20) return null;
  const c = candles[candles.length - 1];
  const levels = findKeyLevels(candles.slice(0, -1), 3);
  const nearest = nearestLevel(c.close, levels);
  if (!nearest) return null;
  if (nearest.distPct > 0.8) return null;

  const direction: PaDirection = nearest.level < c.close ? "BULLISH" : "BEARISH";
  const tags: string[] = [`Key Level @ ${nearest.level.toFixed(2)}`, `${nearest.distPct.toFixed(2)}% away`];

  // Strength: tighter = stronger
  const strength: PaStrength = nearest.distPct < 0.25 ? "STRONG" : nearest.distPct < 0.5 ? "MODERATE" : "WEAK";

  return {
    signalType: "KEY_LEVEL",
    direction,
    strength,
    currentPrice: c.close,
    keyLevel: nearest.level,
    tags,
  };
}

/**
 * BREAKOUT: Detects a consolidation range (low ATR period) followed by a breakout candle.
 * Looks back 5-15 candles for a tight range, then checks if the last candle breaks out.
 */
function detectBreakout(candles: Candle[], atr: number, avgVolume: number): PriceActionSignal | null {
  if (candles.length < 20) return null;

  // Look at the last 5-12 candles (excluding the last) for a consolidation range
  const lookback = candles.slice(-13, -1);
  const rangeHigh = Math.max(...lookback.map((c) => c.high));
  const rangeLow = Math.min(...lookback.map((c) => c.low));
  const rangeSize = rangeHigh - rangeLow;

  // Consolidation: range must be < 1.5x ATR (tight)
  if (rangeSize > atr * 1.5) return null;

  const c = candles[candles.length - 1];
  const volumeRatio = avgVolume > 0 ? c.volume / avgVolume : 1;

  const bullBreak = c.close > rangeHigh && c.close > c.open;
  const bearBreak = c.close < rangeLow && c.close < c.open;

  if (!bullBreak && !bearBreak) return null;

  const direction: PaDirection = bullBreak ? "BULLISH" : "BEARISH";
  const tags: string[] = ["Consolidation Break"];
  if (volumeRatio >= 1.3) tags.push("Volume Confirmation");
  if (rangeSize < atr * 0.8) tags.push("Tight Range");

  const score = (volumeRatio >= 1.3 ? 2 : 0) + (rangeSize < atr * 0.8 ? 1 : 0);
  const strength: PaStrength = score >= 2 ? "STRONG" : score >= 1 ? "MODERATE" : "WEAK";

  return {
    signalType: "BREAKOUT",
    direction,
    strength,
    currentPrice: c.close,
    rangeHigh,
    rangeLow,
    volumeRatio,
    tags,
  };
}

/**
 * TREND: Detects a sustained directional move using a simple ADX proxy.
 * Counts consecutive higher-highs/higher-lows (bullish) or lower-highs/lower-lows (bearish)
 * over the last N candles. Requires at least 5 bars of consistent direction.
 */
function detectTrend(candles: Candle[]): PriceActionSignal | null {
  if (candles.length < 15) return null;

  const slice = candles.slice(-15);
  let bullBars = 0;
  let bearBars = 0;

  for (let i = 1; i < slice.length; i++) {
    const prev = slice[i - 1];
    const curr = slice[i];
    if (curr.high > prev.high && curr.low > prev.low) bullBars++;
    else if (curr.high < prev.high && curr.low < prev.low) bearBars++;
  }

  const dominantBull = bullBars >= 7;
  const dominantBear = bearBars >= 7;
  if (!dominantBull && !dominantBear) return null;

  const direction: PaDirection = dominantBull ? "BULLISH" : "BEARISH";
  const trendBars = dominantBull ? bullBars : bearBars;
  const tags: string[] = [`${trendBars}/14 bars trending`];
  if (trendBars >= 10) tags.push("Strong Trend");
  else if (trendBars >= 8) tags.push("Moderate Trend");

  const strength: PaStrength = trendBars >= 10 ? "STRONG" : trendBars >= 8 ? "MODERATE" : "WEAK";

  const c = candles[candles.length - 1];
  return {
    signalType: "TREND",
    direction,
    strength,
    currentPrice: c.close,
    trendBars,
    tags,
  };
}

// ─── Main Evaluator ───────────────────────────────────────────────────────────

export function evaluatePriceAction(candles: Candle[]): PriceActionResult {
  const noSignal: PriceActionResult = {
    hasSignal: false,
    signals: [],
    dominantDirection: "NEUTRAL",
    overallStrength: "WEAK",
    currentPrice: candles.length > 0 ? candles[candles.length - 1].close : 0,
    atr: 0,
    avgVolume: 0,
  };

  if (candles.length < 20) return noSignal;

  const atr = calcATR(candles);
  const avgVolume = calcAvgVolume(candles);
  const currentPrice = candles[candles.length - 1].close;

  const signals: PriceActionSignal[] = [];

  const momentum = detectMomentum(candles, atr, avgVolume);
  if (momentum) signals.push(momentum);

  const keyLevel = detectKeyLevel(candles, atr);
  if (keyLevel) signals.push(keyLevel);

  const breakout = detectBreakout(candles, atr, avgVolume);
  if (breakout) signals.push(breakout);

  const trend = detectTrend(candles);
  if (trend) signals.push(trend);

  if (signals.length === 0) return noSignal;

  // Determine dominant direction by vote
  const bullCount = signals.filter((s) => s.direction === "BULLISH").length;
  const bearCount = signals.filter((s) => s.direction === "BEARISH").length;
  const dominantDirection: PaDirection =
    bullCount > bearCount ? "BULLISH" : bearCount > bullCount ? "BEARISH" : "NEUTRAL";

  // Overall strength: highest single signal strength
  const strengthOrder: Record<PaStrength, number> = { STRONG: 2, MODERATE: 1, WEAK: 0 };
  const maxStrength = signals.reduce((best, s) =>
    strengthOrder[s.strength] > strengthOrder[best] ? s.strength : best,
    "WEAK" as PaStrength
  );

  return {
    hasSignal: true,
    signals,
    dominantDirection,
    overallStrength: maxStrength,
    currentPrice,
    atr,
    avgVolume,
  };
}
