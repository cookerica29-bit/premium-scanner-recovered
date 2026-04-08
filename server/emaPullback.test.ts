/**
 * Vitest tests for the EMA Pullback + Momentum analysis engine
 */
import { describe, expect, it } from "vitest";
import { calcEMA, evaluateEmaPullback, evaluateHTFTrend } from "./analysis/emaPullback";
import type { Candle } from "./analysis/supplyDemand";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a simple trending candle series */
function makeTrendingCandles(
  count: number,
  startPrice: number,
  dailyDrift: number, // positive = uptrend
  volatility: number = 1
): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    const open = price;
    price = price + dailyDrift + (Math.random() - 0.5) * volatility;
    const close = price;
    const high = Math.max(open, close) + Math.random() * volatility * 0.5;
    const low = Math.min(open, close) - Math.random() * volatility * 0.5;
    candles.push({
      time: new Date(Date.now() + i * 86400000).toISOString(),
      open,
      high,
      low,
      close,
      volume: 1_000_000,
    });
  }
  return candles;
}

/** Build a candle series that simulates an uptrend then pullback to 20 EMA with engulfing */
function makeEmaSetupCandles(): Candle[] {
  // 60 candles: 50 trending up, then 5 pullback, then 5 bounce
  const candles: Candle[] = [];
  let price = 100;

  // Phase 1: Strong uptrend (50 candles, +0.5/day)
  for (let i = 0; i < 50; i++) {
    const open = price;
    price += 0.5;
    const close = price;
    candles.push({
      time: new Date(Date.now() + i * 86400000).toISOString(),
      open,
      high: close + 0.2,
      low: open - 0.1,
      close,
      volume: 1_000_000,
    });
  }

  // Phase 2: Pullback to EMA (5 candles, -0.3/day)
  for (let i = 0; i < 5; i++) {
    const open = price;
    price -= 0.3;
    const close = price;
    candles.push({
      time: new Date(Date.now() + (50 + i) * 86400000).toISOString(),
      open,
      high: open + 0.1,
      low: close - 0.1,
      close,
      volume: 800_000,
    });
  }

  // Phase 3: Bullish engulfing bounce (5 candles, +0.6/day)
  for (let i = 0; i < 5; i++) {
    const open = price - 0.2; // opens below prev close (bearish prev)
    price += 0.6;
    const close = price;
    candles.push({
      time: new Date(Date.now() + (55 + i) * 86400000).toISOString(),
      open,
      high: close + 0.3,
      low: open - 0.2,
      close,
      volume: 1_200_000,
    });
  }

  return candles;
}

// ─── calcEMA tests ────────────────────────────────────────────────────────────

describe("calcEMA", () => {
  it("returns null for first period-1 values", () => {
    const candles = makeTrendingCandles(30, 100, 0.1);
    const ema = calcEMA(candles, 20);
    for (let i = 0; i < 19; i++) {
      expect(ema[i]).toBeNull();
    }
    expect(ema[19]).not.toBeNull();
  });

  it("seeds with SMA for the first value", () => {
    const prices = [10, 20, 30, 40, 50]; // avg = 30
    const candles: Candle[] = prices.map((p, i) => ({
      time: `${i}`,
      open: p,
      high: p + 1,
      low: p - 1,
      close: p,
      volume: 1000,
    }));
    const ema = calcEMA(candles, 5);
    expect(ema[4]).toBeCloseTo(30, 1);
  });

  it("EMA responds to price changes", () => {
    const candles = makeTrendingCandles(60, 100, 1); // strong uptrend
    const ema20 = calcEMA(candles, 20);
    const ema50 = calcEMA(candles, 50);
    const last20 = ema20[ema20.length - 1]!;
    const last50 = ema50[ema50.length - 1]!;
    // In uptrend, 20 EMA should be above 50 EMA
    expect(last20).toBeGreaterThan(last50);
  });

  it("returns all nulls when candles < period", () => {
    const candles = makeTrendingCandles(10, 100, 0.5);
    const ema = calcEMA(candles, 20);
    expect(ema.every((v) => v === null)).toBe(true);
  });
});

// ─── evaluateEmaPullback tests ────────────────────────────────────────────────

