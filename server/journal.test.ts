import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Mock DB helpers ───────────────────────────────────────────────────────────

vi.mock("./db", () => ({
  getJournalEntries: vi.fn().mockResolvedValue([
    {
      id: 1,
      userId: 1,
      setupId: "setup-abc",
      symbol: "AAPL",
      assetClass: "STOCK",
      setupType: "CALL",
      quality: "PREMIUM",
      pattern: "Bull Flag",
      timeframe: "1H",
      levels: { entry: 175, stopLoss: 172, takeProfit: 182 },
      rrRatio: 2.3,
      confluences: ["EMA 21", "Volume Surge"],
      notes: "",
      outcome: "PENDING",
      pnl: null,
      tags: ["premium", "call"],
      sector: "Technology",
      ivRank: 45,
      session: null,
      pushedAt: new Date("2026-03-31T00:00:00Z"),
      entryDate: null,
      exitDate: null,
    },
  ]),
  createJournalEntry: vi.fn().mockResolvedValue({ insertId: 2 }),
  updateJournalEntry: vi.fn().mockResolvedValue(undefined),
  deleteJournalEntry: vi.fn().mockResolvedValue(undefined),
  getJournalEntrySetupIds: vi.fn().mockResolvedValue(["setup-abc"]),
  upsertUser: vi.fn(),
  getUserByOpenId: vi.fn(),
}));

// ─── Test context factory ──────────────────────────────────────────────────────

function createAuthContext(userId = 1): TrpcContext {
  return {
    user: {
      id: userId,
      openId: "test-open-id",
      email: "trader@example.com",
      name: "Test Trader",
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

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("journal.list", () => {
  it("returns journal entries for the authenticated user", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.journal.list();
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe("AAPL");
  });
});

describe("journal.pushedIds", () => {
  it("returns array of setup IDs already in journal", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const ids = await caller.journal.pushedIds();
    expect(ids).toContain("setup-abc");
  });
});

describe("journal.create", () => {
  it("creates a new journal entry with required fields", async () => {
    const { createJournalEntry } = await import("./db");
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.journal.create({
      setupId: "setup-xyz",
      symbol: "TSLA",
      assetClass: "STOCK",
      setupType: "PUT",
      quality: "STRONG",
      pattern: "Double Top",
      timeframe: "4H",
      levels: { entry: 250, stopLoss: 260, takeProfit: 230 },
      rrRatio: 2.0,
      confluences: ["RSI Divergence"],
      tags: ["strong", "put"],
    });

    expect(result.success).toBe(true);
    expect(createJournalEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        setupId: "setup-xyz",
        symbol: "TSLA",
        outcome: "PENDING",
      })
    );
  });
});

describe("journal.update", () => {
  it("updates outcome and pnl for an entry", async () => {
    const { updateJournalEntry } = await import("./db");
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.journal.update({ id: 1, outcome: "WIN", pnl: 350 });

    expect(result.success).toBe(true);
    expect(updateJournalEntry).toHaveBeenCalledWith(
      1,
      1,
      expect.objectContaining({ outcome: "WIN", pnl: 350 })
    );
  });
});

describe("journal.delete", () => {
  it("deletes a journal entry by id", async () => {
    const { deleteJournalEntry } = await import("./db");
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.journal.delete({ id: 1 });

    expect(result.success).toBe(true);
    expect(deleteJournalEntry).toHaveBeenCalledWith(1, 1);
  });
});

describe("auth.logout", () => {
  it("clears session cookie and returns success", async () => {
    const ctx = createAuthContext();
    const clearedCookies: string[] = [];
    (ctx.res.clearCookie as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
      clearedCookies.push(name);
    });

    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();

    expect(result.success).toBe(true);
    expect(clearedCookies.length).toBeGreaterThan(0);
  });
});
