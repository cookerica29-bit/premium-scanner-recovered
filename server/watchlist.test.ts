import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Mock DB module ───────────────────────────────────────────────────────────

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getWatchlist: vi.fn().mockResolvedValue([]),
    createWatchlistItem: vi.fn().mockResolvedValue(undefined),
    updateWatchlistItem: vi.fn().mockResolvedValue(undefined),
    deleteWatchlistItem: vi.fn().mockResolvedValue(undefined),
    // Keep other mocks from other tests
    getJournalEntries: vi.fn().mockResolvedValue([]),
    createJournalEntry: vi.fn().mockResolvedValue(undefined),
    updateJournalEntry: vi.fn().mockResolvedValue(undefined),
    deleteJournalEntry: vi.fn().mockResolvedValue(undefined),
    getJournalEntrySetupIds: vi.fn().mockResolvedValue([]),
    getPriceAlerts: vi.fn().mockResolvedValue([]),
    createPriceAlert: vi.fn().mockResolvedValue(undefined),
    deletePriceAlert: vi.fn().mockResolvedValue(undefined),
    togglePriceAlert: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock oanda and stockData to avoid real API calls
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

// ─── Auth context helper ──────────────────────────────────────────────────────

function createAuthContext(userId = 42): { ctx: TrpcContext } {
  const ctx: TrpcContext = {
    user: {
      id: userId,
      openId: `user-${userId}`,
      email: `user${userId}@example.com`,
      name: `Trader ${userId}`,
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
  return { ctx };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("watchlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("list returns empty array for new user", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.watchlist.list();
    expect(result).toEqual([]);
  });

  it("create adds a forex watchlist item", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.watchlist.create({
      symbol: "EUR_USD",
      displaySymbol: "EUR/USD",
      assetClass: "FOREX",
      timeframe: "4H",
      bias: "BULLISH",
      notes: "Watching demand zone at 1.0850",
      keyLevel1: "1.0850",
      keyLevel1Label: "Demand Zone",
      keyLevel2: "1.1000",
      keyLevel2Label: "Supply Zone",
      tags: ["supply-demand", "trending"],
    });

    expect(result).toEqual({ success: true, duplicate: false });
  });

  it("create adds a stock watchlist item", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.watchlist.create({
      symbol: "AAPL",
      displaySymbol: "AAPL",
      assetClass: "STOCK",
      timeframe: "Daily",
      bias: "BEARISH",
      notes: "Supply zone overhead at 195",
    });

    expect(result).toEqual({ success: true, duplicate: false });
  });

  it("create rejects empty symbol", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.watchlist.create({
        symbol: "",
        displaySymbol: "",
        assetClass: "FOREX",
        timeframe: "4H",
        bias: "NEUTRAL",
      })
    ).rejects.toThrow();
  });

  it("update modifies bias and notes", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.watchlist.update({
      id: 1,
      bias: "BEARISH",
      notes: "Updated: supply zone rejected price",
      keyLevel1: "1.0900",
      keyLevel1Label: "Demand Zone",
    });

    expect(result).toEqual({ success: true });
  });

  it("update accepts nullable key levels to clear them", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.watchlist.update({
      id: 2,
      keyLevel3: null,
      keyLevel3Label: null,
    });

    expect(result).toEqual({ success: true });
  });

  it("delete removes a watchlist item", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.watchlist.delete({ id: 5 });
    expect(result).toEqual({ success: true });
  });

  it("requires authentication for all watchlist operations", async () => {
    const unauthCtx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(unauthCtx);

    await expect(caller.watchlist.list()).rejects.toThrow();
    await expect(
      caller.watchlist.create({
        symbol: "EUR_USD",
        displaySymbol: "EUR/USD",
        assetClass: "FOREX",
        timeframe: "4H",
        bias: "NEUTRAL",
      })
    ).rejects.toThrow();
    await expect(caller.watchlist.delete({ id: 1 })).rejects.toThrow();
  });
});
