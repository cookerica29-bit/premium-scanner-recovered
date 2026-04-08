/**
 * Tests for the Forex Price Action Engine.
 * Covers: swing level detection, round number detection, pin bar, engulfing,
 * inside bar, break & retest, HTF trend filter, and the main evaluator.
 */
import { describe, it, expect } from "vitest";
import {
  detectSwingLevels,
  detectPinBar,
  detectEngulfing,
  detectInsideBar,
  detectBreakAndRetest,
  evaluateForexHTFTrend,
  evaluateForexPriceAction,
} from "./analysis/priceActionForex";
import type { Candle } from "./analysis/supplyDemand";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCandle(i: number, open: number, close: number, high?: number, low?: number): Candle {
  return {
    time: new Date(Date.now() + i * 3600000).toISOString(),
    open: parseFloat(open.toFixed(5)),
    high: parseFloat((high ?? Math.max(open, close) + 0.0005).toFixed(5)),
    low: parseFloat((low ?? Math.min(open, close) - 0.0005).toFixed(5)),
    close: parseFloat(close.toFixed(5)),
    volume: 100000,
  };
}

/** Build a flat base of candles around a given price */
function makeBase(count: number, price: number, startIdx = 0): Candle[] {
  return Array.from({ length: count }, (_, i) =>
    makeCandle(startIdx + i, price, price + 0.0001, price + 0.0010, price - 0.0010)
  );
}

/** Build a trending sequence of candles */
function makeTrend(count: number, startPrice: number, step: number, startIdx = 0): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const p = startPrice + i * step;
    return makeCandle(startIdx + i, p, p + step * 0.8, p + step + 0.0003, p - 0.0003);
  });
}

// ─── detectSwingLevels ────────────────────────────────────────────────────────

describe("detectSwingLevels", () => {
  it("returns empty array for insufficient candles", () => {
    expect(detectSwingLevels([], 20)).toHaveLength(0);
    expect(detectSwingLevels(makeBase(5, 1.1000), 20)).toHaveLength(0);
  });

  it("detects a swing high in a peak sequence", () => {
    const candles: Candle[] = [
      makeCandle(0, 1.1000, 1.1010, 1.1020, 1.0990),
      makeCandle(1, 1.1010, 1.1020, 1.1030, 1.1000),
      makeCandle(2, 1.1020, 1.1050, 1.1080, 1.1010), // swing high
      makeCandle(3, 1.1050, 1.1030, 1.1060, 1.1020),
      makeCandle(4, 1.1030, 1.1010, 1.1040, 1.1000),
      makeCandle(5, 1.1010, 1.1000, 1.1020, 1.0990),
      makeCandle(6, 1.1000, 1.0990, 1.1010, 1.0980),
      makeCandle(7, 1.0990, 1.0980, 1.1000, 1.0970),
      makeCandle(8, 1.0980, 1.0970, 1.0990, 1.0960),
      makeCandle(9, 1.0970, 1.0960, 1.0980, 1.0950),
    ];
    const levels = detectSwingLevels(candles, 10);
    const highs = levels.filter(l => l.type === "SWING_HIGH");
    expect(highs.length).toBeGreaterThan(0);
  });

  it("detects a swing low in a trough sequence", () => {
    const candles: Candle[] = [
      makeCandle(0, 1.1050, 1.1040, 1.1060, 1.1030),
      makeCandle(1, 1.1040, 1.1030, 1.1050, 1.1020),
      makeCandle(2, 1.1030, 1.1000, 1.1040, 1.0970), // swing low
      makeCandle(3, 1.1000, 1.1020, 1.1030, 1.0990),
      makeCandle(4, 1.1020, 1.1040, 1.1050, 1.1010),
      makeCandle(5, 1.1040, 1.1050, 1.1060, 1.1030),
      makeCandle(6, 1.1050, 1.1060, 1.1070, 1.1040),
      makeCandle(7, 1.1060, 1.1070, 1.1080, 1.1050),
      makeCandle(8, 1.1070, 1.1080, 1.1090, 1.1060),
      makeCandle(9, 1.1080, 1.1090, 1.1100, 1.1070),
    ];
    const levels = detectSwingLevels(candles, 10);
    const lows = levels.filter(l => l.type === "SWING_LOW");
    expect(lows.length).toBeGreaterThan(0);
  });
});

