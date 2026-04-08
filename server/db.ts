import { eq, and, desc, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, journalEntries, InsertJournalEntry, priceAlerts, InsertPriceAlert, watchlist, InsertWatchlistItem, WatchlistItem, screenerSymbols, ScreenerSymbol, InsertScreenerSymbol } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ─── Journal helpers ────────────────────────────────────────────────────────────

export async function getJournalEntries(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.userId, userId))
    .orderBy(desc(journalEntries.pushedAt));
}

export async function createJournalEntry(entry: InsertJournalEntry) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(journalEntries).values(entry);
  return result;
}

export async function updateJournalEntry(
  id: number,
  userId: number,
  data: Partial<Pick<InsertJournalEntry, "notes" | "outcome" | "pnl" | "tags" | "entryDate" | "exitDate">>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(journalEntries)
    .set(data)
    .where(and(eq(journalEntries.id, id), eq(journalEntries.userId, userId)));
}

export async function deleteJournalEntry(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(journalEntries)
    .where(and(eq(journalEntries.id, id), eq(journalEntries.userId, userId)));
}

/**
 * Compute win rates per pattern from closed journal entries.
 * Returns a map of pattern name → win rate (0–1).
 * Only patterns with at least 3 closed trades are included (too few = noise).
 */
export async function getPatternWinRates(userId: number): Promise<Record<string, number>> {
  const db = await getDb();
  if (!db) return {};
  const rows = await db
    .select({ pattern: journalEntries.pattern, outcome: journalEntries.outcome })
    .from(journalEntries)
    .where(and(
      eq(journalEntries.userId, userId),
      ne(journalEntries.outcome, "PENDING"),
    ));
  const counts: Record<string, { wins: number; total: number }> = {};
  for (const row of rows) {
    if (row.outcome === "PENDING") continue;
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

/**
 * Find a journal entry by setupId for a given user.
 * Returns the entry or undefined if not found.
 */
export async function getJournalEntryBySetupId(
  userId: number,
  setupId: string
) {
  const db = await getDb();
  if (!db) return undefined;
  const results = await db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.userId, userId), eq(journalEntries.setupId, setupId)))
    .limit(1);
  return results[0];
}

/**
 * Get a map of setupId → outcome for all journal entries belonging to a user.
 * Used by the screener to show current outcome state on setup cards.
 */
export async function getOutcomesByUser(
  userId: number
): Promise<Record<string, string>> {
  const db = await getDb();
  if (!db) return {};
  const rows = await db
    .select({ setupId: journalEntries.setupId, outcome: journalEntries.outcome })
    .from(journalEntries)
    .where(eq(journalEntries.userId, userId));
  const map: Record<string, string> = {};
  for (const row of rows) {
    if (row.setupId) map[row.setupId] = row.outcome ?? "PENDING";
  }
  return map;
}

export async function getJournalEntrySetupIds(userId: number): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ setupId: journalEntries.setupId })
    .from(journalEntries)
    .where(eq(journalEntries.userId, userId));
  return rows.map((r) => r.setupId);
}

// ─── Price Alert helpers ─────────────────────────────────────────────────────────

export async function getPriceAlerts(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(priceAlerts)
    .where(eq(priceAlerts.userId, userId))
    .orderBy(desc(priceAlerts.createdAt));
}

export async function createPriceAlert(alert: InsertPriceAlert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(priceAlerts).values(alert);
  return result;
}

export async function deletePriceAlert(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(priceAlerts)
    .where(and(eq(priceAlerts.id, id), eq(priceAlerts.userId, userId)));
}

export async function togglePriceAlert(id: number, userId: number, isActive: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(priceAlerts)
    .set({ isActive })
    .where(and(eq(priceAlerts.id, id), eq(priceAlerts.userId, userId)));
}

export async function markAlertTriggered(id: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(priceAlerts)
    .set({ isTriggered: 1, isActive: 0, triggeredAt: new Date() })
    .where(eq(priceAlerts.id, id));
}

// ─── Watchlist helpers ────────────────────────────────────────────────────────────────

export async function getWatchlist(userId: number): Promise<WatchlistItem[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(watchlist).where(eq(watchlist.userId, userId)).orderBy(watchlist.createdAt);
}

export async function findWatchlistDuplicate(
  userId: number,
  symbol: string,
  timeframe: string
): Promise<WatchlistItem | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const results = await db
    .select()
    .from(watchlist)
    .where(and(eq(watchlist.userId, userId), eq(watchlist.symbol, symbol), eq(watchlist.timeframe, timeframe)))
    .limit(1);
  return results[0];
}

export async function createWatchlistItem(item: InsertWatchlistItem): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(watchlist).values(item);
}

export async function updateWatchlistItem(
  id: number,
  userId: number,
  data: Partial<Omit<InsertWatchlistItem, "id" | "userId" | "createdAt">>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(watchlist).set(data).where(and(eq(watchlist.id, id), eq(watchlist.userId, userId)));
}

export async function deleteWatchlistItem(id: number, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(watchlist).where(and(eq(watchlist.id, id), eq(watchlist.userId, userId)));
}

// ─── Screener Symbol helpers ────────────────────────────────────────────────────────────────────────────────────────

export async function getScreenerSymbols(userId: number, assetClass: "FOREX" | "STOCK"): Promise<ScreenerSymbol[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(screenerSymbols)
    .where(and(eq(screenerSymbols.userId, userId), eq(screenerSymbols.assetClass, assetClass)))
    .orderBy(screenerSymbols.addedAt);
}

export async function addScreenerSymbol(item: InsertScreenerSymbol): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(screenerSymbols).values(item);
}

export async function removeScreenerSymbol(id: number, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(screenerSymbols).where(and(eq(screenerSymbols.id, id), eq(screenerSymbols.userId, userId)));
}

export async function toggleScreenerSymbol(id: number, userId: number, enabled: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(screenerSymbols).set({ enabled }).where(and(eq(screenerSymbols.id, id), eq(screenerSymbols.userId, userId)));
}

export async function findScreenerSymbolDuplicate(
  userId: number,
  symbol: string,
  assetClass: "FOREX" | "STOCK"
): Promise<ScreenerSymbol | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const results = await db
    .select()
    .from(screenerSymbols)
    .where(and(eq(screenerSymbols.userId, userId), eq(screenerSymbols.symbol, symbol), eq(screenerSymbols.assetClass, assetClass)))
    .limit(1);
  return results[0];
}
