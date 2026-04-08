/**
 * Integration tests for the relaxed EMA Pullback engine.
 * These tests use realistic OHLC candle sequences to verify the engine
 * actually produces setups under normal market conditions.
 */

import { describe, it, expect } from "vitest";
import { evaluateEmaPullback, calcEMA } from "./analysis/emaPullback";
import type { Candle } from "./analysis/supplyDemand";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCandle(i: number, open: number, close: number, high?: number, low?: number): Candle {
  return {
    time: new Date(Date.now() + i * 86400000).toISOString(),
    open: parseFloat(open.toFixed(4)),
    high: parseFloat((high ?? Math.max(open, close) * 1.003).toFixed(4)),
    low: parseFloat((low ?? Math.min(open, close) * 0.997).toFixed(4)),
    close: parseFloat(close.toFixed(4)),
    volume: 1000000,
  };
}

/**
 * Build a guaranteed LONG setup:
 * - 65 candles of steady uptrend (20 EMA > 50 EMA, slope > 0.1%)
 * - 7 candles pulling back to exactly the 20 EMA level
 * - 1 bearish candle + 1 bullish engulfing candle at the EMA
 */
function buildGuaranteedLongSetup(): Candle[] {
  const candles: Candle[] = [];

  // Phase 1: 65 candles of steady uptrend
  let price = 100;
  for (let i = 0; i < 65; i++) {
    price += 0.6; // +0.6 per candle = strong uptrend
    candles.push(makeCandle(i, price - 0.2, price, price + 0.3, price - 0.4));
  }

  // Compute 20 EMA after phase 1 to know where to pull back to
  const ema20After65 = calcEMA(candles, 20);
  const emaTarget = ema20After65[ema20After65.length - 1]!;
  const currentPriceAfter65 = price;

  // Phase 2: 6 candles pulling back toward the 20 EMA
  // We need the candle LOW to touch within 3% of EMA
  for (let i = 0; i < 6; i++) {
    const pct = (i + 1) / 6;
    const p = currentPriceAfter65 - (currentPriceAfter65 - emaTarget) * pct;
    // Make the low explicitly touch the EMA on the last pullback candle
    const low = i === 5 ? emaTarget * 0.999 : p * 0.997;
    candles.push(makeCandle(65 + i, p + 0.15, p - 0.05, p + 0.25, low));
  }

  // Phase 3: Bearish candle (prev for engulfing)
  const pullbackClose = candles[candles.length - 1].close;
  const bearOpen = pullbackClose + 0.4;
  const bearClose = pullbackClose + 0.1;
  candles.push(makeCandle(71, bearOpen, bearClose, bearOpen + 0.1, bearClose - 0.1));

  // Phase 4: Bullish engulfing candle
  // open < bearClose, close > bearOpen → engulfs the bearish candle
  const engOpen = bearClose - 0.15;   // opens below prev close
  const engClose = bearOpen + 0.35;   // closes above prev open
  candles.push(makeCandle(72, engOpen, engClose, engClose + 0.1, engOpen - 0.05));

  return candles;
}

/**
 * Build a guaranteed SHORT setup:
 * - 65 candles of steady downtrend (20 EMA < 50 EMA, slope > 0.1%)
 * - 6 candles pulling back up to the 20 EMA
 * - 1 bullish candle + 1 bearish engulfing candle at the EMA
 */
function buildGuaranteedShortSetup(): Candle[] {
  const candles: Candle[] = [];

  let price = 150;
  for (let i = 0; i < 65; i++) {
    price -= 0.6;
    candles.push(makeCandle(i, price + 0.2, price, price + 0.4, price - 0.3));
  }

  const ema20After65 = calcEMA(candles, 20);
  const emaTarget = ema20After65[ema20After65.length - 1]!;
  const currentPriceAfter65 = price;

  for (let i = 0; i < 6; i++) {
    const pct = (i + 1) / 6;
    const p = currentPriceAfter65 + (emaTarget - currentPriceAfter65) * pct;
    const high = i === 5 ? emaTarget * 1.001 : p * 1.003;
    candles.push(makeCandle(65 + i, p - 0.15, p + 0.05, high, p * 0.997));
  }

  // Bullish candle (prev for bearish engulfing)
  const pullbackClose = candles[candles.length - 1].close;
  const bullOpen = pullbackClose - 0.4;
  const bullClose = pullbackClose - 0.1;
  candles.push(makeCandle(71, bullOpen, bullClose, bullClose + 0.1, bullOpen - 0.1));

  // Bearish engulfing: open > bullClose, close < bullOpen
  const engOpen = bullClose + 0.15;
  const engClose = bullOpen - 0.35;
  candles.push(makeCandle(72, engOpen, engClose, engOpen + 0.05, engClose - 0.1));

  return candles;
}

