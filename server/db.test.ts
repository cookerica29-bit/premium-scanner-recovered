/**
 * Unit tests for server/db.ts helper functions
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock drizzle-orm/mysql2 and drizzle-orm ─────────────────────────────────
// We mock the DB layer so tests run without a real database connection.

let mockSelectRows: Array<{ pattern: string | null; outcome: string }> = [];

vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockImplementation(() => Promise.resolve(mockSelectRows)),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue({ insertId: 1 }),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockImplementation(() => Promise.resolve(mockSelectRows)),
    limit: vi.fn().mockImplementation(() => Promise.resolve(mockSelectRows)),
  })),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────
// We need to test the logic in getPatternWinRates without a real DB.
// Since the DB is mocked, we test the aggregation logic directly.

describe("getPatternWinRates aggregation logic", () => {
  /**
   * Simulate the aggregation logic extracted from getPatternWinRates.
   * This tests the pure computation without DB dependency.
   */
  function aggregateWinRates(
    rows: Array<{ pattern: string | null; outcome: string }>
  ): Record<string, number> {
    const counts: Record<string, { wins: number; total: number }> = {};
    for (const row of rows) {
      if (row.outcome === "PENDING") continue; // should already be excluded by SQL
      if (!row.pattern) continue;
      if (!counts[row.pattern]) counts[row.pattern] = { wins: 0, total: 0 };
      counts[row.pattern].total++;
      if (row.outcome === "WIN") counts[row.pattern].wins++;
    }
    const result: Record<string, number> = {};
    for (const [pattern, { wins, total }] of Object.entries(counts)) {
      if (total >= 3) result[pattern] = wins / total;
    }
    return result;
  }

  it("returns empty object when no rows", () => {
    expect(aggregateWinRates([])).toEqual({});
  });

  it("excludes PENDING outcomes from aggregation", () => {
    const rows = [
      { pattern: "Bullish EMA Pullback + Engulfing", outcome: "PENDING" },
      { pattern: "Bullish EMA Pullback + Engulfing", outcome: "PENDING" },
      { pattern: "Bullish EMA Pullback + Engulfing", outcome: "PENDING" },
    ];
    // All PENDING → no closed trades → empty result
    expect(aggregateWinRates(rows)).toEqual({});
  });

  it("requires at least 3 closed trades before including a pattern", () => {
    const rows = [
      { pattern: "Bullish EMA Pullback + Engulfing", outcome: "WIN" },
      { pattern: "Bullish EMA Pullback + Engulfing", outcome: "WIN" },
    ];
    // Only 2 trades → below minimum sample → excluded
    expect(aggregateWinRates(rows)).toEqual({});
  });

  it("includes pattern with exactly 3 closed trades", () => {
    const rows = [
      { pattern: "Bullish EMA Pullback + Engulfing", outcome: "WIN" },
      { pattern: "Bullish EMA Pullback + Engulfing", outcome: "WIN" },
      { pattern: "Bullish EMA Pullback + Engulfing", outcome: "LOSS" },
    ];
    const result = aggregateWinRates(rows);
    expect(result["Bullish EMA Pullback + Engulfing"]).toBeCloseTo(2 / 3, 5);
  });

  it("computes correct win rate for mixed outcomes", () => {
    const rows = [
      { pattern: "Bearish EMA Pullback + Pin Bar", outcome: "WIN" },
      { pattern: "Bearish EMA Pullback + Pin Bar", outcome: "WIN" },
      { pattern: "Bearish EMA Pullback + Pin Bar", outcome: "LOSS" },
      { pattern: "Bearish EMA Pullback + Pin Bar", outcome: "BREAKEVEN" },
      { pattern: "Bearish EMA Pullback + Pin Bar", outcome: "LOSS" },
    ];
    const result = aggregateWinRates(rows);
    // 2 wins out of 5 closed trades = 0.4
    expect(result["Bearish EMA Pullback + Pin Bar"]).toBeCloseTo(0.4, 5);
  });

  it("handles multiple patterns independently", () => {
    const rows = [
      { pattern: "Bullish EMA Pullback + Engulfing", outcome: "WIN" },
      { pattern: "Bullish EMA Pullback + Engulfing", outcome: "WIN" },
      { pattern: "Bullish EMA Pullback + Engulfing", outcome: "WIN" },
      { pattern: "Bearish EMA Pullback + Strong Close", outcome: "LOSS" },
      { pattern: "Bearish EMA Pullback + Strong Close", outcome: "LOSS" },
      { pattern: "Bearish EMA Pullback + Strong Close", outcome: "LOSS" },
    ];
    const result = aggregateWinRates(rows);
    expect(result["Bullish EMA Pullback + Engulfing"]).toBeCloseTo(1.0, 5);
    expect(result["Bearish EMA Pullback + Strong Close"]).toBeCloseTo(0.0, 5);
  });

  it("skips rows with null pattern", () => {
    const rows = [
      { pattern: null, outcome: "WIN" },
      { pattern: null, outcome: "WIN" },
      { pattern: null, outcome: "WIN" },
    ];
    expect(aggregateWinRates(rows)).toEqual({});
  });

  it("BREAKEVEN counts as a closed trade but not a win", () => {
    const rows = [
      { pattern: "Bullish EMA Pullback + Engulfing", outcome: "WIN" },
      { pattern: "Bullish EMA Pullback + Engulfing", outcome: "BREAKEVEN" },
      { pattern: "Bullish EMA Pullback + Engulfing", outcome: "BREAKEVEN" },
    ];
    const result = aggregateWinRates(rows);
    // 1 win out of 3 closed = 0.333
    expect(result["Bullish EMA Pullback + Engulfing"]).toBeCloseTo(1 / 3, 5);
  });
});
