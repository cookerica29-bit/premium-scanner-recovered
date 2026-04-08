/**
 * Forex Price Action Engine
 * Raw price action strategy for forex pairs.
 */

import type { Candle } from "./supplyDemand";
import { calcEMA } from "./emaPullback";

export type KeyLevelType = "SWING_HIGH" | "SWING_LOW" | "ROUND_NUMBER" | "SESSION_HIGH" | "SESSION_LOW";

export interface KeyLevel {
  price: number;
  type: KeyLevelType;
  strength: number;
  touchCount: number;
}

export interface PatternResult {
  found: boolean;
  direction: "LONG" | "SHORT";
  level: KeyLevel | null;
  patternName: string;
}

export interface ForexPALevels {
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskRewardRatio: number;
}

export interface ForexPASetup {
  setupType: "LONG" | "SHORT";
  quality: "PREMIUM" | "STRONG" | "DEVELOPING";
  patternLabel: string;
  keyLevel: KeyLevel;
  levels: ForexPALevels;
  confluences: string[];
  qualityScore: number;
  currentPrice: number;
  atr: number;
}

export interface ForexPAResult {
  hasSetup: boolean;
  setup?: ForexPASetup;
}

function calcATR(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0.001;
  const trs = candles.slice(-period).map((c, i, arr) => {
    if (i === 0) return c.high - c.low;
    const prev = arr[i - 1];
    return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  });
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

export function detectSwingLevels(candles: Candle[], lookback = 20): KeyLevel[] {
  if (candles.length < 10) return [];
  const levels: KeyLevel[] = [];
  const recent = candles.slice(-lookback);

  for (let i = 1; i < recent.length - 1; i++) {
    const prev = recent[i - 1];
    const curr = recent[i];
    const next = recent[i + 1];

    if (curr.high > prev.high && curr.high > next.high) {
      const touchCount = recent.filter(c => Math.abs(c.high - curr.high) / curr.high < 0.001).length;
      levels.push({ price: curr.high, type: "SWING_HIGH", strength: touchCount >= 2 ? 2 : 1, touchCount });
    }

    if (curr.low < prev.low && curr.low < next.low) {
      const touchCount = recent.filter(c => Math.abs(c.low - curr.low) / curr.low < 0.001).length;
      levels.push({ price: curr.low, type: "SWING_LOW", strength: touchCount >= 2 ? 2 : 1, touchCount });
    }
  }

  return levels;
}

function detectRoundNumbers(candles: Candle[], pair: string): KeyLevel[] {
  if (candles.length === 0) return [];
  const isJPY = pair.includes("JPY");
  const step = isJPY ? 0.50 : 0.0050;
  const currentPrice = candles[candles.length - 1].close;
  const atr = calcATR(candles);
  const range = atr * 10;
  const levels: KeyLevel[] = [];

  const lower = Math.floor((currentPrice - range) / step) * step;
  const upper = Math.ceil((currentPrice + range) / step) * step;
  const majorStep = isJPY ? 1.0 : 0.0100;

  for (let p = lower; p <= upper; p += step) {
    const rounded = Math.round(p / step) * step;
    const isMajor = Math.abs(rounded % majorStep) < step * 0.01;
    levels.push({ price: rounded, type: "ROUND_NUMBER", strength: isMajor ? 3 : 1, touchCount: 1 });
  }

  return levels;
}

function detectSessionLevels(candles: Candle[]): KeyLevel[] {
  if (candles.length < 10) return [];
  const session = candles.slice(-24);
  const sessionHigh = Math.max(...session.map(c => c.high));
  const sessionLow = Math.min(...session.map(c => c.low));
  return [
    { price: sessionHigh, type: "SESSION_HIGH", strength: 2, touchCount: 1 },
    { price: sessionLow, type: "SESSION_LOW", strength: 2, touchCount: 1 },
  ];
}

function mergeKeyLevels(levels: KeyLevel[]): KeyLevel[] {
  const merged: KeyLevel[] = [];
  for (const level of levels) {
    const existing = merged.find(m => Math.abs(m.price - level.price) / level.price < 0.0005);
    if (existing) {
      if (level.strength > existing.strength) {
        existing.strength = level.strength;
        existing.touchCount = Math.max(existing.touchCount, level.touchCount);
      }
    } else {
      merged.push({ ...level });
    }
  }
  return merged;
}

export function detectPinBar(candles: Candle[], keyLevels: KeyLevel[], atr: number): PatternResult {
  const noResult: PatternResult = { found: false, direction: "LONG", level: null, patternName: "Pin Bar" };
  if (candles.length < 3) return noResult;

  const candle = candles[candles.length - 1];
  const range = candle.high - candle.low;
  if (range < atr * 0.3) return noResult;

  const bodyTop = Math.max(candle.open, candle.close);
  const bodyBottom = Math.min(candle.open, candle.close);
  const upperWick = candle.high - bodyTop;
  const lowerWick = bodyBottom - candle.low;

  if (lowerWick > range * 0.6 && bodyBottom > candle.low + range * 0.4) {
    const level = keyLevels
      .filter(l => (l.type === "SWING_LOW" || l.type === "ROUND_NUMBER" || l.type === "SESSION_LOW")
        && Math.abs(l.price - candle.low) <= atr * 1.5)
      .sort((a, b) => Math.abs(a.price - candle.low) - Math.abs(b.price - candle.low))[0];
    if (level) return { found: true, direction: "LONG", level, patternName: "Pin Bar Rejection" };
  }

  if (upperWick > range * 0.6 && bodyTop < candle.high - range * 0.4) {
    const level = keyLevels
      .filter(l => (l.type === "SWING_HIGH" || l.type === "ROUND_NUMBER" || l.type === "SESSION_HIGH")
        && Math.abs(l.price - candle.high) <= atr * 1.5)
      .sort((a, b) => Math.abs(a.price - candle.high) - Math.abs(b.price - candle.high))[0];
    if (level) return { found: true, direction: "SHORT", level, patternName: "Pin Bar Rejection" };
  }

  return noResult;
}

export function detectEngulfing(candles: Candle[], keyLevels: KeyLevel[], atr: number): PatternResult {
  const noResult: PatternResult = { found: false, direction: "LONG", level: null, patternName: "Engulfing" };
  if (candles.length < 3) return noResult;

  const curr = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const currBodyTop = Math.max(curr.open, curr.close);
  const currBodyBot = Math.min(curr.open, curr.close);
  const prevBodyTop = Math.max(prev.open, prev.close);
  const prevBodyBot = Math.min(prev.open, prev.close);
  const currBodySize = currBodyTop - currBodyBot;

  if (currBodySize < atr * 0.2) return noResult;

  if (curr.close > curr.open && currBodyTop > prevBodyTop && currBodyBot < prevBodyBot) {
    const level = keyLevels
      .filter(l => (l.type === "SWING_LOW" || l.type === "ROUND_NUMBER" || l.type === "SESSION_LOW")
        && Math.abs(l.price - currBodyBot) <= atr * 2.0)
      .sort((a, b) => Math.abs(a.price - currBodyBot) - Math.abs(b.price - currBodyBot))[0];
    if (level) return { found: true, direction: "LONG", level, patternName: "Bullish Engulfing" };
  }

  if (curr.close < curr.open && currBodyBot < prevBodyBot && currBodyTop > prevBodyTop) {
    const level = keyLevels
      .filter(l => (l.type === "SWING_HIGH" || l.type === "ROUND_NUMBER" || l.type === "SESSION_HIGH")
        && Math.abs(l.price - currBodyTop) <= atr * 2.0)
      .sort((a, b) => Math.abs(a.price - currBodyTop) - Math.abs(b.price - currBodyTop))[0];
    if (level) return { found: true, direction: "SHORT", level, patternName: "Bearish Engulfing" };
  }

  return noResult;
}

export function detectInsideBar(
  candles: Candle[],
  keyLevels: KeyLevel[],
  atr: number,
  htfBias: "BULL" | "BEAR" | "NEUTRAL"
): PatternResult {
  const noResult: PatternResult = { found: false, direction: "LONG", level: null, patternName: "Inside Bar" };
  if (candles.length < 3 || htfBias === "NEUTRAL") return noResult;

  const curr = candles[candles.length - 1];
  const mother = candles[candles.length - 2];
  if (curr.high >= mother.high || curr.low <= mother.low) return noResult;

  const currentPrice = curr.close;
  const level = keyLevels
    .filter(l => Math.abs(l.price - currentPrice) <= atr * 3.0)
    .sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice))[0];

  if (!level) return noResult;

  const direction = htfBias === "BULL" ? "LONG" : "SHORT";
  return { found: true, direction, level, patternName: "Inside Bar Breakout" };
}

