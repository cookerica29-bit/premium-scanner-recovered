/**
 * Tests for price alerts and analytics tRPC procedures.
 * Uses in-memory mocks — no real DB connection required.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Mock DB helpers ──────────────────────────────────────────────────────────
vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getPriceAlerts: vi.fn().mockResolvedValue([
      {
        id: 1,
        userId: 1,
        symbol: "EUR_USD",
        displaySymbol: "EUR/USD",
        assetClass: "FOREX",
        direction: "LONG",
        targetPrice: "1.08500",
        currentPrice: "1.09000",
        proximityPct: "0.50",
        timeframe: "4H",
        pattern: "Demand Zone Retest",
        notes: null,
        isActive: 1,
        isTriggered: 0,
        triggeredAt: null,
        createdAt: new Date("2026-03-01T10:00:00Z"),
        updatedAt: new Date("2026-03-01T10:00:00Z"),
      },
    ]),
    createPriceAlert: vi.fn().mockResolvedValue(undefined),
    deletePriceAlert: vi.fn().mockResolvedValue(undefined),
    togglePriceAlert: vi.fn().mockResolvedValue(undefined),
    getJournalEntries: vi.fn().mockResolvedValue([
      {
        id: 1,
        userId: 1,
        setupId: "EUR_USD-4H-1",
        symbol: "EUR/USD",
        assetClass: "FOREX",
        setupType: "LONG",
        quality: "PREMIUM",
        pattern: "Demand Zone Retest",
        timeframe: "4H",
        levels: { entry: 1.085, stopLoss: 1.08, takeProfit: 1.095 },
        rrRatio: 2.0,
        confluences: ["HTF Alignment", "Rejection Wick"],
        notes: "Clean setup",
        tags: ["premium", "long"],
        outcome: "WIN",
        pnl: 200,
        entryDate: new Date("2026-03-01"),
        exitDate: new Date("2026-03-02"),
        pushedAt: new Date("2026-03-01T10:00:00Z"),
        updatedAt: new Date("2026-03-02T10:00:00Z"),
      },
      {
        id: 2,
        userId: 1,
        setupId: "AAPL-Daily-2",
        symbol: "AAPL",
        assetClass: "STOCK",
        setupType: "CALL",
        quality: "STRONG",
        pattern: "Supply Zone Rejection",
        timeframe: "Daily",
        levels: { entry: 220, stopLoss: 215, takeProfit: 230 },
        rrRatio: 2.0,
        confluences: ["Volume Spike"],
        notes: "",
        tags: ["strong", "call"],
        outcome: "LOSS",
        pnl: -100,
        entryDate: new Date("2026-03-05"),
        exitDate: new Date("2026-03-06"),
        pushedAt: new Date("2026-03-05T10:00:00Z"),
        updatedAt: new Date("2026-03-06T10:00:00Z"),
      },
      {
        id: 3,
        userId: 1,
        setupId: "GBP_USD-4H-3",
        symbol: "GBP/USD",
        assetClass: "FOREX",
        setupType: "SHORT",
        quality: "PREMIUM",
        pattern: "Supply Zone Rejection",
        timeframe: "4H",
        levels: { entry: 1.265, stopLoss: 1.27, takeProfit: 1.255 },
        rrRatio: 2.0,
        confluences: ["HTF Alignment"],
        notes: "",
        tags: ["premium", "short"],
        outcome: "PENDING",
        pnl: null,
        entryDate: null,
        exitDate: null,
        pushedAt: new Date("2026-03-10T10:00:00Z"),
        updatedAt: new Date("2026-03-10T10:00:00Z"),
      },
    ]),
  };
});

// ─── Mock Oanda + Stock fetchers so screener procedures don't make real HTTP calls ─
vi.mock("./oanda", () => ({
  fetchOandaCandles: vi.fn().mockResolvedValue([]),
  FOREX_PAIRS: [],
  FOREX_PAIR_LABELS: {},
  HTF_MAP: {},
  TIMEFRAME_MAP: {},
  getForexCacheAge: vi.fn().mockReturnValue(0),
  isForexCacheWarm: vi.fn().mockReturnValue(true),
}));

vi.mock("./stockData", () => ({
  fetchStockCandles: vi.fn().mockResolvedValue([]),
  fetchStockCandlesBatch: vi.fn().mockResolvedValue(new Map()),
  STOCK_SYMBOLS: [],
  STOCK_SECTORS: {},
  STOCK_HTF_MAP: {},
}));

// ─── Auth context factory ─────────────────────────────────────────────────────
function makeAuthCtx(userId = 1): TrpcContext {
  return {
    user: {
      id: userId,
      openId: "test-user",
      email: "test@example.com",
      name: "Test User",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

// ─── Alerts tests ─────────────────────────────────────────────────────────────
describe("alerts.list", () => {
  it("returns the user's price alerts", async () => {
    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.alerts.list();
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe("EUR_USD");
    expect(result[0].displaySymbol).toBe("EUR/USD");
    expect(result[0].direction).toBe("LONG");
  });
});

describe("alerts.create", () => {
  it("creates a price alert and returns success", async () => {
    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.alerts.create({
      symbol: "GBP_USD",
      displaySymbol: "GBP/USD",
      assetClass: "FOREX",
      direction: "SHORT",
      targetPrice: 1.265,
      currentPrice: 1.27,
      proximityPct: 0.5,
      timeframe: "4H",
      pattern: "Supply Zone Rejection",
    });
    expect(result).toEqual({ success: true });
  });

  it("rejects invalid assetClass", async () => {
    const caller = appRouter.createCaller(makeAuthCtx());
    await expect(
      caller.alerts.create({
        symbol: "EUR_USD",
        displaySymbol: "EUR/USD",
        assetClass: "CRYPTO" as "FOREX",
        direction: "LONG",
        targetPrice: 1.085,
        currentPrice: 1.09,
        proximityPct: 0.5,
        timeframe: "4H",
      })
    ).rejects.toThrow();
  });
});

describe("alerts.delete", () => {
  it("deletes an alert and returns success", async () => {
    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.alerts.delete({ id: 1 });
    expect(result).toEqual({ success: true });
  });
});

describe("alerts.toggle", () => {
  it("toggles alert active state and returns success", async () => {
    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.alerts.toggle({ id: 1, isActive: false });
    expect(result).toEqual({ success: true });
  });
});

// ─── Analytics tests ──────────────────────────────────────────────────────────
describe("analytics.summary", () => {
  it("computes correct win rate from journal entries", async () => {
    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.analytics.summary();
    // 2 closed trades (WIN + LOSS), 1 pending
    expect(result.total).toBe(3);
    expect(result.wins).toBe(1);
    expect(result.losses).toBe(1);
    expect(result.pending).toBe(1);
    expect(result.winRate).toBeCloseTo(50, 1); // 1/2 = 50%
  });

  it("computes correct total PnL", async () => {
    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.analytics.summary();
    expect(result.totalPnl).toBe(100); // 200 - 100
  });

  it("computes average RR across all entries", async () => {
    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.analytics.summary();
    expect(result.avgRR).toBeCloseTo(2.0, 1);
  });

  it("returns equity curve with cumulative PnL", async () => {
    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.analytics.summary();
    // 2 entries have pnl (200 and -100)
    expect(result.equityCurve.length).toBe(2);
    expect(result.equityCurve[0].pnl).toBe(200);
    expect(result.equityCurve[0].cumPnl).toBe(200);
    expect(result.equityCurve[1].pnl).toBe(-100);
    expect(result.equityCurve[1].cumPnl).toBe(100);
  });

  it("returns pattern breakdown sorted by total count", async () => {
    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.analytics.summary();
    // "Supply Zone Rejection" appears twice (AAPL + GBP/USD)
    const supplyPattern = result.patternBreakdown.find((p) => p.pattern === "Supply Zone Rejection");
    expect(supplyPattern).toBeDefined();
    expect(supplyPattern!.total).toBe(2);
  });

  it("returns asset class breakdown with correct totals", async () => {
    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.analytics.summary();
    const forex = result.assetBreakdown.find((a) => a.assetClass === "FOREX");
    const stock = result.assetBreakdown.find((a) => a.assetClass === "STOCK");
    expect(forex?.total).toBe(2);
    expect(stock?.total).toBe(1);
  });
});
