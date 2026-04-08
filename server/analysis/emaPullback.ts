/**
 * EMA Pullback + Momentum Strategy Engine
 * Stock Screener for PremiumScan
 *
 * Strategy Logic:
 * 1. Trend Filter: 20 EMA above 50 EMA (CALL) or below (PUT) — price can be near EMA
 * 2. Pullback: Price has pulled back to within 3% of the 20 EMA in the last 8 candles
 * 3. Momentum Confirmation: The most recent closed candle shows a bullish/bearish
 *    momentum candle (engulfing, pin bar, or strong close) confirming the bounce
 * 4. Levels: Entry = confirmation candle close, SL = pullback low/high (with buffer),
 *    TP = prior swing high/low targeting 1.5:1+ RR
 */

import type { Candle } from "./supplyDemand";

// ─── Re-export SetupResult shape (compatible with existing screener) ──────────

export interface EmaSetupResult {
  hasSetup: boolean;
  direction: "LONG" | "SHORT" | null;
  quality: "PREMIUM" | "STRONG" | "DEVELOPING" | null;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  takeProfit2: number;
  takeProfit3: number;
  rrRatio: number;
  confluences: string[];
  pattern: string;
  currentPrice: number;
  ema20: number | null;
  ema50: number | null;
  // ── Final-build enhanced fields ──────────────────────────────────────────
  structureBias: string;       // "Bullish Structure" | "Bearish Structure" | "Mixed Structure"
  structureScore: number;      // 0-100
  locationTag: string;         // "Near Support" | "Near Resistance" | "Mid Range" | "Tight Range"
  locationScore: number;       // 0-100
  roomToMove: string;          // "Good Room" | "Limited Room" | "Poor Room" | "Range"
  roomScore: number;           // 0-100
  timingState: string;         // "READY" | "WATCH" | "EARLY" | "AVOID"
  setupQuality: string;        // "A" | "B" | "C"
  finalTradeScore: number;     // 0-100 composite
  reason: string;              // human-readable summary
  distanceToSupport: number;   // % from current price to 20-day low
  distanceToResistance: number; // % from current price to 20-day high
  support20: number;
  resistance20: number;
  rsi14: number;
  relVolume: number;
  bestScore: number;           // max(callScore, putScore)
  callScore: number;
  putScore: number;
  // ── Part 2 fields ──────────────────────────────────────────────────────────
  previousDayHigh: number | null;       // PDH from daily candles
  previousDayLow: number | null;        // PDL from daily candles
  liquidityContext: string;             // "AbovePDH" | "BelowPDL" | "NearPDH" | "NearPDL" | "WithinPDRange"
  displacementDetected: boolean;        // true if a large displacement candle found
  displacementDirection: string;        // "Bullish" | "Bearish" | "None"
  sessionLabel: string;                 // "London" | "NewYork" | "Overlap" | "PreMarket" | "AfterHours" | "Asia"
}

// ─── Final-Build Scoring Helpers ────────────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function calcRSI(candles: Candle[], period: number = 14): number {
  if (candles.length <= period) return 50;
  // Use closes in chronological order (oldest first)
  const closes = candles.map((c) => c.close);
  let gains = 0, losses = 0;
  for (let i = closes.length - period - 1; i < closes.length - 1; i++) {
    const delta = closes[i + 1] - closes[i];
    if (delta >= 0) gains += delta;
    else losses += Math.abs(delta);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return parseFloat((100 - 100 / (1 + rs)).toFixed(1));
}

function getStructureBias(candles: Candle[]): { bias: string; score: number } {
  if (candles.length < 10) return { bias: "Mixed Structure", score: 45 };
  // candles are chronological (oldest first), so last 5 = most recent
  const recent = candles.slice(-5);
  const prior = candles.slice(-10, -5);
  const recentHigh = Math.max(...recent.map((c) => c.high));
  const recentLow = Math.min(...recent.map((c) => c.low));
  const priorHigh = Math.max(...prior.map((c) => c.high));
  const priorLow = Math.min(...prior.map((c) => c.low));
  const close = candles[candles.length - 1].close;
  if (recentHigh > priorHigh && recentLow > priorLow && close > priorHigh)
    return { bias: "Bullish Structure", score: 90 };
  if (recentHigh < priorHigh && recentLow < priorLow && close < priorLow)
    return { bias: "Bearish Structure", score: 90 };
  if (recentHigh > priorHigh && recentLow >= priorLow)
    return { bias: "Bullish Structure", score: 74 };
  if (recentHigh < priorHigh && recentLow <= priorLow)
    return { bias: "Bearish Structure", score: 74 };
  return { bias: "Mixed Structure", score: 45 };
}

function getLocationTag(distToSupport: number, distToResistance: number): { tag: string; score: number } {
  if (distToSupport <= 2.5 && distToResistance >= 3.5) return { tag: "Near Support", score: 88 };
  if (distToResistance <= 2.5 && distToSupport >= 3.5) return { tag: "Near Resistance", score: 88 };
  if (distToSupport > 2.5 && distToResistance > 2.5) return { tag: "Mid Range", score: 45 };
  return { tag: "Tight Range", score: 35 };
}

function getRoom(
  distToSupport: number,
  distToResistance: number,
  bias: string
): { tag: string; score: number } {
  if (bias === "Calls") {
    if (distToResistance >= 4) return { tag: "Good Room", score: 85 };
    if (distToResistance >= 2) return { tag: "Limited Room", score: 58 };
    return { tag: "Poor Room", score: 25 };
  }
  if (bias === "Puts") {
    if (distToSupport >= 4) return { tag: "Good Room", score: 85 };
    if (distToSupport >= 2) return { tag: "Limited Room", score: 58 };
    return { tag: "Poor Room", score: 25 };
  }
  return { tag: "Range", score: 35 };
}