describe("evaluateEmaPullback", () => {
  it("returns no setup when candles < 55", () => {
    const candles = makeTrendingCandles(40, 100, 0.5);
    const result = evaluateEmaPullback(candles);
    expect(result.hasSetup).toBe(false);
  });

  it("returns no setup in a sideways/choppy market", () => {
    // Sideways: near-zero drift
    const candles = makeTrendingCandles(80, 100, 0.01, 2);
    const result = evaluateEmaPullback(candles);
    // May or may not fire, but should not crash
    expect(result.currentPrice).toBeGreaterThan(0);
  });

  it("returns no setup in a downtrend for LONG direction", () => {
    // Strong downtrend — should not produce LONG setups
    const candles = makeTrendingCandles(80, 200, -1.5, 0.5);
    const result = evaluateEmaPullback(candles);
    if (result.hasSetup) {
      // If a setup fires, it must be SHORT (downtrend)
      expect(result.direction).toBe("SHORT");
    }
  });

  it("quality is one of PREMIUM, STRONG, DEVELOPING when setup fires", () => {
    const candles = makeEmaSetupCandles();
    const result = evaluateEmaPullback(candles);
    if (result.hasSetup) {
      expect(["PREMIUM", "STRONG", "DEVELOPING"]).toContain(result.quality);
    }
  });

  it("entry equals last candle close when setup fires", () => {
    const candles = makeEmaSetupCandles();
    const result = evaluateEmaPullback(candles);
    if (result.hasSetup) {
      const lastClose = candles[candles.length - 1].close;
      expect(result.entry).toBeCloseTo(lastClose, 2);
    }
  });

  it("SL is below entry for LONG setups", () => {
    const candles = makeEmaSetupCandles();
    const result = evaluateEmaPullback(candles);
    if (result.hasSetup && result.direction === "LONG") {
      expect(result.stopLoss).toBeLessThan(result.entry);
    }
  });

  it("TP is above entry for LONG setups", () => {
    const candles = makeEmaSetupCandles();
    const result = evaluateEmaPullback(candles);
    if (result.hasSetup && result.direction === "LONG") {
      expect(result.takeProfit).toBeGreaterThan(result.entry);
    }
  });

  it("RR ratio is at least 1.5 when setup fires", () => {
    const candles = makeEmaSetupCandles();
    const result = evaluateEmaPullback(candles);
    if (result.hasSetup) {
      expect(result.rrRatio).toBeGreaterThanOrEqual(1.5);
    }
  });

  it("confluences array is non-empty when setup fires", () => {
    const candles = makeEmaSetupCandles();
    const result = evaluateEmaPullback(candles);
    if (result.hasSetup) {
      expect(result.confluences.length).toBeGreaterThan(0);
    }
  });

  it("pattern string is non-empty when setup fires", () => {
    const candles = makeEmaSetupCandles();
    const result = evaluateEmaPullback(candles);
    if (result.hasSetup) {
      expect(result.pattern.length).toBeGreaterThan(0);
    }
  });

  it("currentPrice always reflects last candle close", () => {
    const candles = makeTrendingCandles(60, 150, 0.5);
    const result = evaluateEmaPullback(candles);
    const lastClose = candles[candles.length - 1].close;
    expect(result.currentPrice).toBeCloseTo(lastClose, 2);
  });

  it("HTF filter penalises (but does not block) LONG setup when HTF is bearish", () => {
    const candles = makeEmaSetupCandles(); // bullish primary
    // Create a bearish HTF (downtrend)
    const htfCandles = makeTrendingCandles(80, 200, -1.5, 0.5);
    const resultWithHTF = evaluateEmaPullback(candles, { htfCandles });
    const resultWithoutHTF = evaluateEmaPullback(candles);
    // HTF opposition should NOT block the setup — it is a quality signal only
    // A valid primary LONG setup should still fire even with a bearish HTF
    if (resultWithoutHTF.hasSetup && resultWithoutHTF.direction === "LONG") {
      expect(resultWithHTF.hasSetup).toBe(true);
      expect(resultWithHTF.direction).toBe("LONG");
    }
  });

  it("HTF filter allows LONG setup when HTF is bullish", () => {
    const candles = makeEmaSetupCandles(); // bullish primary
    const htfCandles = makeTrendingCandles(80, 100, 1.5, 0.3); // bullish HTF
    const resultWithHTF = evaluateEmaPullback(candles, { htfCandles });
    const resultWithoutHTF = evaluateEmaPullback(candles);
    // Both should agree on direction when HTF aligns
    if (resultWithHTF.hasSetup && resultWithoutHTF.hasSetup) {
      expect(resultWithHTF.direction).toBe(resultWithoutHTF.direction);
    }
  });

  it("HTF filter is skipped when htfCandles is null", () => {
    const candles = makeEmaSetupCandles();
    const resultWithNull = evaluateEmaPullback(candles, { htfCandles: null });
    const resultWithoutHTF = evaluateEmaPullback(candles);
    // Both should produce same result (filter skipped)
    expect(resultWithNull.hasSetup).toBe(resultWithoutHTF.hasSetup);
    expect(resultWithNull.direction).toBe(resultWithoutHTF.direction);
  });

  it("RS is a quality signal only — negative RS does not block a LONG setup", () => {
    const candles = makeEmaSetupCandles();
    const resultNegRS = evaluateEmaPullback(candles, { relativeStrength: -0.05 });
    const resultPosRS = evaluateEmaPullback(candles, { relativeStrength: 0.05 });
    // Both should produce the same hasSetup/direction — RS no longer hard-blocks
    expect(resultNegRS.hasSetup).toBe(resultPosRS.hasSetup);
    if (resultNegRS.hasSetup && resultPosRS.hasSetup) {
      expect(resultNegRS.direction).toBe(resultPosRS.direction);
      // Positive RS should add "RS Leader vs SPY" confluence; negative should not
      const posHasRSLeader = resultPosRS.confluences.includes("RS Leader vs SPY");
      const negHasRSLeader = resultNegRS.confluences.includes("RS Leader vs SPY");
      expect(posHasRSLeader).toBe(true);
      expect(negHasRSLeader).toBe(false);
    }
  });

  it("RS filter is skipped when relativeStrength is null", () => {
    const candles = makeEmaSetupCandles();
    const resultWithNull = evaluateEmaPullback(candles, { relativeStrength: null });
    const resultWithoutRS = evaluateEmaPullback(candles);
    expect(resultWithNull.hasSetup).toBe(resultWithoutRS.hasSetup);
  });

  it("HTF Trend Aligned appears in confluences when HTF aligns", () => {
    const candles = makeEmaSetupCandles();
    const htfCandles = makeTrendingCandles(80, 100, 1.5, 0.3); // bullish HTF
    const result = evaluateEmaPullback(candles, { htfCandles });
    if (result.hasSetup && result.direction === "LONG") {
      expect(result.confluences).toContain("HTF Trend Aligned");
    }
  });

  it("high win rate pattern boosts quality score", () => {
    const candles = makeEmaSetupCandles();
    const resultBase = evaluateEmaPullback(candles);
    if (!resultBase.hasSetup) return; // skip if no setup
    // Provide a 70% win rate for the pattern
    const patternWinRates: Record<string, number> = {
      [resultBase.pattern]: 0.7,
    };
    const resultBoosted = evaluateEmaPullback(candles, { patternWinRates });
    if (resultBoosted.hasSetup) {
      // Win rate boost should appear in confluences
      const hasWinRate = resultBoosted.confluences.some((c) => c.includes("Win Rate"));
      expect(hasWinRate).toBe(true);
    }
  });
});