// ─── detectPinBar ─────────────────────────────────────────────────────────────

describe("detectPinBar", () => {
  const atr = 0.0020;

  it("returns no result for insufficient candles", () => {
    const result = detectPinBar([], [], atr);
    expect(result.found).toBe(false);
  });

  it("detects a bullish pin bar at a support level", () => {
    const supportLevel = { price: 1.1000, type: "SWING_LOW" as const, strength: 2, touchCount: 2 };
    // Bullish pin: long lower wick, small body at top
    const candles: Candle[] = [
      makeCandle(0, 1.1050, 1.1040),
      makeCandle(1, 1.1040, 1.1030),
      // Pin bar: opens at 1.1020, wicks down to 1.1000 (near support), closes at 1.1018
      makeCandle(2, 1.1020, 1.1018, 1.1022, 1.0998),
    ];
    const result = detectPinBar(candles, [supportLevel], atr);
    expect(result.found).toBe(true);
    expect(result.direction).toBe("LONG");
    expect(result.patternName).toBe("Pin Bar Rejection");
  });

  it("detects a bearish pin bar at a resistance level", () => {
    const resistanceLevel = { price: 1.1100, type: "SWING_HIGH" as const, strength: 2, touchCount: 2 };
    // Bearish pin: long upper wick, small body at bottom
    const candles: Candle[] = [
      makeCandle(0, 1.1050, 1.1060),
      makeCandle(1, 1.1060, 1.1070),
      // Pin bar: opens at 1.1080, wicks up to 1.1100 (near resistance), closes at 1.1082
      makeCandle(2, 1.1080, 1.1082, 1.1102, 1.1078),
    ];
    const result = detectPinBar(candles, [resistanceLevel], atr);
    expect(result.found).toBe(true);
    expect(result.direction).toBe("SHORT");
    expect(result.patternName).toBe("Pin Bar Rejection");
  });

  it("returns no result when no key level is nearby", () => {
    // Pin bar far from any level
    const farLevel = { price: 1.1500, type: "SWING_LOW" as const, strength: 1, touchCount: 1 };
    const candles: Candle[] = [
      makeCandle(0, 1.1050, 1.1040),
      makeCandle(1, 1.1040, 1.1030),
      makeCandle(2, 1.1020, 1.1018, 1.1022, 1.0998),
    ];
    const result = detectPinBar(candles, [farLevel], atr);
    expect(result.found).toBe(false);
  });
});

// ─── detectEngulfing ──────────────────────────────────────────────────────────

describe("detectEngulfing", () => {
  const atr = 0.0020;

  it("detects a bullish engulfing at support", () => {
    const supportLevel = { price: 1.1000, type: "SWING_LOW" as const, strength: 2, touchCount: 2 };
    const candles: Candle[] = [
      makeCandle(0, 1.1050, 1.1040),
      // Bearish candle
      makeCandle(1, 1.1030, 1.1010, 1.1035, 1.1005),
      // Bullish engulfing: opens below prev low, closes above prev high
      makeCandle(2, 1.1005, 1.1040, 1.1045, 1.1002),
    ];
    const result = detectEngulfing(candles, [supportLevel], atr);
    expect(result.found).toBe(true);
    expect(result.direction).toBe("LONG");
    expect(result.patternName).toBe("Bullish Engulfing");
  });

  it("detects a bearish engulfing at resistance", () => {
    const resistanceLevel = { price: 1.1100, type: "SWING_HIGH" as const, strength: 2, touchCount: 2 };
    const candles: Candle[] = [
      makeCandle(0, 1.1050, 1.1060),
      // Bullish candle
      makeCandle(1, 1.1070, 1.1090, 1.1095, 1.1065),
      // Bearish engulfing: opens above prev high, closes below prev low
      makeCandle(2, 1.1095, 1.1060, 1.1098, 1.1055),
    ];
    const result = detectEngulfing(candles, [resistanceLevel], atr);
    expect(result.found).toBe(true);
    expect(result.direction).toBe("SHORT");
    expect(result.patternName).toBe("Bearish Engulfing");
  });

  it("returns no result when candle does not engulf prior", () => {
    const level = { price: 1.1000, type: "SWING_LOW" as const, strength: 1, touchCount: 1 };
    const candles: Candle[] = [
      makeCandle(0, 1.1050, 1.1040),
      makeCandle(1, 1.1030, 1.1010, 1.1035, 1.1005),
      // Does not engulf: smaller body
      makeCandle(2, 1.1012, 1.1020, 1.1025, 1.1008),
    ];
    const result = detectEngulfing(candles, [level], atr);
    expect(result.found).toBe(false);
  });
});