function computeCallScore(params: {
  structureBias: string; locationTag: string; roomToMove: string; rsi14: number; relVolume: number;
}): number {
  const structureBoost = params.structureBias === "Bullish Structure" ? 25 : params.structureBias === "Mixed Structure" ? 12 : 0;
  const locationBoost = params.locationTag === "Near Support" ? 30 : params.locationTag === "Mid Range" ? 7 : 0;
  const roomBoost = params.roomToMove === "Good Room" ? 20 : params.roomToMove === "Limited Room" ? 10 : 0;
  const momentumBoost = clamp(15 - Math.abs(params.rsi14 - 58), 0, 15);
  const volumeBoost = clamp(params.relVolume * 7, 0, 10);
  return Math.round(clamp(structureBoost + locationBoost + roomBoost + momentumBoost + volumeBoost, 0, 100));
}

function computePutScore(params: {
  structureBias: string; locationTag: string; roomToMove: string; rsi14: number; relVolume: number;
}): number {
  const structureBoost = params.structureBias === "Bearish Structure" ? 25 : params.structureBias === "Mixed Structure" ? 12 : 0;
  const locationBoost = params.locationTag === "Near Resistance" ? 30 : params.locationTag === "Mid Range" ? 7 : 0;
  const roomBoost = params.roomToMove === "Good Room" ? 20 : params.roomToMove === "Limited Room" ? 10 : 0;
  const momentumBoost = clamp(15 - Math.abs(params.rsi14 - 42), 0, 15);
  const volumeBoost = clamp(params.relVolume * 7, 0, 10);
  return Math.round(clamp(structureBoost + locationBoost + roomBoost + momentumBoost + volumeBoost, 0, 100));
}

function getTimingState(params: {
  locationTag: string; roomToMove: string; bestScore: number; relVolume: number; rsi14: number;
  liquidityContext?: string; displacementDetected?: boolean;
}): string {
  const atLevel = params.locationTag === "Near Support" || params.locationTag === "Near Resistance";
  const extended = params.locationTag === "Mid Range" && params.rsi14 > 70;
  const noRoom = params.roomToMove === "Poor Room";
  const strongSetup = params.bestScore >= 80;
  const decentSetup = params.bestScore >= 70;
  const momentumStarting = params.relVolume >= 1.2 && clamp(100 - Math.abs(params.rsi14 - 50) * 1.6, 35, 90) >= 55;
  // Part 2: liquidity context boosts or blocks timing
  const atPDLevel = params.liquidityContext === "NearPDH" || params.liquidityContext === "NearPDL"
    || params.liquidityContext === "AbovePDH" || params.liquidityContext === "BelowPDL";
  const displacementBoost = params.displacementDetected === true;
  if (extended || noRoom || params.locationTag === "Tight Range") return "AVOID";
  // Displacement at a key level = strongest READY signal
  if ((atLevel || atPDLevel) && strongSetup && momentumStarting && displacementBoost) return "READY";
  if (atLevel && strongSetup && momentumStarting) return "READY";
  // PDH/PDL proximity upgrades WATCH → READY when setup is strong enough
  if (atPDLevel && decentSetup && momentumStarting) return "READY";
  if (atLevel && decentSetup) return "WATCH";
  if (atPDLevel && decentSetup) return "WATCH";
  if (!atLevel && decentSetup) return "EARLY";
  return "AVOID";
}

function buildReason(params: {
  setupType: string; structureBias: string; locationTag: string; roomToMove: string; timingState: string;
  liquidityContext?: string; displacementDetected?: boolean; sessionLabel?: string;
}): string {
  const parts: string[] = [
    `${params.setupType} with ${params.structureBias.toLowerCase()}`,
    params.locationTag.toLowerCase(),
    params.roomToMove.toLowerCase(),
  ];
  if (params.liquidityContext && params.liquidityContext !== "WithinPDRange") {
    parts.push(params.liquidityContext.replace(/([A-Z])/g, " $1").trim().toLowerCase());
  }
  if (params.displacementDetected) parts.push("displacement detected");
  parts.push(`${params.timingState.toLowerCase()} timing`);
  if (params.sessionLabel && params.sessionLabel !== "AfterHours") {
    parts.push(`${params.sessionLabel} session`);
  }
  return parts.join(", ") + ".";
}

// ─── Part 2: PDH/PDL Liquidity Context ──────────────────────────────────────

/**
 * Extract previous day's high and low from a daily candle array.
 * "Previous day" = the second-to-last candle (last completed day).
 */
export function getPDHL(dailyCandles: Candle[]): { pdh: number | null; pdl: number | null } {
  if (dailyCandles.length < 2) return { pdh: null, pdl: null };
  const prev = dailyCandles[dailyCandles.length - 2];
  return {
    pdh: parseFloat(prev.high.toFixed(4)),
    pdl: parseFloat(prev.low.toFixed(4)),
  };
}

/**
 * Classify price position relative to PDH/PDL.
 * NearPDH/NearPDL = within 0.5% of the level.
 */
export function getLiquidityContext(
  price: number,
  pdh: number | null,
  pdl: number | null
): string {
  if (pdh === null || pdl === null) return "WithinPDRange";
  const nearThreshold = 0.005; // 0.5%
  if (price > pdh * (1 + nearThreshold)) return "AbovePDH";
  if (price < pdl * (1 - nearThreshold)) return "BelowPDL";
  if (Math.abs(price - pdh) / pdh <= nearThreshold) return "NearPDH";
  if (Math.abs(price - pdl) / pdl <= nearThreshold) return "NearPDL";
  return "WithinPDRange";
}