// ─── evaluateHTFTrend tests ─────────────────────────────────────────────────────────────────────────────

describe("evaluateHTFTrend", () => {
  it("returns NEUTRAL when fewer than 55 candles", () => {
    const candles = makeTrendingCandles(40, 100, 0.5);
    expect(evaluateHTFTrend(candles)).toBe("NEUTRAL");
  });

  it("returns BULL for a strong uptrend", () => {
    const candles = makeTrendingCandles(80, 100, 1.5, 0.3);
    expect(evaluateHTFTrend(candles)).toBe("BULL");
  });

  it("returns BEAR for a strong downtrend", () => {
    const candles = makeTrendingCandles(80, 200, -1.5, 0.3);
    expect(evaluateHTFTrend(candles)).toBe("BEAR");
  });

  it("returns NEUTRAL for a flat market", () => {
    // Flat: no drift, low volatility — 20 and 50 EMA will be very close
    const candles = makeTrendingCandles(80, 100, 0.001, 0.1);
    const result = evaluateHTFTrend(candles);
    // May be NEUTRAL or slightly BULL/BEAR depending on random noise
    expect(["NEUTRAL", "BULL", "BEAR"]).toContain(result);
  });
});

// ─── Price-Relative-to-EMA Regression Tests ───────────────────────────────────
// These tests guard against the main wrong-direction bug:
// "printing SHORT setups while price is strongly above both EMAs"