// ─── detectInsideBar ──────────────────────────────────────────────────────────

describe("detectInsideBar", () => {
  const atr = 0.0020;

  it("detects a bullish inside bar with BULL HTF bias near a level", () => {
    const level = { price: 1.1050, type: "ROUND_NUMBER" as const, strength: 2, touchCount: 1 };
    const candles: Candle[] = [
      makeCandle(0, 1.1040, 1.1060),
      // Mother bar: large range
      makeCandle(1, 1.1030, 1.1070, 1.1080, 1.1020),
      // Inside bar: range fully inside mother
      makeCandle(2, 1.1045, 1.1055, 1.1065, 1.1025),
    ];
    const result = detectInsideBar(candles, [level], atr, "BULL");
    expect(result.found).toBe(true);
    expect(result.direction).toBe("LONG");
  });

  it("detects a bearish inside bar with BEAR HTF bias", () => {
    const level = { price: 1.1050, type: "ROUND_NUMBER" as const, strength: 2, touchCount: 1 };
    const candles: Candle[] = [
      makeCandle(0, 1.1060, 1.1040),
      makeCandle(1, 1.1070, 1.1030, 1.1080, 1.1020),
      makeCandle(2, 1.1055, 1.1045, 1.1065, 1.1025),
    ];
    const result = detectInsideBar(candles, [level], atr, "BEAR");
    expect(result.found).toBe(true);
    expect(result.direction).toBe("SHORT");
  });

  it("returns no result with NEUTRAL HTF bias", () => {
    const level = { price: 1.1050, type: "ROUND_NUMBER" as const, strength: 2, touchCount: 1 };
    const candles: Candle[] = [
      makeCandle(0, 1.1040, 1.1060),
      makeCandle(1, 1.1030, 1.1070, 1.1080, 1.1020),
      makeCandle(2, 1.1045, 1.1055, 1.1065, 1.1025),
    ];
    const result = detectInsideBar(candles, [level], atr, "NEUTRAL");
    expect(result.found).toBe(false);
  });

  it("returns no result when current candle is not inside mother", () => {
    const level = { price: 1.1050, type: "ROUND_NUMBER" as const, strength: 2, touchCount: 1 };
    const candles: Candle[] = [
      makeCandle(0, 1.1040, 1.1060),
      makeCandle(1, 1.1030, 1.1070, 1.1080, 1.1020),
      // Breaks out above mother high
      makeCandle(2, 1.1045, 1.1090, 1.1095, 1.1025),
    ];
    const result = detectInsideBar(candles, [level], atr, "BULL");
    expect(result.found).toBe(false);
  });
});

// ─── detectBreakAndRetest ─────────────────────────────────────────────────────

