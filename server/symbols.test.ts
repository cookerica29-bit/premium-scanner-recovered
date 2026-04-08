import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import type { ScreenerSymbol } from "../drizzle/schema";

// ─── Mock DB module ───────────────────────────────────────────────────────────
// NOTE: vi.mock is hoisted, so we cannot use top-level variables inside the factory.
// Instead, we use vi.fn() directly and retrieve them via vi.mocked() after import.

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getScreenerSymbols: vi.fn().mockResolvedValue([]),
    addScreenerSymbol: vi.fn().mockResolvedValue(undefined),
    removeScreenerSymbol: vi.fn().mockResolvedValue(undefined),
    toggleScreenerSymbol: vi.fn().mockResolvedValue(undefined),
    findScreenerSymbolDuplicate: vi.fn().mockResolvedValue(undefined),
    // Keep other mocks
    getJournalEntries: vi.fn().mockResolvedValue([]),
    createJournalEntry: vi.fn().mockResolvedValue(undefined),
    updateJournalEntry: vi.fn().mockResolvedValue(undefined),
    deleteJournalEntry: vi.fn().mockResolvedValue(undefined),
    getJournalEntrySetupIds: vi.fn().mockResolvedValue([]),
    getPatternWinRates: vi.fn().mockResolvedValue({}),
    getPriceAlerts: vi.fn().mockResolvedValue([]),
    createPriceAlert: vi.fn().mockResolvedValue(undefined),
    deletePriceAlert: vi.fn().mockResolvedValue(undefined),
    togglePriceAlert: vi.fn().mockResolvedValue(undefined),
    getWatchlist: vi.fn().mockResolvedValue([]),
    createWatchlistItem: vi.fn().mockResolvedValue(undefined),
    updateWatchlistItem: vi.fn().mockResolvedValue(undefined),
    deleteWatchlistItem: vi.fn().mockResolvedValue(undefined),
    findWatchlistDuplicate: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock oanda and polygonData to avoid real API calls
vi.mock("./oanda", () => ({
  fetchOandaCandles: vi.fn().mockResolvedValue([]),
  FOREX_PAIRS: ["EUR_USD", "GBP_USD", "USD_JPY"],
  FOREX_PAIR_LABELS: { EUR_USD: "EUR/USD", GBP_USD: "GBP/USD", USD_JPY: "USD/JPY" },
  HTF_MAP: {},
  TIMEFRAME_MAP: {},
  getForexCacheAge: vi.fn().mockReturnValue(0),
  isForexCacheWarm: vi.fn().mockReturnValue(true),
}));

vi.mock("./polygonData", () => ({
  fetchStockCandles: vi.fn().mockResolvedValue([]),
  fetchStockCandlesBatch: vi.fn().mockResolvedValue(new Map()),
  fetchStockCandlesCached: vi.fn().mockReturnValue(new Map()),
  warmCacheInBackground: vi.fn(),
  warmHTFCacheInBackground: vi.fn(),
  fetchHTFCandlesCached: vi.fn().mockReturnValue(null),
  getCacheAge: vi.fn().mockReturnValue(0),
  isCacheWarm: vi.fn().mockReturnValue(true),
  getCachedCount: vi.fn().mockReturnValue(0),
  STOCK_SYMBOLS: ["AAPL", "NVDA", "TSLA"],
  STOCK_SECTORS: { AAPL: "Technology", NVDA: "Technology", TSLA: "Consumer Discretionary" },
  STOCK_HTF_MAP: {},
  HTF_MAP: { "15m": "1H", "30m": "4H", "1H": "4H", "4H": "Daily", "Daily": "Weekly" },
  fetchNextEarningsDate: vi.fn().mockResolvedValue(null),
  isNearEarnings: vi.fn().mockReturnValue(false),
}));

// ─── Import mocked helpers after vi.mock ─────────────────────────────────────
import {
  getScreenerSymbols as _getScreenerSymbols,
  addScreenerSymbol as _addScreenerSymbol,
  removeScreenerSymbol as _removeScreenerSymbol,
  toggleScreenerSymbol as _toggleScreenerSymbol,
  findScreenerSymbolDuplicate as _findScreenerSymbolDuplicate,
} from "./db";

const mockGetScreenerSymbols = vi.mocked(_getScreenerSymbols);
const mockAddScreenerSymbol = vi.mocked(_addScreenerSymbol);
const mockRemoveScreenerSymbol = vi.mocked(_removeScreenerSymbol);
const mockToggleScreenerSymbol = vi.mocked(_toggleScreenerSymbol);
const mockFindScreenerSymbolDuplicate = vi.mocked(_findScreenerSymbolDuplicate);

// ─── Auth context helpers ─────────────────────────────────────────────────────

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
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
  return { ctx };
}