/**
 * Detect a displacement candle — a single candle whose body is > 1.5x the 14-period ATR.
 * Returns the direction of the most recent displacement in the last 5 candles, or "None".
 */
export function detectDisplacement(
  candles: Candle[]
): { detected: boolean; direction: string } {
  if (candles.length < 15) return { detected: false, direction: "None" };
  const atr = calcATR(candles, 14);
  const threshold = atr * 1.5;
  // Check last 5 candles for displacement
  const recent = candles.slice(-5);
  for (let i = recent.length - 1; i >= 0; i--) {
    const c = recent[i];
    const body = Math.abs(c.close - c.open);
    if (body >= threshold) {
      return {
        detected: true,
        direction: c.close > c.open ? "Bullish" : "Bearish",
      };
    }
  }
  return { detected: false, direction: "None" };
}

/**
 * Label the current trading session based on UTC hour.
 * Sessions (approximate UTC):
 *   PreMarket:  08:00–13:30 UTC (US pre-market)
 *   London:     07:00–12:00 UTC
 *   Overlap:    12:00–13:30 UTC (London/NY overlap)
 *   NewYork:    13:30–20:00 UTC
 *   AfterHours: 20:00–00:00 UTC
 *   Asia:       00:00–07:00 UTC
 */
export function getSessionLabel(nowUtcHour?: number): string {
  const hour = nowUtcHour ?? new Date().getUTCHours();
  if (hour >= 0 && hour < 7) return "Asia";
  if (hour >= 7 && hour < 12) return "London";
  if (hour >= 12 && hour < 13) return "Overlap"; // London/NY overlap start
  if (hour === 13) return "Overlap"; // 13:00–14:00 UTC (pre-NY open to NY open)
  if (hour >= 14 && hour < 20) return "NewYork";
  if (hour >= 20 && hour < 24) return "AfterHours";
  return "NewYork";
}

// ─── EMA Calculation ──────────────────────────────────────────────────────────

/**
 * Calculate Exponential Moving Average for all candles.
 * Returns an array of EMA values aligned to the candles array (index-for-index).
 * The first `period - 1` values are null (insufficient data).
 */
export function calcEMA(candles: Candle[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length < period) return result;

  // Seed with SMA of first `period` closes
  let sum = 0;
  for (let i = 0; i < period; i++) sum += candles[i].close;
  const k = 2 / (period + 1);
  result[period - 1] = sum / period;

  for (let i = period; i < candles.length; i++) {
    result[i] = candles[i].close * k + result[i - 1]! * (1 - k);
  }

  return result;
}

// ─── Swing High/Low Detection ─────────────────────────────────────────────────

/**
 * Find the most recent swing high in the last `lookback` candles.
 * A swing high is a candle whose high is higher than the `n` candles on each side.
 */
function findSwingHigh(candles: Candle[], lookback: number = 60, n: number = 2): number | null {
  const start = Math.max(n, candles.length - lookback);
  const end = candles.length - n - 1; // exclude the last few candles (not confirmed)

  let bestHigh: number | null = null;
  let bestIdx = -1;

  for (let i = end; i >= start; i--) {
    const c = candles[i];
    let isSwing = true;
    for (let j = i - n; j <= i + n; j++) {
      if (j === i) continue;
      if (j < 0 || j >= candles.length) continue;
      if (candles[j].high >= c.high) { isSwing = false; break; }
    }
    if (isSwing) {
      if (i > bestIdx) { bestIdx = i; bestHigh = c.high; }
    }
  }

  return bestHigh;
}

/**
 * Find the most recent swing low in the last `lookback` candles.
 */
function findSwingLow(candles: Candle[], lookback: number = 60, n: number = 2): number | null {
  const start = Math.max(n, candles.length - lookback);
  const end = candles.length - n - 1;

  let bestLow: number | null = null;
  let bestIdx = -1;

  for (let i = end; i >= start; i--) {
    const c = candles[i];
    let isSwing = true;
    for (let j = i - n; j <= i + n; j++) {
      if (j === i) continue;
      if (j < 0 || j >= candles.length) continue;
      if (candles[j].low <= c.low) { isSwing = false; break; }
    }
    if (isSwing) {
      if (i > bestIdx) { bestIdx = i; bestLow = c.low; }
    }
  }

  return bestLow;
}

// ─── Momentum Candle Detection ────────────────────────────────────────────────

interface MomentumSignal {
  type: "ENGULFING" | "PIN_BAR" | "STRONG_CLOSE" | "NONE";
  direction: "BULLISH" | "BEARISH";
  strength: number; // 0-100
}