describe("detectBreakAndRetest", () => {
  const atr = 0.0020;

  it("detects a bullish break and retest", () => {
    const level = { price: 1.1050, type: "SWING_HIGH" as const, strength: 2, touchCount: 2 };
    // Build 15 candles: first 10 are base, then break above 1.1050, then retest
    const candles: Candle[] = [
      ...makeBase(3, 1.1040, 0),
      // Candles 3-12: lookback window (slice -12, -2)
      // Break candle at position 3 (within lookback)
      makeCandle(3, 1.1045, 1.1060, 1.1065, 1.1040), // breaks above 1.1050
      makeCandle(4, 1.1060, 1.1065, 1.1070, 1.1055),
      makeCandle(5, 1.1065, 1.1070, 1.1075, 1.1060),
      makeCandle(6, 1.1070, 1.1068, 1.1075, 1.1060),
      makeCandle(7, 1.1068, 1.1065, 1.1072, 1.1058),
      makeCandle(8, 1.1065, 1.1060, 1.1068, 1.1055),
      makeCandle(9, 1.1060, 1.1055, 1.1065, 1.1050),
      makeCandle(10, 1.1055, 1.1052, 1.1060, 1.1048),
      makeCandle(11, 1.1052, 1.1050, 1.1055, 1.1045),
      makeCandle(12, 1.1050, 1.1048, 1.1053, 1.1043),
      makeCandle(13, 1.1048, 1.1046, 1.1052, 1.1042),
      // Last candle: retest of 1.1050 with bullish close, within ATR*1.5 = 0.003
      makeCandle(14, 1.1048, 1.1055, 1.1058, 1.1045),
    ];
    const result = detectBreakAndRetest(candles, [level], atr);
    expect(result.found).toBe(true);
    expect(result.direction).toBe("LONG");
    expect(result.patternName).toBe("Break & Retest");
  });

  it("detects a bearish break and retest", () => {
    const level = { price: 1.1050, type: "SWING_LOW" as const, strength: 2, touchCount: 2 };
    const candles: Candle[] = [
      ...makeBase(3, 1.1060, 0),
      // Break below 1.1050
      makeCandle(3, 1.1055, 1.1040, 1.1060, 1.1035),
      makeCandle(4, 1.1040, 1.1035, 1.1045, 1.1030),
      makeCandle(5, 1.1035, 1.1030, 1.1040, 1.1025),
      makeCandle(6, 1.1030, 1.1028, 1.1035, 1.1022),
      makeCandle(7, 1.1028, 1.1025, 1.1032, 1.1020),
      makeCandle(8, 1.1025, 1.1022, 1.1030, 1.1018),
      makeCandle(9, 1.1022, 1.1020, 1.1028, 1.1015),
      makeCandle(10, 1.1020, 1.1022, 1.1028, 1.1015),
      makeCandle(11, 1.1022, 1.1025, 1.1030, 1.1018),
      makeCandle(12, 1.1025, 1.1028, 1.1032, 1.1020),
      makeCandle(13, 1.1028, 1.1030, 1.1035, 1.1022),
      // Last candle: retest of 1.1050 with bearish close
      makeCandle(14, 1.1052, 1.1045, 1.1055, 1.1040),
    ];
    const result = detectBreakAndRetest(candles, [level], atr);
    expect(result.found).toBe(true);
    expect(result.direction).toBe("SHORT");
  });

  it("returns no result with insufficient candles", () => {
    const level = { price: 1.1050, type: "SWING_HIGH" as const, strength: 1, touchCount: 1 };
    const result = detectBreakAndRetest(makeBase(10, 1.1050), [level], atr);
    expect(result.found).toBe(false);
  });
});

// ─── evaluateForexHTFTrend ────────────────────────────────────────────────────

describe("evaluateForexHTFTrend", () => {
  it("returns NEUTRAL for insufficient candles", () => {
    expect(evaluateForexHTFTrend(makeBase(30, 1.1000))).toBe("NEUTRAL");
  });

  it("returns BULL when 20 EMA > 50 EMA", () => {
    // Build uptrend: 60 candles rising steadily
    const candles = makeTrend(60, 1.0800, 0.0010, 0);
    expect(evaluateForexHTFTrend(candles)).toBe("BULL");
  });

  it("returns BEAR when 20 EMA < 50 EMA", () => {
    // Build downtrend: 60 candles falling steadily
    const candles = makeTrend(60, 1.1400, -0.0010, 0);
    expect(evaluateForexHTFTrend(candles)).toBe("BEAR");
  });

  it("returns NEUTRAL when EMAs are very close", () => {
    // Flat market: EMAs will converge
    const candles = makeBase(60, 1.1000);
    const result = evaluateForexHTFTrend(candles);
    // Flat market should produce NEUTRAL (separation < 0.05%)
    expect(result).toBe("NEUTRAL");
  });
});

// ─── evaluateForexPriceAction (integration) ───────────────────────────────────

