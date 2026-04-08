import { describe, it, expect } from "vitest";
import { normalizeContract, contractScore } from "./analysis/tradierOptions";

// ── normalizeContract ─────────────────────────────────────────────────────────

describe("normalizeContract", () => {
  it("parses a well-formed call contract", () => {
    const raw = {
      symbol: "AAPL240119C00190000",
      expiration_date: "2024-01-19",
      option_type: "call",
      strike: 190,
      bid: 4.5,
      ask: 4.7,
      last: 4.6,
      volume: 1200,
      open_interest: 5000,
      greeks: { delta: 0.48, gamma: 0.03, theta: -0.12, vega: 0.25, mid_iv: 0.28 },
    };
    const c = normalizeContract(raw);
    expect(c.symbol).toBe("AAPL240119C00190000");
    expect(c.expiration).toBe("2024-01-19");
    expect(c.optionType).toBe("call");
    expect(c.strike).toBe(190);
    expect(c.bid).toBe(4.5);
    expect(c.ask).toBe(4.7);
    expect(c.mark).toBeCloseTo(4.6, 2);
    expect(c.spreadPct).toBeGreaterThan(0);
    expect(c.volume).toBe(1200);
    expect(c.openInterest).toBe(5000);
    expect(c.delta).toBeCloseTo(0.48, 2);
    expect(c.iv).toBeCloseTo(0.28, 2);
  });

  it("handles missing greeks gracefully", () => {
    const raw = {
      symbol: "TSLA240119P00200000",
      expiration_date: "2024-01-19",
      option_type: "put",
      strike: 200,
      bid: 3.0,
      ask: 3.2,
      last: 3.1,
      volume: 500,
      open_interest: 2000,
    };
    const c = normalizeContract(raw);
    expect(c.delta).toBe(0);
    expect(c.gamma).toBe(0);
    expect(c.theta).toBe(0);
    expect(c.vega).toBe(0);
    expect(c.iv).toBe(0);
  });

  it("computes spreadPct correctly", () => {
    const raw = {
      symbol: "SPY240119C00500000",
      expiration_date: "2024-01-19",
      option_type: "call",
      strike: 500,
      bid: 2.0,
      ask: 2.4,
      last: 2.2,
      volume: 100,
      open_interest: 500,
      greeks: {},
    };
    const c = normalizeContract(raw);
    // mid = 2.2, spread = 0.4, spreadPct = (0.4/2.2)*100 ≈ 18.18
    expect(c.spreadPct).toBeCloseTo(18.18, 1);
  });

  it("returns 999 spreadPct when mid is zero", () => {
    const raw = {
      symbol: "XYZ240119C00100000",
      expiration_date: "2024-01-19",
      option_type: "call",
      strike: 100,
      bid: 0,
      ask: 0,
      last: 0,
      volume: 0,
      open_interest: 0,
      greeks: {},
    };
    const c = normalizeContract(raw);
    expect(c.spreadPct).toBe(999);
  });

  it("falls back to smv_vol when mid_iv is missing", () => {
    const raw = {
      symbol: "NVDA240119C00600000",
      expiration_date: "2024-01-19",
      option_type: "call",
      strike: 600,
      bid: 10,
      ask: 10.5,
      last: 10.2,
      volume: 300,
      open_interest: 1000,
      greeks: { delta: 0.5, smv_vol: 0.45 },
    };
    const c = normalizeContract(raw);
    expect(c.iv).toBeCloseTo(0.45, 2);
  });
});

// ── contractScore ─────────────────────────────────────────────────────────────

describe("contractScore", () => {
  const baseContract = {
    symbol: "AAPL240119C00190000",
    expiration: "2024-01-19",
    optionType: "call" as const,
    strike: 190,
    bid: 4.5,
    ask: 4.7,
    last: 4.6,
    mark: 4.6,
    spreadPct: 4.35,
    volume: 2000,
    openInterest: 8000,
    delta: 0.45,
    gamma: 0.03,
    theta: -0.12,
    vega: 0.25,
    iv: 0.28,
  };

  it("returns a score between 0 and 100", () => {
    const score = contractScore(baseContract, "calls");
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("tight spread scores higher than wide spread", () => {
    const tight = { ...baseContract, spreadPct: 1.5 };
    const wide = { ...baseContract, spreadPct: 15 };
    expect(contractScore(tight, "calls")).toBeGreaterThan(contractScore(wide, "calls"));
  });

  it("high volume scores higher than low volume", () => {
    const highVol = { ...baseContract, volume: 10000 };
    const lowVol = { ...baseContract, volume: 10 };
    expect(contractScore(highVol, "calls")).toBeGreaterThan(contractScore(lowVol, "calls"));
  });

  it("delta near 0.45 for calls scores higher than delta far from 0.45", () => {
    const nearTarget = { ...baseContract, delta: 0.45 };
    const farTarget = { ...baseContract, delta: 0.05 };
    expect(contractScore(nearTarget, "calls")).toBeGreaterThan(contractScore(farTarget, "calls"));
  });

  it("delta near -0.45 for puts scores higher than delta far from -0.45", () => {
    const nearTarget = { ...baseContract, optionType: "put" as const, delta: -0.45 };
    const farTarget = { ...baseContract, optionType: "put" as const, delta: -0.05 };
    expect(contractScore(nearTarget, "puts")).toBeGreaterThan(contractScore(farTarget, "puts"));
  });

  it("high OI scores higher than low OI", () => {
    const highOI = { ...baseContract, openInterest: 50000 };
    const lowOI = { ...baseContract, openInterest: 10 };
    expect(contractScore(highOI, "calls")).toBeGreaterThan(contractScore(lowOI, "calls"));
  });

  it("returns integer score", () => {
    const score = contractScore(baseContract, "calls");
    expect(Number.isInteger(score)).toBe(true);
  });
});