export function detectBreakAndRetest(candles: Candle[], keyLevels: KeyLevel[], atr: number): PatternResult {
  const noResult: PatternResult = { found: false, direction: "LONG", level: null, patternName: "Break & Retest" };
  if (candles.length < 15) return noResult;

  const currentCandle = candles[candles.length - 1];
  const currentPrice = currentCandle.close;
  const lookback = candles.slice(-12, -2);

  for (const level of keyLevels) {
    const breakThreshold = atr * 0.3;
    const retestRange = atr * 1.5;

    const bullishBreak = lookback.find(c => c.close > level.price + breakThreshold);
    if (bullishBreak && currentPrice >= level.price - retestRange && currentPrice <= level.price + retestRange) {
      if (currentCandle.close > currentCandle.open) {
        return { found: true, direction: "LONG", level, patternName: "Break & Retest" };
      }
    }

    const bearishBreak = lookback.find(c => c.close < level.price - breakThreshold);
    if (bearishBreak && currentPrice >= level.price - retestRange && currentPrice <= level.price + retestRange) {
      if (currentCandle.close < currentCandle.open) {
        return { found: true, direction: "SHORT", level, patternName: "Break & Retest" };
      }
    }
  }

  return noResult;
}

export function evaluateForexHTFTrend(htfCandles: Candle[]): "BULL" | "BEAR" | "NEUTRAL" {
  if (htfCandles.length < 55) return "NEUTRAL";
  const ema20 = calcEMA(htfCandles, 20);
  const ema50 = calcEMA(htfCandles, 50);
  const lastIdx = htfCandles.length - 1;
  const e20 = ema20[lastIdx];
  const e50 = ema50[lastIdx];
  if (e20 === null || e50 === null) return "NEUTRAL";
  const separation = Math.abs(e20 - e50) / e50;
  if (separation < 0.0005) return "NEUTRAL";
  if (e20 > e50) return "BULL";
  if (e20 < e50) return "BEAR";
  return "NEUTRAL";
}