function detectMomentumCandle(candles: Candle[]): MomentumSignal {
  if (candles.length < 3) return { type: "NONE", direction: "BULLISH", strength: 0 };

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  const body = Math.abs(last.close - last.open);
  const range = last.high - last.low;
  const upperWick = last.high - Math.max(last.close, last.open);
  const lowerWick = Math.min(last.close, last.open) - last.low;

  // Average body size over last 10 candles
  const recentBodies = candles.slice(-10).map((c) => Math.abs(c.close - c.open));
  const avgBody = recentBodies.reduce((s, b) => s + b, 0) / recentBodies.length;

  // Bullish Engulfing: prev bearish, last bullish, last body engulfs prev body
  // Relaxed: body just needs to be >= 60% of avgBody
  if (
    prev.close < prev.open &&
    last.close > last.open &&
    last.close > prev.open &&
    last.open < prev.close &&
    body >= avgBody * 0.6
  ) {
    return {
      type: "ENGULFING",
      direction: "BULLISH",
      strength: Math.min(100, Math.round((body / (avgBody || 1)) * 55)),
    };
  }

  // Bearish Engulfing
  if (
    prev.close > prev.open &&
    last.close < last.open &&
    last.close < prev.open &&
    last.open > prev.close &&
    body >= avgBody * 0.6
  ) {
    return {
      type: "ENGULFING",
      direction: "BEARISH",
      strength: Math.min(100, Math.round((body / (avgBody || 1)) * 55)),
    };
  }

  // Bullish Pin Bar: long lower wick (>= 45% of range), small body near top
  if (range > 0 && lowerWick >= range * 0.45 && lowerWick >= body * 1.5 && last.close > last.open) {
    return {
      type: "PIN_BAR",
      direction: "BULLISH",
      strength: Math.min(100, Math.round((lowerWick / range) * 100)),
    };
  }

  // Bearish Pin Bar: long upper wick (>= 45% of range), small body near bottom
  if (range > 0 && upperWick >= range * 0.45 && upperWick >= body * 1.5 && last.close < last.open) {
    return {
      type: "PIN_BAR",
      direction: "BEARISH",
      strength: Math.min(100, Math.round((upperWick / range) * 100)),
    };
  }

  // Strong Close: body >= 55% of range (relaxed from 65%), direction confirmed
  if (range > 0 && body / range >= 0.55 && body >= avgBody * 0.7) {
    const dir = last.close > last.open ? "BULLISH" : "BEARISH";
    return {
      type: "STRONG_CLOSE",
      direction: dir,
      strength: Math.min(100, Math.round((body / range) * 80)),
    };
  }

  return { type: "NONE", direction: "BULLISH", strength: 0 };
}

// ─── ATR Calculation ──────────────────────────────────────────────────────────

function calcATR(candles: Candle[], period: number = 14): number {
  if (candles.length < period + 1) {
    // Fallback: average range
    const ranges = candles.map((c) => c.high - c.low);
    return ranges.reduce((s, r) => s + r, 0) / ranges.length;
  }

  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    );
    trs.push(tr);
  }

  // Simple average of last `period` TRs
  const recent = trs.slice(-period);
  return recent.reduce((s, t) => s + t, 0) / recent.length;
}

// ─── Pullback Detection ───────────────────────────────────────────────────────

/**
 * Check if price has recently pulled back to the 20 EMA.
 * "Pulled back" means: in the last `lookback` candles, the low (for LONG) or
 * high (for SHORT) touched within `tolerance` of the EMA.
 * Relaxed: uses candle wick (low/high) not just close, and wider tolerance.
 */
function detectPullback(
  candles: Candle[],
  ema20: (number | null)[],
  direction: "LONG" | "SHORT",
  lookback: number = 8,
  tolerancePct: number = 0.03
): { hasPullback: boolean; pullbackLow: number; pullbackHigh: number } {
  const n = candles.length;
  if (n < lookback + 1) return { hasPullback: false, pullbackLow: 0, pullbackHigh: 0 };

  const start = n - lookback;
  let hasPullback = false;
  let pullbackLow = Infinity;
  let pullbackHigh = -Infinity;

  for (let i = start; i < n; i++) {
    const ema = ema20[i];
    if (ema === null) continue;
    const c = candles[i];

    if (direction === "LONG") {
      // Candle low touched within tolerance% of EMA (either side)
      const touchedEMA = c.low <= ema * (1 + tolerancePct) && c.low >= ema * (1 - tolerancePct * 2);
      if (touchedEMA) {
        hasPullback = true;
        pullbackLow = Math.min(pullbackLow, c.low);
        pullbackHigh = Math.max(pullbackHigh, c.high);
      }
    } else {
      // Candle high touched within tolerance% of EMA
      const touchedEMA = c.high >= ema * (1 - tolerancePct) && c.high <= ema * (1 + tolerancePct * 2);
      if (touchedEMA) {
        hasPullback = true;
        pullbackLow = Math.min(pullbackLow, c.low);
        pullbackHigh = Math.max(pullbackHigh, c.high);
      }
    }
  }

  return { hasPullback, pullbackLow, pullbackHigh };
}

// ─── HTF Trend Evaluator ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate the trend direction of a higher-timeframe candle series.
 * Uses 20/50 EMA alignment (same logic as the primary filter).
 * Returns "BULL" when 20 EMA > 50 EMA, "BEAR" when below, "NEUTRAL" when flat/insufficient data.
 */
export function evaluateHTFTrend(htfCandles: Candle[]): "BULL" | "BEAR" | "NEUTRAL" {
  if (htfCandles.length < 55) return "NEUTRAL";
  const ema20 = calcEMA(htfCandles, 20);
  const ema50 = calcEMA(htfCandles, 50);
  const lastEma20 = ema20[ema20.length - 1];
  const lastEma50 = ema50[ema50.length - 1];
  if (lastEma20 === null || lastEma50 === null) return "NEUTRAL";
  if (lastEma20 > lastEma50 * 1.001) return "BULL"; // 0.1% buffer to avoid noise
  if (lastEma20 < lastEma50 * 0.999) return "BEAR";
  return "NEUTRAL";
}

// ─── 2-Bar Confirmation ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if the last 2 candles both confirm the direction.
 * Requires the second-to-last candle to also be a momentum candle in the same direction.
 * This significantly raises the bar for PREMIUM quality.
 */