const unauthCtx: TrpcContext = {
  user: null,
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("symbols.list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetScreenerSymbols.mockResolvedValue([]);
    mockFindScreenerSymbolDuplicate.mockResolvedValue(undefined);
  });

  it("returns merged defaults with no user overrides for forex", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.symbols.list({ assetClass: "forex" });
    // Should contain the 3 mocked FOREX_PAIRS
    expect(result).toHaveLength(3);
    expect(result[0].symbol).toBe("EUR_USD");
    expect(result[0].isDefault).toBe(true);
    expect(result[0].enabled).toBe(1);
  });

  it("returns merged defaults with no user overrides for stocks", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.symbols.list({ assetClass: "stock" });
    expect(result).toHaveLength(3);
    expect(result[0].symbol).toBe("AAPL");
    expect(result[0].isDefault).toBe(true);
  });

  it("applies user disable override to a default symbol", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    // User has disabled EUR_USD
    mockGetScreenerSymbols.mockResolvedValue([
      { id: 10, userId: 42, symbol: "EUR_USD", displaySymbol: "EUR/USD", assetClass: "FOREX", enabled: 0, addedAt: new Date() } as ScreenerSymbol,
    ]);
    const result = await caller.symbols.list({ assetClass: "forex" });
    const eurusd = result.find((s) => s.symbol === "EUR_USD");
    expect(eurusd).toBeDefined();
    expect(eurusd!.enabled).toBe(0);
    expect(eurusd!.isDefault).toBe(true);
    expect(eurusd!.id).toBe(10);
  });

  it("includes custom (non-default) enabled symbols", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    // User has added a custom symbol
    mockGetScreenerSymbols.mockResolvedValue([
      { id: 20, userId: 42, symbol: "USD_CAD", displaySymbol: "USD/CAD", assetClass: "FOREX", enabled: 1, addedAt: new Date() } as ScreenerSymbol,
    ]);
    const result = await caller.symbols.list({ assetClass: "forex" });
    const usdcad = result.find((s) => s.symbol === "USD_CAD");
    expect(usdcad).toBeDefined();
    expect(usdcad!.isDefault).toBe(false);
    expect(usdcad!.enabled).toBe(1);
  });

  it("requires authentication", async () => {
    const caller = appRouter.createCaller(unauthCtx);
    await expect(caller.symbols.list({ assetClass: "forex" })).rejects.toThrow();
  });
});

describe("symbols.add", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindScreenerSymbolDuplicate.mockResolvedValue(undefined);
  });

  it("adds a new custom forex symbol", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.symbols.add({ assetClass: "forex", symbol: "USD_CAD", label: "USD/CAD" });
    expect(result.success).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(mockAddScreenerSymbol).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: "USD_CAD", assetClass: "FOREX", enabled: 1 })
    );
  });

  it("adds a new custom stock symbol", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.symbols.add({ assetClass: "stock", symbol: "MSFT" });
    expect(result.success).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(mockAddScreenerSymbol).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: "MSFT", assetClass: "STOCK" })
    );
  });

  it("returns duplicate flag when symbol already exists", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    mockFindScreenerSymbolDuplicate.mockResolvedValue({
      id: 5, userId: 42, symbol: "USD_CAD", assetClass: "FOREX", enabled: 1, addedAt: new Date(),
    } as ScreenerSymbol);
    const result = await caller.symbols.add({ assetClass: "forex", symbol: "USD_CAD" });
    expect(result.success).toBe(false);
    expect(result.duplicate).toBe(true);
    expect(mockAddScreenerSymbol).not.toHaveBeenCalled();
  });

  it("uppercases the symbol before saving", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await caller.symbols.add({ assetClass: "stock", symbol: "msft" });
    expect(mockAddScreenerSymbol).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: "MSFT" })
    );
  });

  it("requires authentication", async () => {
    const caller = appRouter.createCaller(unauthCtx);
    await expect(caller.symbols.add({ assetClass: "forex", symbol: "EUR_USD" })).rejects.toThrow();
  });
});

describe("symbols.remove", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes a symbol by id", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.symbols.remove({ id: 7 });
    expect(result.success).toBe(true);
    expect(mockRemoveScreenerSymbol).toHaveBeenCalledWith(7, 42);
  });

  it("requires authentication", async () => {
    const caller = appRouter.createCaller(unauthCtx);
    await expect(caller.symbols.remove({ id: 1 })).rejects.toThrow();
  });
});