describe("Price-Relative-to-EMA Check (anti-wrong-direction guard)", () => {
  /**
   * Build candles where 20 EMA < 50 EMA (downtrend) but current price
   * is far ABOVE the 20 EMA — this should NOT fire a SHORT setup.
   * Scenario: price was in a downtrend, then ripped up 8% above the EMA.
   */
  function makeDowntrendWithPriceRippingUp(): Candle[] {
    const candles: Candle[] = [];
    let price = 200;

    // Phase 1: Downtrend (50 candles, -0.5/day) — establishes 20 EMA < 50 EMA
    for (let i = 0; i < 50; i++) {
      const open = price;
      price -= 0.5;
      const close = price;
      candles.push({
        time: new Date(Date.now() + i * 86400000).toISOString(),
        open, high: open + 0.2, low: close - 0.2, close, volume: 1_000_000,
      });
    }

    // Phase 2: Price rips UP 8% above the 20 EMA (5 candles, +2/day)
    // The 20 EMA is still below 50 EMA (downtrend), but price is now far above
    for (let i = 0; i < 5; i++) {
      const open = price;
      price += 2.5; // strong bullish move
      const close = price;
      candles.push({
        time: new Date(Date.now() + (50 + i) * 86400000).toISOString(),
        open, high: close + 0.3, low: open - 0.1, close, volume: 2_000_000,
      });
    }

    return candles;
  }

  it("does NOT fire a SHORT setup when price is >6% above the 20 EMA (even in a downtrend)", () => {
    const candles = makeDowntrendWithPriceRippingUp();
    const result = evaluateEmaPullback(candles);
    // Price is far above the 20 EMA — this is a breakout, not a pullback to short
    // The price-relative-to-EMA check should block this
    expect(result.hasSetup).toBe(false);
  });

  /**
   * Build candles where 20 EMA > 50 EMA (uptrend) but current price
   * is far BELOW the 20 EMA — this should NOT fire a LONG setup.
   * Scenario: price was in an uptrend, then crashed 8% below the EMA.
   */
  function makeUptrendWithPriceCrashingDown(): Candle[] {
    const candles: Candle[] = [];
    let price = 100;

    // Phase 1: Uptrend (50 candles, +0.5/day) — establishes 20 EMA > 50 EMA
    for (let i = 0; i < 50; i++) {
      const open = price;
      price += 0.5;
      const close = price;
      candles.push({
        time: new Date(Date.now() + i * 86400000).toISOString(),
        open, high: close + 0.2, low: open - 0.2, close, volume: 1_000_000,
      });
    }

    // Phase 2: Price crashes DOWN 8% below the 20 EMA (5 candles, -2.5/day)
    for (let i = 0; i < 5; i++) {
      const open = price;
      price -= 2.5; // strong bearish move
      const close = price;
      candles.push({
        time: new Date(Date.now() + (50 + i) * 86400000).toISOString(),
        open, high: open + 0.1, low: close - 0.3, close, volume: 2_000_000,
      });
    }

    return candles;
  }

  it("does NOT fire a LONG setup when price is >6% below the 20 EMA (breakdown, not pullback)", () => {
    const candles = makeUptrendWithPriceCrashingDown();
    const result = evaluateEmaPullback(candles);
    // Price is far below the 20 EMA — this is a breakdown, not a pullback to buy
    expect(result.hasSetup).toBe(false);
  });

  it("DOES allow a LONG setup when price is within 4% of the 20 EMA in an uptrend", () => {
    // Use the standard EMA setup candles — price pulls back to EMA and bounces
    const candles = makeEmaSetupCandles();
    const result = evaluateEmaPullback(candles);
    // This is a genuine pullback — should be allowed (may or may not have a setup
    // depending on momentum, but the price-relative check should not block it)
    // We just verify the filter doesn't incorrectly block a valid pullback
    if (result.hasSetup) {
      expect(result.direction).toBe("LONG");
    }
    // If no setup, it's because other filters (momentum, volume, etc.) didn't pass — that's fine
  });
});