function detectTwoBarConfirmation(candles: Candle[], direction: "LONG" | "SHORT"): boolean {
  if (candles.length < 4) return false;
  // Check the candle before the last one (candles[-2]) for directional confirmation
  const prevCandles = candles.slice(0, -1); // exclude the last candle
  const prevMomentum = detectMomentumCandle(prevCandles);
  if (prevMomentum.type === "NONE") return false;
  if (direction === "LONG" && prevMomentum.direction !== "BULLISH") return false;
  if (direction === "SHORT" && prevMomentum.direction !== "BEARISH") return false;
  return prevMomentum.strength >= 40; // both candles need meaningful strength
}

// ─── Options Interface ─────────────────────────────────────────────────────────────────────────────

export interface EmaEvalOptions {
  /** Pre-fetched HTF candles for regime filtering. If null/empty, HTF filter is skipped. */
  htfCandles?: Candle[] | null;
  /** Pattern win rates from journal history. Key = pattern name, value = win rate 0-1. */
  patternWinRates?: Record<string, number>;
  /** Relative strength score vs SPY over 20 days. Positive = outperforming. */
  relativeStrength?: number | null;
}

// ─── Main Evaluator ─────────────────────────────────────────────────────────────────────────────

export function evaluateEmaPullback(candles: Candle[], options: EmaEvalOptions = {}): EmaSetupResult {
  // ── Pre-compute final-build fields (available regardless of setup) ──────────
  const last20Candles = candles.slice(-20);
  const support20 = parseFloat(Math.min(...last20Candles.map((c) => c.low)).toFixed(2));
  const resistance20 = parseFloat(Math.max(...last20Candles.map((c) => c.high)).toFixed(2));
  const price0 = candles.length > 0 ? candles[candles.length - 1].close : 0;
  const distToSupport = support20 > 0 ? parseFloat(((price0 - support20) / price0 * 100).toFixed(2)) : 0;
  const distToResistance = resistance20 > 0 ? parseFloat(((resistance20 - price0) / price0 * 100).toFixed(2)) : 0;
  const rsi14Val = calcRSI(candles, 14);
  const avgVol20 = candles.length >= 21
    ? candles.slice(-21, -1).reduce((s, c) => s + (c.volume ?? 0), 0) / 20
    : 0;
  const lastVol = candles.length > 0 ? (candles[candles.length - 1].volume ?? 0) : 0;
  const relVolumeVal = avgVol20 > 0 ? parseFloat((lastVol / avgVol20).toFixed(2)) : 1;
  const structureResult = getStructureBias(candles);
  const locationResult = getLocationTag(distToSupport, distToResistance);
  const tempBias = structureResult.bias === "Bullish Structure" ? "Calls" : structureResult.bias === "Bearish Structure" ? "Puts" : "Neutral";
  const roomResult = getRoom(distToSupport, distToResistance, tempBias);
  const callScoreVal = computeCallScore({ structureBias: structureResult.bias, locationTag: locationResult.tag, roomToMove: roomResult.tag, rsi14: rsi14Val, relVolume: relVolumeVal });
  const putScoreVal = computePutScore({ structureBias: structureResult.bias, locationTag: locationResult.tag, roomToMove: roomResult.tag, rsi14: rsi14Val, relVolume: relVolumeVal });
  const bestScoreVal = Math.max(callScoreVal, putScoreVal);
  // ── Part 2: PDH/PDL, displacement, session ────────────────────────────────
  const { pdh: pdhVal, pdl: pdlVal } = getPDHL(candles);
  const liquidityCtx = getLiquidityContext(price0, pdhVal, pdlVal);
  const dispResult = detectDisplacement(candles);
  const sessionLabelVal = getSessionLabel();
  const timingVal = getTimingState({ locationTag: locationResult.tag, roomToMove: roomResult.tag, bestScore: bestScoreVal, relVolume: relVolumeVal, rsi14: rsi14Val, liquidityContext: liquidityCtx, displacementDetected: dispResult.detected });
  const setupQualityVal = bestScoreVal >= 80 ? "A" : bestScoreVal >= 65 ? "B" : "C";
  const finalTradeScoreVal = Math.round(clamp(
    bestScoreVal * 0.55 + structureResult.score * 0.15 + locationResult.score * 0.15 + roomResult.score * 0.10 +
    (timingVal === "READY" ? 100 : timingVal === "WATCH" ? 75 : timingVal === "EARLY" ? 45 : 10) * 0.05,
    0, 100
  ));
  const setupTypeLabel = tempBias === "Calls" && locationResult.tag === "Near Support" ? "Reversal (Support)"
    : tempBias === "Puts" && locationResult.tag === "Near Resistance" ? "Reversal (Resistance)"
    : tempBias === "Calls" && structureResult.bias === "Bullish Structure" ? "Continuation (Bullish)"
    : tempBias === "Puts" && structureResult.bias === "Bearish Structure" ? "Continuation (Bearish)"
    : "Wait / Range";
  const reasonVal = buildReason({ setupType: setupTypeLabel, structureBias: structureResult.bias, locationTag: locationResult.tag, roomToMove: roomResult.tag, timingState: timingVal, liquidityContext: liquidityCtx, displacementDetected: dispResult.detected, sessionLabel: sessionLabelVal });

  const noSetup: EmaSetupResult = {
    hasSetup: false,
    direction: null,
    quality: null,
    entry: 0,
    stopLoss: 0,
    takeProfit: 0,
    takeProfit2: 0,
    takeProfit3: 0,
    rrRatio: 0,
    confluences: [],
    pattern: "",
    currentPrice: price0,
    ema20: null,
    ema50: null,
    structureBias: structureResult.bias,
    structureScore: structureResult.score,
    locationTag: locationResult.tag,
    locationScore: locationResult.score,
    roomToMove: roomResult.tag,
    roomScore: roomResult.score,
    timingState: timingVal,
    setupQuality: setupQualityVal,
    finalTradeScore: finalTradeScoreVal,
    reason: reasonVal,
    distanceToSupport: distToSupport,
    distanceToResistance: distToResistance,
    support20,
    resistance20,
    rsi14: rsi14Val,
    relVolume: relVolumeVal,
    bestScore: bestScoreVal,
    callScore: callScoreVal,
    putScore: putScoreVal,
    // Part 2
    previousDayHigh: pdhVal,
    previousDayLow: pdlVal,
    liquidityContext: liquidityCtx,
    displacementDetected: dispResult.detected,
    displacementDirection: dispResult.direction,
    sessionLabel: sessionLabelVal,
  };

  if (candles.length < 55) return noSetup; // Need enough data for 50 EMA

  const { htfCandles, patternWinRates, relativeStrength } = options;

  const currentPrice = candles[candles.length - 1].close;
  const ema20 = calcEMA(candles, 20);
  const ema50 = calcEMA(candles, 50);
  const atr = calcATR(candles, 14);

  const lastEma20 = ema20[ema20.length - 1];
  const lastEma50 = ema50[ema50.length - 1];

  if (lastEma20 === null || lastEma50 === null) return { ...noSetup, currentPrice };

  // ── Step 1: Trend Filter ──────────────────────────────────────────────────────────────────────
  // LONG: 20 EMA > 50 EMA (uptrend) — price can be near or slightly below 20 EMA (pullback)
  // SHORT: 20 EMA < 50 EMA (downtrend) — price can be near or slightly above 20 EMA
  const isUptrend = lastEma20 > lastEma50;
  const isDowntrend = lastEma20 < lastEma50;

  if (!isUptrend && !isDowntrend) return { ...noSetup, currentPrice };

  const direction: "LONG" | "SHORT" = isUptrend ? "LONG" : "SHORT";

  // ── Step 1a: Price-Relative-to-EMA Check ─────────────────────────────────────────────────────────
  // This is the most critical filter. It ensures we are looking for a PULLBACK, not a breakdown.
  //
  // LONG setup: price must be at or near the 20 EMA (within 4% above or below).
  //   - If price is far above the EMA (>4%), the move has already happened — not a pullback.
  //   - If price is far below the EMA (>6%), this is a breakdown, not a pullback.
  //
  // SHORT setup: price must be at or near the 20 EMA (within 4% above or below).
  //   - If price is far below the EMA (>4%), the move has already happened — not a pullback.
  //   - If price is far above the EMA (>6%), this is a breakout, not a pullback.
  //
  // This prevents the engine from firing a SHORT when price is strongly above both EMAs
  // (which was the main cause of wrong-direction setups).
  const priceToEma20Pct = (currentPrice - lastEma20) / lastEma20; // positive = price above EMA
  if (direction === "LONG") {
    // Price should be near or slightly below the 20 EMA (pulling back into it)
    // Allow up to 4% above (approaching from above) or 6% below (deep pullback)
    if (priceToEma20Pct > 0.04) return { ...noSetup, currentPrice }; // price too far above — already ran
    if (priceToEma20Pct < -0.06) return { ...noSetup, currentPrice }; // price too far below — breakdown
  } else {
    // SHORT: price should be near or slightly above the 20 EMA (pulling back up into it)
    // Allow up to 4% below (approaching from below) or 6% above (deep pullback up)
    if (priceToEma20Pct < -0.04) return { ...noSetup, currentPrice }; // price too far below — already ran
    if (priceToEma20Pct > 0.06) return { ...noSetup, currentPrice };  // price too far above — breakout
  }

  // ── Step 1b: HTF Regime Filter ──────────────────────────────────────────────────────────────────────
  // Block the setup if the higher timeframe trend opposes the direction.
  // If HTF candles are not yet cached (null), we skip the filter (benefit of the doubt).
  let htfTrend: "BULL" | "BEAR" | "NEUTRAL" = "NEUTRAL";
  if (htfCandles && htfCandles.length >= 55) {
    htfTrend = evaluateHTFTrend(htfCandles);
    if (htfTrend !== "NEUTRAL") {
      if (direction === "LONG" && htfTrend === "BEAR") return { ...noSetup, currentPrice };
      if (direction === "SHORT" && htfTrend === "BULL") return { ...noSetup, currentPrice };
    }
  }

  // ── Step 1c: Relative Strength Filter ──────────────────────────────────────────────────────────────────────
  // CALL setups require positive RS (stock outperforming SPY).
  // PUT setups require negative RS (stock underperforming SPY).
  // If RS is null (SPY not yet cached), skip the filter.
  const rsAvailable = relativeStrength !== null && relativeStrength !== undefined;
  if (rsAvailable) {
    if (direction === "LONG" && relativeStrength! < 0) return { ...noSetup, currentPrice };
    if (direction === "SHORT" && relativeStrength! > 0) return { ...noSetup, currentPrice };
  }

  // ── Step 2: EMA Slope — ensure the trend is actually moving ───────────────
  // Relaxed: only 0.05% slope over 5 candles to filter flat/choppy markets
  // (0.1% was too strict — pullback phases temporarily reduce EMA slope)
  const ema20_5ago = ema20[ema20.length - 6];
  if (ema20_5ago === null) return { ...noSetup, currentPrice };
  const emaSlopePct = (lastEma20 - ema20_5ago) / ema20_5ago;
  if (Math.abs(emaSlopePct) < 0.0005) return { ...noSetup, currentPrice };

  // ── Step 3: Pullback to 20 EMA ────────────────────────────────────────────
  // Relaxed: 3% tolerance, 8-candle lookback, uses wick not just close
  const { hasPullback, pullbackLow, pullbackHigh } = detectPullback(
    candles, ema20, direction, 8, 0.03
  );
  if (!hasPullback) return { ...noSetup, currentPrice };

  // ── Step 4: Momentum Confirmation Candle ─────────────────────────────────
  const momentum = detectMomentumCandle(candles);

  // Momentum candle must align with direction
  const momentumAligned =
    momentum.type !== "NONE" &&
    ((direction === "LONG" && momentum.direction === "BULLISH") ||
     (direction === "SHORT" && momentum.direction === "BEARISH"));

  if (!momentumAligned) return { ...noSetup, currentPrice };

  // Declare last candle here so it's available for both volume check and level calculation
  const last = candles[candles.length - 1];

  // ── Step 4b: Volume Confirmation ──────────────────────────────────────────────────────────────────────
  // Check if the momentum candle has above-average volume (optional — boosts quality).
  // Safe: engine already requires 55+ candles, so slice(-21,-1) always yields 20 candles.
  const avgVolume20 = candles.slice(-21, -1).reduce((s, c) => s + (c.volume ?? 0), 0) / 20;
  const lastVolume = last.volume ?? 0;
  // avgVolume20 > 0 guard handles edge case where volume data is unavailable (e.g. indices)
  const hasVolumeConfirmation = avgVolume20 > 0 && lastVolume >= avgVolume20 * 1.2;

  // ── Step 4c: Pullback Depth Scoring ──────────────────────────────────────────────────────────────────────
  // How close did the wick get to the EMA? Tight touch = higher quality.
  // We look at the last 8 candles and find the minimum distance to EMA.
  let pullbackDepthPct = 1; // default: loose (>1.5%)
  for (let i = candles.length - 8; i < candles.length; i++) {
    const ema = ema20[i];
    if (ema === null || ema === 0) continue;
    const c = candles[i];
    const wickPrice = direction === "LONG" ? c.low : c.high;
    const distPct = Math.abs(wickPrice - ema) / ema;
    if (distPct < pullbackDepthPct) pullbackDepthPct = distPct;
  }
  // 0 = perfect touch, 0.005 = 0.5%, 0.015 = 1.5%
  const hasPrecisePullback = pullbackDepthPct < 0.005;  // < 0.5% = precise touch
  const hasModeratepullback = pullbackDepthPct < 0.015; // < 1.5% = moderate

  // ── Step 4d: 2-Bar Confirmation ──────────────────────────────────────────────────────────────────────
  // Check if the previous candle also confirmed direction (raises bar for PREMIUM).
  const hasTwoBarConfirmation = detectTwoBarConfirmation(candles, direction);

  // ── Step 5: Calculate Levels ──────────────────────────────────────────────────────────────────────
  const entry = parseFloat(last.close.toFixed(4));

  let stopLoss: number;
  if (direction === "LONG") {
    // SL below the pullback low with 0.3 ATR buffer
    const rawSL = pullbackLow - atr * 0.3;
    // Ensure SL is at least 0.5 ATR below entry
    stopLoss = parseFloat(Math.min(rawSL, entry - atr * 0.5).toFixed(4));
  } else {
    // SL above the pullback high with 0.3 ATR buffer
    const rawSL = pullbackHigh + atr * 0.3;
    stopLoss = parseFloat(Math.max(rawSL, entry + atr * 0.5).toFixed(4));
  }

  const risk = Math.abs(entry - stopLoss);
  if (risk === 0) return { ...noSetup, currentPrice };

  // TP1 = prior swing high/low (if available), else 2:1 RR
  const swingTarget =
    direction === "LONG"
      ? findSwingHigh(candles, 60, 2)
      : findSwingLow(candles, 60, 2);

  let takeProfit: number;
  if (swingTarget !== null) {
    const swingRR = Math.abs(swingTarget - entry) / risk;
    // Use swing target if it gives at least 1.5:1 RR
    takeProfit = swingRR >= 1.5
      ? parseFloat(swingTarget.toFixed(4))
      : parseFloat((direction === "LONG" ? entry + risk * 2 : entry - risk * 2).toFixed(4));
  } else {
    takeProfit = parseFloat((direction === "LONG" ? entry + risk * 2 : entry - risk * 2).toFixed(4));
  }

  const takeProfit2 = parseFloat((direction === "LONG" ? entry + risk * 3 : entry - risk * 3).toFixed(4));
  const takeProfit3 = parseFloat((direction === "LONG" ? entry + risk * 4 : entry - risk * 4).toFixed(4));

  const rrRatio = parseFloat((Math.abs(takeProfit - entry) / risk).toFixed(1));
  if (rrRatio < 1.5) return { ...noSetup, currentPrice };

  // ── Step 6: Build Confluences ─────────────────────────────────────────────
  const confluences: string[] = [];

  // Trend strength
  const emaSeparationPct = Math.abs(lastEma20 - lastEma50) / lastEma50 * 100;
  if (emaSeparationPct > 2) confluences.push("Strong EMA Separation");
  else confluences.push("EMA Trend Aligned (20 > 50)");

  // Slope
  if (Math.abs(emaSlopePct) > 0.005) confluences.push("Strong EMA Slope");

  // Momentum signal
  confluences.push(`Momentum: ${momentum.type.replace(/_/g, " ")}`);
  if (momentum.strength >= 60) confluences.push("High-Strength Momentum Candle");

  // Volume confirmation
  if (hasVolumeConfirmation) confluences.push("Volume Surge");

  // Swing target available
  if (swingTarget !== null) confluences.push("Prior Swing Target Identified");

  // RR quality
  if (rrRatio >= 3) confluences.push(`${rrRatio}:1 Risk-Reward`);
  else if (rrRatio >= 2) confluences.push(`${rrRatio}:1 Risk-Reward`);

  // HTF alignment
  if (htfTrend !== "NEUTRAL" && htfCandles && htfCandles.length >= 55) {
    confluences.push("HTF Trend Aligned");
  }

  // Pullback depth
  if (hasPrecisePullback) confluences.push("Precise EMA Touch");
  else if (hasModeratepullback) confluences.push("Clean EMA Pullback");

  // 2-bar confirmation
  if (hasTwoBarConfirmation) confluences.push("2-Bar Confirmation");

  // Relative strength
  if (rsAvailable) {
    if (direction === "LONG" && relativeStrength! > 0.02) confluences.push("RS Leader vs SPY");
    else if (direction === "SHORT" && relativeStrength! < -0.02) confluences.push("RS Laggard vs SPY");
  }

  // ── Step 7: Quality Scoring ──────────────────────────────────────────────────────────────────────
  let qualityScore = 0;
  if (emaSeparationPct > 2) qualityScore += 2;
  if (Math.abs(emaSlopePct) > 0.005) qualityScore += 2;
  if (momentum.type === "ENGULFING") qualityScore += 3;
  else if (momentum.type === "PIN_BAR") qualityScore += 3;
  else if (momentum.type === "STRONG_CLOSE") qualityScore += 2;
  if (momentum.strength >= 60) qualityScore += 2;
  if (hasVolumeConfirmation) qualityScore += 2;
  if (swingTarget !== null) qualityScore += 1;
  if (rrRatio >= 3) qualityScore += 2;
  else if (rrRatio >= 2) qualityScore += 1;
  // New signals
  if (htfTrend !== "NEUTRAL" && htfCandles && htfCandles.length >= 55) qualityScore += 2; // HTF aligned
  if (hasPrecisePullback) qualityScore += 2; // Tight EMA touch
  else if (hasModeratepullback) qualityScore += 1; // Moderate touch
  if (hasTwoBarConfirmation) qualityScore += 2; // 2-bar confirmation
  if (rsAvailable && direction === "LONG" && relativeStrength! > 0.02) qualityScore += 1; // RS leader
  if (rsAvailable && direction === "SHORT" && relativeStrength! < -0.02) qualityScore += 1; // RS laggard

  // ── Step 8: Pattern Name (computed early so win rate lookup can use it) ──────────────────────────────────────────────────────────────────────
  const dirLabel = direction === "LONG" ? "Bullish" : "Bearish";
  const patternMap: Record<string, string> = {
    ENGULFING: `${dirLabel} EMA Pullback + Engulfing`,
    PIN_BAR: `${dirLabel} EMA Pullback + Pin Bar`,
    STRONG_CLOSE: `${dirLabel} EMA Pullback + Strong Close`,
  };
  const pattern = patternMap[momentum.type] ?? `${dirLabel} EMA Pullback`;

  // Pattern win rate adjustment (from journal history)
  if (patternWinRates) {
    const winRate = patternWinRates[pattern];
    if (winRate !== undefined) {
      if (winRate >= 0.6) { qualityScore += 2; confluences.push(`${Math.round(winRate * 100)}% Win Rate`); }
      else if (winRate <= 0.4) { qualityScore -= 2; confluences.push(`Low Win Rate (${Math.round(winRate * 100)}%)`); }
    }
  }

  // Raise thresholds slightly since we have more signals now (max possible ~22 pts)
  let quality: "PREMIUM" | "STRONG" | "DEVELOPING";
  if (qualityScore >= 10) quality = "PREMIUM";
  else if (qualityScore >= 6) quality = "STRONG";
  else quality = "DEVELOPING";

  return {
    hasSetup: true,
    direction,
    quality,
    entry,
    stopLoss,
    takeProfit,
    takeProfit2,
    takeProfit3,
    rrRatio,
    confluences,
    pattern,
    currentPrice,
    ema20: parseFloat(lastEma20.toFixed(4)),
    ema50: parseFloat(lastEma50.toFixed(4)),
    // Final-build enhanced fields
    structureBias: structureResult.bias,
    structureScore: structureResult.score,
    locationTag: locationResult.tag,
    locationScore: locationResult.score,
    roomToMove: roomResult.tag,
    roomScore: roomResult.score,
    timingState: timingVal,
    setupQuality: setupQualityVal,
    finalTradeScore: finalTradeScoreVal,
    reason: reasonVal,
    distanceToSupport: distToSupport,
    distanceToResistance: distToResistance,
    support20,
    resistance20,
    rsi14: rsi14Val,
    relVolume: relVolumeVal,
    bestScore: bestScoreVal,
    callScore: callScoreVal,
    putScore: putScoreVal,
    // Part 2
    previousDayHigh: pdhVal,
    previousDayLow: pdlVal,
    liquidityContext: liquidityCtx,
    displacementDetected: dispResult.detected,
    displacementDirection: dispResult.direction,
    sessionLabel: sessionLabelVal,
  };
}