describe("symbols.toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("disables a symbol", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.symbols.toggle({ id: 3, enabled: false });
    expect(result.success).toBe(true);
    expect(mockToggleScreenerSymbol).toHaveBeenCalledWith(3, 42, 0);
  });

  it("enables a symbol", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.symbols.toggle({ id: 3, enabled: true });
    expect(result.success).toBe(true);
    expect(mockToggleScreenerSymbol).toHaveBeenCalledWith(3, 42, 1);
  });

  it("requires authentication", async () => {
    const caller = appRouter.createCaller(unauthCtx);
    await expect(caller.symbols.toggle({ id: 1, enabled: false })).rejects.toThrow();
  });
});

describe("symbols.toggleDefault", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindScreenerSymbolDuplicate.mockResolvedValue(undefined);
  });

  it("creates a disabled override row for a default symbol with no existing DB row", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.symbols.toggleDefault({ assetClass: "forex", symbol: "EUR_USD", enabled: false });
    expect(result.success).toBe(true);
    expect(mockAddScreenerSymbol).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: "EUR_USD", assetClass: "FOREX", enabled: 0 })
    );
    expect(mockToggleScreenerSymbol).not.toHaveBeenCalled();
  });

  it("updates existing override row when one exists", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    mockFindScreenerSymbolDuplicate.mockResolvedValue({
      id: 15, userId: 42, symbol: "EUR_USD", assetClass: "FOREX", enabled: 0, addedAt: new Date(),
    } as ScreenerSymbol);
    const result = await caller.symbols.toggleDefault({ assetClass: "forex", symbol: "EUR_USD", enabled: true });
    expect(result.success).toBe(true);
    expect(mockToggleScreenerSymbol).toHaveBeenCalledWith(15, 42, 1);
    expect(mockAddScreenerSymbol).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    const caller = appRouter.createCaller(unauthCtx);
    await expect(
      caller.symbols.toggleDefault({ assetClass: "forex", symbol: "EUR_USD", enabled: false })
    ).rejects.toThrow();
  });
});

describe("screener scan uses active symbol list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetScreenerSymbols.mockResolvedValue([]);
  });

  it("forex scan uses all defaults when user has no overrides", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.screener.forex({ timeframe: "4H", minRR: 2 });
    // totalPairs should be 3 (mocked FOREX_PAIRS length)
    expect(result.totalPairs).toBe(3);
  });

  it("forex scan excludes disabled default symbols", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    // User disabled EUR_USD
    mockGetScreenerSymbols.mockResolvedValue([
      { id: 10, userId: 42, symbol: "EUR_USD", displaySymbol: "EUR/USD", assetClass: "FOREX", enabled: 0, addedAt: new Date() } as ScreenerSymbol,
    ]);
    const result = await caller.screener.forex({ timeframe: "4H", minRR: 2 });
    // totalPairs should be 2 (EUR_USD excluded)
    expect(result.totalPairs).toBe(2);
  });

  it("forex scan includes custom enabled symbols", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    // User added USD_CAD as custom
    mockGetScreenerSymbols.mockResolvedValue([
      { id: 20, userId: 42, symbol: "USD_CAD", displaySymbol: "USD/CAD", assetClass: "FOREX", enabled: 1, addedAt: new Date() } as ScreenerSymbol,
    ]);
    const result = await caller.screener.forex({ timeframe: "4H", minRR: 2 });
    // totalPairs should be 4 (3 defaults + 1 custom)
    expect(result.totalPairs).toBe(4);
  });

  it("stocks scan uses all defaults when user has no overrides", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.screener.stocks({ timeframe: "Daily" });
    expect(result.totalSymbols).toBe(3);
  });

  it("stocks scan excludes disabled default symbols", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    // User disabled AAPL
    mockGetScreenerSymbols.mockResolvedValue([
      { id: 30, userId: 42, symbol: "AAPL", displaySymbol: "AAPL", assetClass: "STOCK", enabled: 0, addedAt: new Date() } as ScreenerSymbol,
    ]);
    const result = await caller.screener.stocks({ timeframe: "Daily" });
    expect(result.totalSymbols).toBe(2);
  });

  it("stocks scan includes custom enabled symbols", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    // User added MSFT as custom
    mockGetScreenerSymbols.mockResolvedValue([
      { id: 40, userId: 42, symbol: "MSFT", displaySymbol: "MSFT", assetClass: "STOCK", enabled: 1, addedAt: new Date() } as ScreenerSymbol,
    ]);
    const result = await caller.screener.stocks({ timeframe: "Daily" });
    expect(result.totalSymbols).toBe(4);
  });

  it("forex scan falls back to all defaults for unauthenticated users", async () => {
    const caller = appRouter.createCaller(unauthCtx);
    const result = await caller.screener.forex({ timeframe: "4H", minRR: 2 });
    expect(result.totalPairs).toBe(3);
    // getScreenerSymbols should NOT have been called for unauthenticated users
    expect(mockGetScreenerSymbols).not.toHaveBeenCalled();
  });
});
