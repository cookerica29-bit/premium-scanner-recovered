import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, float, json, decimal, tinyint } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Trade journal entries — one per user per setup pushed.
 * Stores full setup details so the journal is self-contained.
 */
export const journalEntries = mysqlTable("journal_entries", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  /** Original screener setup ID (nanoid) */
  setupId: varchar("setupId", { length: 64 }).notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  assetClass: mysqlEnum("assetClass", ["STOCK", "FOREX"]).notNull(),
  setupType: mysqlEnum("setupType", ["CALL", "PUT", "LONG", "SHORT"]).notNull(),
  quality: mysqlEnum("quality", ["PREMIUM", "STRONG", "DEVELOPING"]).notNull(),
  pattern: varchar("pattern", { length: 120 }).notNull(),
  timeframe: varchar("timeframe", { length: 10 }).notNull(),
  /** JSON: { entry, stopLoss, takeProfit, takeProfit2?, takeProfit3? } */
  levels: json("levels").notNull(),
  rrRatio: float("rrRatio").notNull(),
  /** JSON: string[] */
  confluences: json("confluences").notNull(),
  notes: text("notes").default(""),
  outcome: mysqlEnum("outcome", ["WIN", "LOSS", "BREAKEVEN", "PENDING"]).default("PENDING"),
  pnl: float("pnl"),
  /** JSON: string[] */
  tags: json("tags").notNull(),
  sector: varchar("sector", { length: 80 }),
  ivRank: int("ivRank"),
  session: varchar("session", { length: 60 }),
  pushedAt: timestamp("pushedAt").defaultNow().notNull(),
  entryDate: timestamp("entryDate"),
  exitDate: timestamp("exitDate"),
});

export type JournalEntryRow = typeof journalEntries.$inferSelect;
export type InsertJournalEntry = typeof journalEntries.$inferInsert;

/**
 * Price alerts — notify user when price approaches a setup's entry zone.
 */
export const priceAlerts = mysqlTable("price_alerts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  symbol: varchar("symbol", { length: 32 }).notNull(),
  displaySymbol: varchar("displaySymbol", { length: 32 }).notNull(),
  assetClass: mysqlEnum("assetClass", ["STOCK", "FOREX"]).notNull().default("FOREX"),
  direction: mysqlEnum("direction", ["LONG", "SHORT", "CALL", "PUT"]).notNull(),
  targetPrice: decimal("targetPrice", { precision: 18, scale: 6 }).notNull(),
  currentPrice: decimal("currentPrice", { precision: 18, scale: 6 }).notNull(),
  proximityPct: decimal("proximityPct", { precision: 5, scale: 2 }).notNull().default("0.5"),
  timeframe: varchar("timeframe", { length: 8 }).notNull().default("4H"),
  pattern: varchar("pattern", { length: 128 }),
  notes: text("notes"),
  isActive: tinyint("isActive").notNull().default(1),
  isTriggered: tinyint("isTriggered").notNull().default(0),
  triggeredAt: timestamp("triggeredAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PriceAlertRow = typeof priceAlerts.$inferSelect;
export type InsertPriceAlert = typeof priceAlerts.$inferInsert;

/**
 * Watchlist — user-pinned symbols with key levels and notes.
 */
export const watchlist = mysqlTable("watchlist", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  displaySymbol: varchar("displaySymbol", { length: 30 }).notNull(),
  assetClass: mysqlEnum("assetClass", ["STOCK", "FOREX"]).notNull().default("FOREX"),
  timeframe: varchar("timeframe", { length: 10 }).notNull().default("4H"),
  notes: text("notes"),
  keyLevel1: varchar("keyLevel1", { length: 30 }),
  keyLevel1Label: varchar("keyLevel1Label", { length: 50 }),
  keyLevel2: varchar("keyLevel2", { length: 30 }),
  keyLevel2Label: varchar("keyLevel2Label", { length: 50 }),
  keyLevel3: varchar("keyLevel3", { length: 30 }),
  keyLevel3Label: varchar("keyLevel3Label", { length: 50 }),
  bias: mysqlEnum("bias", ["BULLISH", "BEARISH", "NEUTRAL"]).default("NEUTRAL"),
  tags: text("tags"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type WatchlistItem = typeof watchlist.$inferSelect;
export type InsertWatchlistItem = typeof watchlist.$inferInsert;

/**
 * Screener symbols — per-user custom symbol lists for stock and forex screeners.
 */
export const screenerSymbols = mysqlTable("screener_symbols", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  displaySymbol: varchar("displaySymbol", { length: 30 }).notNull(),
  assetClass: mysqlEnum("assetClass", ["FOREX", "STOCK"]).notNull(),
  enabled: int("enabled").notNull().default(1),
  addedAt: timestamp("addedAt").defaultNow().notNull(),
});

export type ScreenerSymbol = typeof screenerSymbols.$inferSelect;
export type InsertScreenerSymbol = typeof screenerSymbols.$inferInsert;