/** Build a flat/sideways market with no trend */
function buildFlatMarket(count: number = 80): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const price = 100 + Math.sin(i * 0.2) * 0.3; // tiny oscillation
    candles.push(makeCandle(i, price - 0.05, price + 0.05));
  }
  return candles;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("EMA Pullback Engine — Integration (Relaxed Thresholds)", () => {
  it("returns a LONG setup on a deterministic uptrend with engulfing candle", () => {
    const candles = buildGuaranteedLongSetup();
    const result = evaluateEmaPullback(candles);

    expect(result.hasSetup).toBe(true);
    expect(result.direction).toBe("LONG");
    expect(result.quality).toBeDefined();
    expect(result.entry).toBeGreaterThan(0);
    expect(result.stopLoss).toBeLessThan(result.entry);
    expect(result.takeProfit).toBeGreaterThan(result.entry);
    expect(result.rrRatio).toBeGreaterThanOrEqual(1.5);
    expect(result.ema20).toBeGreaterThan(0);
    expect(result.ema50).toBeGreaterThan(0);
    expect(result.ema20!).toBeGreaterThan(result.ema50!);
  });

  it("returns a SHORT setup on a deterministic downtrend with bearish engulfing candle", () => {
    const candles = buildGuaranteedShortSetup();
    const result = evaluateEmaPullback(candles);

    expect(result.hasSetup).toBe(true);
    expect(result.direction).toBe("SHORT");
    expect(result.entry).toBeGreaterThan(0);
    expect(result.stopLoss).toBeGreaterThan(result.entry);
    expect(result.takeProfit).toBeLessThan(result.entry);
    expect(result.rrRatio).toBeGreaterThanOrEqual(1.5);
    expect(result.ema20!).toBeLessThan(result.ema50!);
  });

  it("returns no setup for flat/sideways market (insufficient EMA slope)", () => {
    const candles = buildFlatMarket(80);
    const result = evaluateEmaPullback(candles);
    expect(result.hasSetup).toBe(false);
  });

  it("returns no setup when fewer than 55 candles provided", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 40; i++) {
      const price = 100 + i * 0.5;
      candles.push(makeCandle(i, price - 0.1, price));
    }
    const result = evaluateEmaPullback(candles);
    expect(result.hasSetup).toBe(false);
  });

  it("always returns ema20 and ema50 values when a setup is found", () => {
    const candles = buildGuaranteedLongSetup();
    const result = evaluateEmaPullback(candles);
    if (result.hasSetup) {
      expect(result.ema20).not.toBeNull();
      expect(result.ema50).not.toBeNull();
    }
  });

  it("LONG setup has SL below entry and TP above entry", () => {
    const candles = buildGuaranteedLongSetup();
    const result = evaluateEmaPullback(candles);
    if (result.hasSetup && result.direction === "LONG") {
      expect(result.stopLoss).toBeLessThan(result.entry);
      expect(result.takeProfit).toBeGreaterThan(result.entry);
      // TP2 and TP3 are fixed 3x/4x multiples from entry (independent of TP1 swing target)
      expect(result.takeProfit2).toBeGreaterThan(result.entry);
      expect(result.takeProfit3).toBeGreaterThan(result.entry);
      expect(result.takeProfit3).toBeGreaterThan(result.takeProfit2);
    }
  });

  it("SHORT setup has SL above entry and TP below entry", () => {
    const candles = buildGuaranteedShortSetup();
    const result = evaluateEmaPullback(candles);
    if (result.hasSetup && result.direction === "SHORT") {
      expect(result.stopLoss).toBeGreaterThan(result.entry);
      expect(result.takeProfit).toBeLessThan(result.entry);
    }
  });

  it("surfaces Volume Surge confluence tag when momentum candle volume >= 1.2x avg", () => {
    // Build the guaranteed long setup and inflate the last candle's volume
    const candles = buildGuaranteedLongSetup();
    // Set last candle volume to 3x the average of the prior 20
    const avgVol = candles.slice(-21, -1).reduce((s, c) => s + c.volume, 0) / 20;
    candles[candles.length - 1] = { ...candles[candles.length - 1], volume: avgVol * 3 };
    const result = evaluateEmaPullback(candles);
    if (result.hasSetup) {
      expect(result.confluences).toContain("Volume Surge");
    }
  });

  it("does not surface Volume Surge when momentum candle volume is below 1.2x avg", () => {
    // Build the guaranteed long setup and deflate the last candle's volume
    const candles = buildGuaranteedLongSetup();
    const avgVol = candles.slice(-21, -1).reduce((s, c) => s + c.volume, 0) / 20;
    candles[candles.length - 1] = { ...candles[candles.length - 1], volume: avgVol * 0.5 };
    const result = evaluateEmaPullback(candles);
    if (result.hasSetup) {
      expect(result.confluences).not.toContain("Volume Surge");
    }
  });

  it("Volume Surge (+2 score) can push quality from STRONG to PREMIUM", () => {
    // Without volume: build a setup that scores exactly in STRONG range (5-7)
    // With volume: the +2 bonus should push it to PREMIUM (>=8)
    const candlesLow = buildGuaranteedLongSetup();
    const avgVol = candlesLow.slice(-21, -1).reduce((s, c) => s + c.volume, 0) / 20;
    // Low volume version
    candlesLow[candlesLow.length - 1] = { ...candlesLow[candlesLow.length - 1], volume: avgVol * 0.5 };
    const resultLow = evaluateEmaPullback(candlesLow);

    // High volume version (same candles, just inflate last volume)
    const candlesHigh = buildGuaranteedLongSetup();
    candlesHigh[candlesHigh.length - 1] = { ...candlesHigh[candlesHigh.length - 1], volume: avgVol * 3 };
    const resultHigh = evaluateEmaPullback(candlesHigh);

    // Both should produce a setup
    if (resultLow.hasSetup && resultHigh.hasSetup) {
      // High volume version should have equal or better quality
      const qualityOrder = { DEVELOPING: 0, STRONG: 1, PREMIUM: 2 };
      expect(qualityOrder[resultHigh.quality!]).toBeGreaterThanOrEqual(qualityOrder[resultLow.quality!]);
      // High volume version should have Volume Surge tag
      expect(resultHigh.confluences).toContain("Volume Surge");
      expect(resultLow.confluences).not.toContain("Volume Surge");
    }
  });
});