export function evaluateForexPriceAction(
  candles: Candle[],
  pair: string,
  htfCandles: Candle[]
): ForexPAResult {
  if (candles.length < 30) return { hasSetup: false };

  const atr = calcATR(candles);
  const htfBias = evaluateForexHTFTrend(htfCandles);

  const swingLevels = detectSwingLevels(candles, 30);
  const roundNumbers = detectRoundNumbers(candles, pair);
  const sessionLevels = detectSessionLevels(candles);
  const allLevels = mergeKeyLevels([...swingLevels, ...roundNumbers, ...sessionLevels]);

  if (allLevels.length === 0) return { hasSetup: false };

  const patterns: PatternResult[] = [
    detectPinBar(candles, allLevels, atr),
    detectEngulfing(candles, allLevels, atr),
    detectInsideBar(candles, allLevels, atr, htfBias),
    detectBreakAndRetest(candles, allLevels, atr),
  ].filter(p => p.found);

  if (patterns.length === 0) return { hasSetup: false };

  const htfAligned = patterns.filter(p =>
    (p.direction === "LONG" && htfBias === "BULL") ||
    (p.direction === "SHORT" && htfBias === "BEAR")
  );
  const best = htfAligned.length > 0 ? htfAligned[0] : patterns[0];

  let qualityScore = 3;
  const confluences: string[] = [];

  if (htfAligned.length > 0) { qualityScore += 2; confluences.push("HTF Trend Aligned"); }

  const sameLevel = patterns.filter(p =>
    p.level && best.level && Math.abs(p.level.price - best.level.price) / best.level.price < 0.002
  );
  if (sameLevel.length >= 2) { qualityScore += 2; confluences.push(`${sameLevel.length} Patterns Confluent`); }

  if (best.level?.type === "ROUND_NUMBER") { qualityScore += 1; confluences.push("Round Number Level"); }
  if (best.level?.type === "SESSION_HIGH" || best.level?.type === "SESSION_LOW") { qualityScore += 1; confluences.push("Session Level"); }
  if (best.level && best.level.touchCount >= 2) { qualityScore += 1; confluences.push("Tested Level"); }

  if (qualityScore < 5) return { hasSetup: false };

  const currentCandle = candles[candles.length - 1];
  const currentPrice = currentCandle.close;
  const direction = best.direction;
  const levelPrice = best.level!.price;

  let entry: number;
  let stopLoss: number;
  let takeProfit: number;

  if (direction === "LONG") {
    entry = currentPrice;
    // SL below the demand zone: use the lowest swing low in the 30-bar lookback
    // (the bottom of the demand zone), then add a 0.5 ATR buffer below it.
    // This gives the trade room to breathe through the zone rather than stopping
    // out at the top of it.
    const swingLows = swingLevels
      .filter(l => l.type === "SWING_LOW" && l.price < entry)
      .map(l => l.price);
    const zoneBottom = swingLows.length > 0 ? Math.min(...swingLows) : levelPrice;
    stopLoss = zoneBottom - atr * 0.5;
    const risk = entry - stopLoss;
    takeProfit = entry + risk * 2.0;
  } else {
    entry = currentPrice;
    // SL above the supply zone: use the highest swing high in the 30-bar lookback
    // (the top of the supply zone), then add a 0.5 ATR buffer above it.
    const swingHighs = swingLevels
      .filter(l => l.type === "SWING_HIGH" && l.price > entry)
      .map(l => l.price);
    const zoneTop = swingHighs.length > 0 ? Math.max(...swingHighs) : levelPrice;
    stopLoss = zoneTop + atr * 0.5;
    const risk = stopLoss - entry;
    takeProfit = entry - risk * 2.0;
  }

  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(takeProfit - entry);
  const riskRewardRatio = risk > 0 ? reward / risk : 0;

  if (riskRewardRatio < 1.5) return { hasSetup: false };

  const quality: "PREMIUM" | "STRONG" | "DEVELOPING" =
    qualityScore >= 8 ? "PREMIUM" : qualityScore >= 6 ? "STRONG" : "DEVELOPING";

  return {
    hasSetup: true,
    setup: {
      setupType: direction,
      quality,
      patternLabel: best.patternName,
      keyLevel: best.level!,
      levels: { entry, stopLoss, takeProfit, riskRewardRatio },
      confluences,
      qualityScore,
      currentPrice,
      atr,
    },
  };
}