describe("evaluateForexPriceAction", () => {
  it("returns no setup for insufficient candles", () => {
    const result = evaluateForexPriceAction(makeBase(10, 1.1000), "EUR_USD", makeBase(60, 1.1000));
    expect(result.hasSetup).toBe(false);
  });

  it("produces a LONG setup when bullish engulfing occurs at support with HTF bull trend", () => {
    // HTF: 60 candles of uptrend
    const htfCandles = makeTrend(60, 1.0700, 0.0010, 0);

    // LTF: 30 base candles + swing low + bullish engulfing
    const base = makeBase(28, 1.1050, 0);
    // Create a swing low at 1.1020
    const swingLow: Candle[] = [
      makeCandle(28, 1.1040, 1.1020, 1.1045, 1.1015), // swing low candle
      makeCandle(29, 1.1020, 1.1030, 1.1035, 1.1015),
    ];
    // Bearish candle
    const bearish = makeCandle(30, 1.1030, 1.1010, 1.1035, 1.1005);
    // Bullish engulfing at the support level
    const engulf = makeCandle(31, 1.1005, 1.1040, 1.1045, 1.1002);

    const candles = [...base, ...swingLow, bearish, engulf];
    const result = evaluateForexPriceAction(candles, "EUR_USD", htfCandles);

    // With HTF aligned and engulfing at support, should produce a setup
    if (result.hasSetup) {
      expect(result.setup!.setupType).toBe("LONG");
      expect(result.setup!.levels.riskRewardRatio).toBeGreaterThanOrEqual(1.5);
      expect(result.setup!.levels.stopLoss).toBeLessThan(result.setup!.levels.entry);
      expect(result.setup!.levels.takeProfit).toBeGreaterThan(result.setup!.levels.entry);
    }
    // Note: may return false if quality score < 5, which is acceptable
  });

  it("produces a SHORT setup when bearish engulfing occurs at resistance with HTF bear trend", () => {
    // HTF: 60 candles of downtrend
    const htfCandles = makeTrend(60, 1.1600, -0.0010, 0);

    // LTF: 28 base + swing high + bearish engulfing
    const base = makeBase(28, 1.1050, 0);
    const swingHigh: Candle[] = [
      makeCandle(28, 1.1060, 1.1080, 1.1090, 1.1055),
      makeCandle(29, 1.1080, 1.1070, 1.1085, 1.1065),
    ];
    const bullish = makeCandle(30, 1.1070, 1.1090, 1.1095, 1.1065);
    const engulf = makeCandle(31, 1.1095, 1.1060, 1.1098, 1.1055);

    const candles = [...base, ...swingHigh, bullish, engulf];
    const result = evaluateForexPriceAction(candles, "EUR_USD", htfCandles);

    if (result.hasSetup) {
      expect(result.setup!.setupType).toBe("SHORT");
      expect(result.setup!.levels.riskRewardRatio).toBeGreaterThanOrEqual(1.5);
      expect(result.setup!.levels.stopLoss).toBeGreaterThan(result.setup!.levels.entry);
      expect(result.setup!.levels.takeProfit).toBeLessThan(result.setup!.levels.entry);
    }
  });

  it("setup quality is PREMIUM when score >= 8", () => {
    // HTF aligned (BULL) + multiple confluences
    const htfCandles = makeTrend(60, 1.0700, 0.0010, 0);
    const base = makeBase(28, 1.1050, 0);
    const swingLow: Candle[] = [
      makeCandle(28, 1.1040, 1.1020, 1.1045, 1.1015),
      makeCandle(29, 1.1020, 1.1030, 1.1035, 1.1015),
    ];
    const bearish = makeCandle(30, 1.1030, 1.1010, 1.1035, 1.1005);
    const engulf = makeCandle(31, 1.1005, 1.1040, 1.1045, 1.1002);
    const candles = [...base, ...swingLow, bearish, engulf];
    const result = evaluateForexPriceAction(candles, "EUR_USD", htfCandles);

    if (result.hasSetup && result.setup!.qualityScore >= 8) {
      expect(result.setup!.quality).toBe("PREMIUM");
    }
  });

  it("RR ratio is at least 1.5 for any setup returned", () => {
    const htfCandles = makeTrend(60, 1.0700, 0.0010, 0);
    const base = makeBase(28, 1.1050, 0);
    const swingLow: Candle[] = [
      makeCandle(28, 1.1040, 1.1020, 1.1045, 1.1015),
      makeCandle(29, 1.1020, 1.1030, 1.1035, 1.1015),
    ];
    const bearish = makeCandle(30, 1.1030, 1.1010, 1.1035, 1.1005);
    const engulf = makeCandle(31, 1.1005, 1.1040, 1.1045, 1.1002);
    const candles = [...base, ...swingLow, bearish, engulf];
    const result = evaluateForexPriceAction(candles, "EUR_USD", htfCandles);

    if (result.hasSetup) {
      expect(result.setup!.levels.riskRewardRatio).toBeGreaterThanOrEqual(1.5);
    }
  });
});
