/**
 * Supply & Demand Zone Detection Engine
 * Raw Price Action Analysis for PremiumScan
 *
 * Strategy:
 * - Demand Zone: A consolidation base followed by a strong bullish impulse move
 * - Supply Zone: A consolidation base followed by a strong bearish impulse move
 * - Premium setups: Price returning to a fresh zone with PA confirmation
 */

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Zone {
  type: "DEMAND" | "SUPPLY";
  top: number;
  bottom: number;
  formed: string; // ISO timestamp
  impulseStrength: number; // 0-100 score
  testCount: number;
  isFresh: boolean;
  baseCandles: number; // how many candles formed the base
}

export interface PriceActionSignal {
  type: "REJECTION_WICK" | "ENGULFING" | "INSIDE_BAR_BREAK" | "PIN_BAR" | "NONE";
  strength: number; // 0-100
  direction: "BULLISH" | "BEARISH";
}

export interface SetupResult {
  hasSetup: boolean;
  direction: "LONG" | "SHORT" | null;
  quality: "PREMIUM" | "STRONG" | "DEVELOPING" | null;
  zone: Zone | null;
  signal: PriceActionSignal | null;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  takeProfit2: number;
  takeProfit3: number;
  rrRatio: number;
  confluences: string[];
  pattern: string;
  currentPrice: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function candleSize(c: Candle): number {
  return Math.abs(c.close - c.open);
}

function candleRange(c: Candle): number {
  return c.high - c.low;
}

function isBullish(c: Candle): boolean {
  return c.close > c.open;
}

function isBearish(c: Candle): boolean {
  return c.close < c.open;
}

function avgCandleSize(candles: Candle[]): number {
  if (candles.length === 0) return 0;
  return candles.reduce((s, c) => s + candleSize(c), 0) / candles.length;
}

function avgCandleRange(candles: Candle[]): number {
  if (candles.length === 0) return 0;
  return candles.reduce((s, c) => s + candleRange(c), 0) / candles.length;
}

// ─── Impulse Detection ────────────────────────────────────────────────────────

/**
 * Detect if a sequence of candles starting at index `start` forms a strong impulse move.
 * Returns impulse strength 0-100 and direction.
 */
function detectImpulse(
  candles: Candle[],
  start: number,
  lookForward: number = 3
): { isImpulse: boolean; direction: "BULLISH" | "BEARISH"; strength: number; endIdx: number } {
  const avg = avgCandleSize(candles);
  if (avg === 0) return { isImpulse: false, direction: "BULLISH", strength: 0, endIdx: start };

  let bullCount = 0;
  let bearCount = 0;
  let totalMove = 0;
  let endIdx = Math.min(start + lookForward, candles.length - 1);

  for (let i = start; i <= endIdx; i++) {
    const c = candles[i];
    if (isBullish(c)) bullCount++;
    else bearCount++;
    totalMove += candleSize(c);
  }

  const dominantBull = bullCount > bearCount;
  const direction: "BULLISH" | "BEARISH" = dominantBull ? "BULLISH" : "BEARISH";

  // Impulse: avg candle size in the move is at least 1.5x overall avg
  const moveAvg = totalMove / (endIdx - start + 1);
  const isImpulse = moveAvg >= avg * 1.4;

  // Strength: ratio of move avg to overall avg, capped at 100
  const rawStrength = Math.min(100, Math.round((moveAvg / avg) * 50));

  return { isImpulse, direction, strength: rawStrength, endIdx };
}

// ─── Base Detection ───────────────────────────────────────────────────────────

/**
 * Detect a consolidation base before an impulse.
 * A base is 2-6 small candles with overlapping ranges.
 */
function detectBase(
  candles: Candle[],
  beforeIdx: number
): { hasBase: boolean; baseTop: number; baseBottom: number; baseStart: number; baseEnd: number } {
  const avg = avgCandleRange(candles);
  let baseEnd = beforeIdx;
  let baseStart = beforeIdx;

  // Walk backwards to find small-range candles
  for (let i = beforeIdx; i >= Math.max(0, beforeIdx - 6); i--) {
    const c = candles[i];
    if (candleRange(c) <= avg * 1.2) {
      baseStart = i;
    } else {
      break;
    }
  }

  const baseCandles = candles.slice(baseStart, baseEnd + 1);
  if (baseCandles.length < 2) return { hasBase: false, baseTop: 0, baseBottom: 0, baseStart, baseEnd };

  const baseTop = Math.max(...baseCandles.map((c) => c.high));
  const baseBottom = Math.min(...baseCandles.map((c) => c.low));

  return { hasBase: true, baseTop, baseBottom, baseStart, baseEnd };
}

// ─── Zone Detection ───────────────────────────────────────────────────────────

export function detectZones(candles: Candle[]): Zone[] {
  const zones: Zone[] = [];
  if (candles.length < 10) return zones;

  const avg = avgCandleSize(candles);

  for (let i = 3; i < candles.length - 4; i++) {
    const impulse = detectImpulse(candles, i, 3);
    if (!impulse.isImpulse) continue;

    // Look for a base before this impulse
    const base = detectBase(candles, i - 1);
    if (!base.hasBase) continue;

    const zoneType: "DEMAND" | "SUPPLY" = impulse.direction === "BULLISH" ? "DEMAND" : "SUPPLY";

    // Count how many times price has returned to this zone
    const zoneTop = base.baseTop;
    const zoneBottom = base.baseBottom;
    let testCount = 0;

    for (let j = impulse.endIdx + 1; j < candles.length; j++) {
      const c = candles[j];
      // Price touched the zone
      if (
        (zoneType === "DEMAND" && c.low <= zoneTop && c.low >= zoneBottom - avg * 0.5) ||
        (zoneType === "SUPPLY" && c.high >= zoneBottom && c.high <= zoneTop + avg * 0.5)
      ) {
        testCount++;
      }
    }

    zones.push({
      type: zoneType,
      top: zoneTop,
      bottom: zoneBottom,
      formed: candles[base.baseStart].time,
      impulseStrength: impulse.strength,
      testCount,
      isFresh: testCount <= 1,
      baseCandles: base.baseEnd - base.baseStart + 1,
    });
  }

  // Deduplicate overlapping zones (keep stronger one)
  const deduped: Zone[] = [];
  for (const z of zones) {
    const overlap = deduped.find(
      (d) =>
        d.type === z.type &&
        Math.abs(d.top - z.top) < (z.top - z.bottom) * 0.5
    );
    if (!overlap) {
      deduped.push(z);
    } else if (z.impulseStrength > overlap.impulseStrength) {
      deduped.splice(deduped.indexOf(overlap), 1, z);
    }
  }

  return deduped;
}

// ─── Price Action Signal Detection ───────────────────────────────────────────

export function detectPriceActionSignal(candles: Candle[]): PriceActionSignal {
  if (candles.length < 3) return { type: "NONE", strength: 0, direction: "BULLISH" };

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const prev2 = candles[candles.length - 3];
  const avg = avgCandleRange(candles);

  const body = Math.abs(last.close - last.open);
  const upperWick = last.high - Math.max(last.close, last.open);
  const lowerWick = Math.min(last.close, last.open) - last.low;
  const totalRange = last.high - last.low;

  // Pin Bar / Rejection Wick: wick >= 2x body, body in top/bottom 1/3
  if (totalRange > avg * 0.8) {
    if (lowerWick >= body * 2 && lowerWick >= totalRange * 0.5) {
      return {
        type: "PIN_BAR",
        strength: Math.min(100, Math.round((lowerWick / totalRange) * 100)),
        direction: "BULLISH",
      };
    }
    if (upperWick >= body * 2 && upperWick >= totalRange * 0.5) {
      return {
        type: "PIN_BAR",
        strength: Math.min(100, Math.round((upperWick / totalRange) * 100)),
        direction: "BEARISH",
      };
    }
  }

  // Bullish Engulfing
  if (
    isBearish(prev) &&
    isBullish(last) &&
    last.close > prev.open &&
    last.open < prev.close &&
    candleSize(last) > candleSize(prev) * 0.9
  ) {
    return {
      type: "ENGULFING",
      strength: Math.min(100, Math.round((candleSize(last) / candleSize(prev)) * 60)),
      direction: "BULLISH",
    };
  }

  // Bearish Engulfing
  if (
    isBullish(prev) &&
    isBearish(last) &&
    last.close < prev.open &&
    last.open > prev.close &&
    candleSize(last) > candleSize(prev) * 0.9
  ) {
    return {
      type: "ENGULFING",
      strength: Math.min(100, Math.round((candleSize(last) / candleSize(prev)) * 60)),
      direction: "BEARISH",
    };
  }

  // Rejection Wick (less extreme than pin bar)
  if (lowerWick >= body * 1.5 && isBullish(last)) {
    return { type: "REJECTION_WICK", strength: 55, direction: "BULLISH" };
  }
  if (upperWick >= body * 1.5 && isBearish(last)) {
    return { type: "REJECTION_WICK", strength: 55, direction: "BEARISH" };
  }

  // Inside Bar Break
  if (last.high < prev2.high && last.low > prev2.low && prev.high < prev2.high && prev.low > prev2.low) {
    const dir = last.close > prev.close ? "BULLISH" : "BEARISH";
    return { type: "INSIDE_BAR_BREAK", strength: 50, direction: dir };
  }

  return { type: "NONE", strength: 0, direction: "BULLISH" };
}

// ─── HTF Trend Detection ──────────────────────────────────────────────────────

export function detectTrend(candles: Candle[]): "BULLISH" | "BEARISH" | "NEUTRAL" {
  if (candles.length < 20) return "NEUTRAL";

  // Simple: compare last 5 closes vs 20 candles ago
  const recent = candles.slice(-5);
  const older = candles.slice(-20, -15);

  const recentAvg = recent.reduce((s, c) => s + c.close, 0) / recent.length;
  const olderAvg = older.reduce((s, c) => s + c.close, 0) / older.length;

  const diff = (recentAvg - olderAvg) / olderAvg;

  if (diff > 0.005) return "BULLISH";
  if (diff < -0.005) return "BEARISH";
  return "NEUTRAL";
}

// ─── Main Setup Evaluator ─────────────────────────────────────────────────────

export function evaluateSetup(
  candles: Candle[],
  htfCandles: Candle[] // Higher timeframe candles for trend
): SetupResult {
  const noSetup: SetupResult = {
    hasSetup: false,
    direction: null,
    quality: null,
    zone: null,
    signal: null,
    entry: 0,
    stopLoss: 0,
    takeProfit: 0,
    takeProfit2: 0,
    takeProfit3: 0,
    rrRatio: 0,
    confluences: [],
    pattern: "",
    currentPrice: candles.length > 0 ? candles[candles.length - 1].close : 0,
  };

  if (candles.length < 20) return noSetup;

  const currentPrice = candles[candles.length - 1].close;
  const avgRange = avgCandleRange(candles);
  const htfTrend = detectTrend(htfCandles);
  const zones = detectZones(candles);
  const signal = detectPriceActionSignal(candles);

  // Find the most relevant zone price is currently at
  let bestZone: Zone | null = null;
  let bestScore = 0;

  for (const zone of zones) {
    const zoneHeight = zone.top - zone.bottom;
    const buffer = avgRange * 1.5;

    const priceAtDemand =
      zone.type === "DEMAND" &&
      currentPrice >= zone.bottom - buffer &&
      currentPrice <= zone.top + buffer;

    const priceAtSupply =
      zone.type === "SUPPLY" &&
      currentPrice >= zone.bottom - buffer &&
      currentPrice <= zone.top + buffer;

    if (!priceAtDemand && !priceAtSupply) continue;

    // Score: impulse strength + freshness + signal alignment
    let score = zone.impulseStrength;
    if (zone.isFresh) score += 30;
    if (zone.testCount === 0) score += 20;

    // Signal alignment bonus
    if (zone.type === "DEMAND" && signal.direction === "BULLISH" && signal.type !== "NONE") {
      score += signal.strength * 0.3;
    }
    if (zone.type === "SUPPLY" && signal.direction === "BEARISH" && signal.type !== "NONE") {
      score += signal.strength * 0.3;
    }

    if (score > bestScore) {
      bestScore = score;
      bestZone = zone;
    }
  }

  if (!bestZone) return { ...noSetup, currentPrice };

  const direction: "LONG" | "SHORT" = bestZone.type === "DEMAND" ? "LONG" : "SHORT";
  const confluences: string[] = [];

  // Build confluences list
  if (bestZone.isFresh) confluences.push("Fresh Zone (Untested)");
  if (bestZone.testCount === 0) confluences.push("First Touch");
  if (bestZone.impulseStrength >= 70) confluences.push("Strong Impulse Origin");
  if (bestZone.baseCandles >= 3) confluences.push("Clear Base Structure");
  if (signal.type !== "NONE") confluences.push(`PA Signal: ${signal.type.replace(/_/g, " ")}`);
  if (htfTrend === "BULLISH" && direction === "LONG") confluences.push("HTF Trend Aligned (Bullish)");
  if (htfTrend === "BEARISH" && direction === "SHORT") confluences.push("HTF Trend Aligned (Bearish)");
  if (htfTrend === "NEUTRAL") confluences.push("HTF Trend Neutral");

  // Calculate levels
  let entry: number;
  let stopLoss: number;

  if (direction === "LONG") {
    entry = parseFloat(bestZone.top.toFixed(5));
    stopLoss = parseFloat((bestZone.bottom - avgRange * 0.3).toFixed(5));
  } else {
    entry = parseFloat(bestZone.bottom.toFixed(5));
    stopLoss = parseFloat((bestZone.top + avgRange * 0.3).toFixed(5));
  }

  const risk = Math.abs(entry - stopLoss);
  if (risk === 0) return { ...noSetup, currentPrice };

  const takeProfit = parseFloat((direction === "LONG" ? entry + risk * 2 : entry - risk * 2).toFixed(5));
  const takeProfit2 = parseFloat((direction === "LONG" ? entry + risk * 3 : entry - risk * 3).toFixed(5));
  const takeProfit3 = parseFloat((direction === "LONG" ? entry + risk * 4 : entry - risk * 4).toFixed(5));

  const rrRatio = parseFloat((Math.abs(takeProfit - entry) / risk).toFixed(1));

  // Quality scoring
  let qualityScore = 0;
  if (bestZone.isFresh) qualityScore += 3;
  if (bestZone.testCount === 0) qualityScore += 2;
  if (bestZone.impulseStrength >= 70) qualityScore += 2;
  if (signal.type !== "NONE") qualityScore += 2;
  if (signal.strength >= 70) qualityScore += 1;
  if (htfTrend !== "NEUTRAL" && ((htfTrend === "BULLISH" && direction === "LONG") || (htfTrend === "BEARISH" && direction === "SHORT"))) qualityScore += 2;

  let quality: "PREMIUM" | "STRONG" | "DEVELOPING";
  if (qualityScore >= 8) quality = "PREMIUM";
  else if (qualityScore >= 5) quality = "STRONG";
  else quality = "DEVELOPING";

  // Pattern name
  const patternNames: Record<string, string> = {
    "DEMAND_PIN_BAR": "Demand Zone + Pin Bar",
    "DEMAND_ENGULFING": "Demand Zone + Engulfing",
    "DEMAND_REJECTION_WICK": "Demand Zone + Rejection Wick",
    "DEMAND_INSIDE_BAR_BREAK": "Demand Zone + Inside Bar",
    "DEMAND_NONE": "Demand Zone Test",
    "SUPPLY_PIN_BAR": "Supply Zone + Pin Bar",
    "SUPPLY_ENGULFING": "Supply Zone + Engulfing",
    "SUPPLY_REJECTION_WICK": "Supply Zone + Rejection Wick",
    "SUPPLY_INSIDE_BAR_BREAK": "Supply Zone + Inside Bar",
    "SUPPLY_NONE": "Supply Zone Test",
  };
  const patternKey = `${bestZone.type}_${signal.type}`;
  const pattern = patternNames[patternKey] || `${bestZone.type === "DEMAND" ? "Demand" : "Supply"} Zone`;

  return {
    hasSetup: true,
    direction,
    quality,
    zone: bestZone,
    signal,
    entry,
    stopLoss,
    takeProfit,
    takeProfit2,
    takeProfit3,
    rrRatio,
    confluences,
    pattern,
    currentPrice,
  };
}
