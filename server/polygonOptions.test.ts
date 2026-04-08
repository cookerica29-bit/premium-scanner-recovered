import { describe, it, expect } from "vitest";
import { normalizePolygonContract, polygonContractScore } from "./analysis/polygonOptions";

// ── normalizePolygonContract ──────────────────────────────────────────────────

describe("normalizePolygonContract", () => {
  it("parses a well-formed call snapshot", () => {
    const raw = {
      ticker: "O:AAPL240119C00190000",
      details: { expiration_date: "2024-01-19", contract_type: "call", strike_price: 190 },
      last_quote: { bid_price: 4.5, ask_price: 4.7 },
      day: { volume: 1200 },
      open_interest: 5000,
      implied_volatility: 0.28,
      greeks: { delta: 0.48, gamma: 0.03, theta: -0.12, vega: 0.25 },
    };
    const c = normalizePolygonContract(raw);
    expect(c.ticker).toBe("O:AAPL240119C00190000");
    expect(c.expiration).toBe("2024-01-19");
    expect(c.contractType).toBe("call");
    expect(c.strike).toBe(190);
    expect(c.bid).toBeCloseTo(4.5, 2);
    expect(c.ask).toBeCloseTo(4.7, 2);
    expect(c.spreadPct).toBeGreaterThan(0);
    expect(c.volume).toBe(1200);
    expect(c.openInterest).toBe(5000);
    expect(c.delta).toBeCloseTo(0.48, 2);
    expect(c.iv).toBeCloseTo(0.28, 2);
  });

  it("handles missing greeks gracefully", () => {
    const raw = {
      ticker: "O:TSLA240119P00200000",
      details: { expiration_date: "2024-01-19", contract_type: "put", strike_price: 200 },
      last_quote: { bid_price: 3.0, ask_price: 3.2 },
      day: { volume: 500 },
      open_interest: 2000,
    };
    const c = normalizePolygonContract(raw);
    expect(c.delta).toBe(0);
    expect(c.gamma).toBe(0);
    expect(c.theta).toBe(0);
    expect(c.vega).toBe(0);
    expect(c.iv).toBe(0);
  });

  it("computes spreadPct correctly", () => {
    const raw = {
      ticker: "O:SPY240119C00500000",
      details: { expiration_date: "2024-01-19", contract_type: "call", strike_price: 500 },
      last_quote: { bid_price: 2.0, ask_price: 2.4 },
      day: { volume: 100 },
      open_interest: 500,
      greeks: {},
    };
    const c = normalizePolygonContract(raw);
    // mid = 2.2, spread = 0.4, spreadPct = (0.4/2.2)*100 ≈ 18.18
    expect(c.spreadPct).toBeCloseTo(18.18, 1);
  });

  it("returns 999 spreadPct when both bid and ask are zero", () => {
    const raw = {
      ticker: "O:XYZ240119C00100000",
      details: { expiration_date: "2024-01-19", contract_type: "call", strike_price: 100 },
      last_quote: { bid_price: 0, ask_price: 0 },
      day: { volume: 0 },
      open_interest: 0,
      greeks: {},
    };
    const c = normalizePolygonContract(raw);
    expect(c.spreadPct).toBe(999);
  });

  it("handles missing details object", () => {
    const raw = {
      ticker: "O:UNKNOWN",
      last_quote: { bid_price: 1, ask_price: 1.1 },
      day: { volume: 50 },
      open_interest: 100,
    };
    const c = normalizePolygonContract(raw);
    expect(c.expiration).toBe("");
    expect(c.contractType).toBe("call"); // default
    expect(c.strike).toBe(0);
  });
});

// ── polygonContractScore ──────────────────────────────────────────────────────

describe("polygonContractScore", () => {
  const baseContract = {
    ticker: "O:AAPL240119C00190000",
    expiration: "2024-01-19",
    contractType: "call" as const,
    strike: 190,
    bid: 4.5,
    ask: 4.7,
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
    const score = polygonContractScore(baseContract, "calls");
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("tight spread scores higher than wide spread", () => {
    const tight = { ...baseContract, spreadPct: 1.5 };
    const wide = { ...baseContract, spreadPct: 15 };
    expect(polygonContractScore(tight, "calls")).toBeGreaterThan(polygonContractScore(wide, "calls"));
  });

  it("high volume scores higher than low volume", () => {
    const highVol = { ...baseContract, volume: 10000 };
    const lowVol = { ...baseContract, volume: 10 };
    expect(polygonContractScore(highVol, "calls")).toBeGreaterThan(polygonContractScore(lowVol, "calls"));
  });

  it("delta near 0.45 for calls scores higher than delta far from 0.45", () => {
    const nearTarget = { ...baseContract, delta: 0.45 };
    const farTarget = { ...baseContract, delta: 0.05 };
    expect(polygonContractScore(nearTarget, "calls")).toBeGreaterThan(polygonContractScore(farTarget, "calls"));
  });

  it("delta near -0.45 for puts scores higher than delta far from -0.45", () => {
    const nearTarget = { ...baseContract, contractType: "put" as const, delta: -0.45 };
    const farTarget = { ...baseContract, contractType: "put" as const, delta: -0.05 };
    expect(polygonContractScore(nearTarget, "puts")).toBeGreaterThan(polygonContractScore(farTarget, "puts"));
  });

  it("high OI scores higher than low OI", () => {
    const highOI = { ...baseContract, openInterest: 50000 };
    const lowOI = { ...baseContract, openInterest: 10 };
    expect(polygonContractScore(highOI, "calls")).toBeGreaterThan(polygonContractScore(lowOI, "calls"));
  });

  it("returns integer score", () => {
    const score = polygonContractScore(baseContract, "calls");
    expect(Number.isInteger(score)).toBe(true);
  });
});
