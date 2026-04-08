import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import {
  getJournalEntries,
  createJournalEntry,
  updateJournalEntry,
  deleteJournalEntry,
  getJournalEntrySetupIds,
  getJournalEntryBySetupId,
  getOutcomesByUser,
  getPatternWinRates,
  getPriceAlerts,
  createPriceAlert,
  deletePriceAlert,
  togglePriceAlert,
  getWatchlist,
  findWatchlistDuplicate,
  createWatchlistItem,
  updateWatchlistItem,
  deleteWatchlistItem,
  getScreenerSymbols,
  addScreenerSymbol,
  removeScreenerSymbol,
  toggleScreenerSymbol,
  findScreenerSymbolDuplicate,
} from "./db";
import { fetchOandaCandles, FOREX_PAIRS, FOREX_PAIR_LABELS, HTF_MAP, TIMEFRAME_MAP } from "./oanda";
import { fetchStockCandles, fetchStockCandlesCached, warmCacheInBackground, warmHTFCacheInBackground, fetchHTFCandlesCached, HTF_MAP as STOCK_HTF_MAP_TF, STOCK_SYMBOLS, STOCK_SECTORS, STOCK_HTF_MAP, getCacheAge, isCacheWarm, getCachedCount, fetchNextEarningsDate, isNearEarnings } from "./polygonData";
import { evaluateSetup } from "./analysis/supplyDemand";
import { evaluateEmaPullback, evaluateHTFTrend } from "./analysis/emaPullback";
import { evaluatePriceAction } from "./analysis/priceAction";
import type { OandaGranularity } from "./oanda";

// ─── Journal Schemas ──────────────────────────────────────────────────────────

const LevelsSchema = z.object({
  entry: z.number(),
  stopLoss: z.number(),
  takeProfit: z.number(),
  takeProfit2: z.number().optional(),
  takeProfit3: z.number().optional(),
});

const CreateJournalEntryInput = z.object({
  setupId: z.string(),
  symbol: z.string(),
  assetClass: z.enum(["STOCK", "FOREX"]),
  setupType: z.enum(["CALL", "PUT", "LONG", "SHORT"]),
  quality: z.enum(["PREMIUM", "STRONG", "DEVELOPING"]),
  pattern: z.string(),
  timeframe: z.string(),
  levels: LevelsSchema,
  rrRatio: z.number(),
  confluences: z.array(z.string()),
  notes: z.string().optional(),
  tags: z.array(z.string()).default([]),
  sector: z.string().optional(),
  ivRank: z.number().optional(),
  session: z.string().optional(),
});

const UpdateJournalEntryInput = z.object({
  id: z.number(),
  notes: z.string().optional(),
  outcome: z.enum(["WIN", "LOSS", "BREAKEVEN", "PENDING"]).optional(),
  pnl: z.number().nullable().optional(),
  tags: z.array(z.string()).optional(),
  entryDate: z.date().nullable().optional(),
  exitDate: z.date().nullable().optional(),
});

// ─── Screener Result Type ─────────────────────────────────────────────────────

export interface ScreenerSetup {
  id: string;
  symbol: string;
  displaySymbol: string;
  assetClass: "STOCK" | "FOREX";
  setupType: "CALL" | "PUT" | "LONG" | "SHORT";
  quality: "PREMIUM" | "STRONG" | "DEVELOPING";
  pattern: string;
  timeframe: string;
  currentPrice: number;
  levels: {
    entry: number;
    stopLoss: number;
    takeProfit: number;
    takeProfit2: number;
    takeProfit3: number;
  };
  rrRatio: number;
  confluences: string[];
  sector?: string;
  session?: string;
  ema20?: number;
  ema50?: number;
  earningsDate?: string;
  scannedAt: string;
  // ── Final-build enhanced fields (stocks only) ──────────────────────────────
  structureBias?: string;
  structureScore?: number;
  locationTag?: string;
  locationScore?: number;
  roomToMove?: string;
  roomScore?: number;
  timingState?: string;
  setupQuality?: string;
  finalTradeScore?: number;
  reason?: string;
  distanceToSupport?: number;
  distanceToResistance?: number;
  support20?: number;
  resistance20?: number;
  rsi14?: number;
  relVolume?: number;
  bestScore?: number;
  callScore?: number;
  putScore?: number;
  // ── Part 2 fields (stocks only) ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

// ─── Forex Screener ───────────────────────────────────────────────────────────

async function scanForexPair(
  instrument: string,
  timeframe: string
): Promise<ScreenerSetup | null> {
  try {
    const granularity = TIMEFRAME_MAP[timeframe] as OandaGranularity || "H4";
    const htfGranularity = HTF_MAP[granularity] || "D";

    const [candles, htfCandles] = await Promise.all([
      fetchOandaCandles(instrument, granularity, 200),
      fetchOandaCandles(instrument, htfGranularity, 100),
    ]);

    // EMA engine needs at least 55 candles
    if (candles.length < 55) return null;

    const result = evaluateEmaPullback(candles, {
      htfCandles,
      // No RS filter for forex (no SPY equivalent)
      relativeStrength: null,
    });
    if (!result.hasSetup || !result.direction || !result.quality) return null;

    // Enforce minimum 2:1 RR for forex
    if (result.rrRatio < 2.0) return null;

    const setupType: "LONG" | "SHORT" = result.direction;
    const displaySymbol = FOREX_PAIR_LABELS[instrument] || instrument.replace("_", "/");

    // Detect trading session based on current UTC hour
    const hour = new Date().getUTCHours();
    let session = "London/NY";
    if (hour >= 0 && hour < 8) session = "Asian";
    else if (hour >= 8 && hour < 13) session = "London";
    else if (hour >= 13 && hour < 17) session = "NY";
    else if (hour >= 17 && hour < 22) session = "NY/London Close";

    return {
      id: `${instrument}-${timeframe}-${Date.now()}`,
      symbol: instrument,
      displaySymbol,
      assetClass: "FOREX",
      setupType,
      quality: result.quality,
      pattern: result.pattern,
      timeframe,
      currentPrice: result.currentPrice,
      levels: {
        entry: result.entry,
        stopLoss: result.stopLoss,
        takeProfit: result.takeProfit,
        takeProfit2: result.takeProfit2,
        takeProfit3: result.takeProfit3,
      },
      rrRatio: result.rrRatio,
      confluences: result.confluences,
      session,
      scannedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error(`[Forex Scan] Error scanning ${instrument}:`, err);
    return null;
  }
}

// ─── Stock Screener ───────────────────────────────────────────────────────────

async function scanStockSymbol(
  symbol: string,
  timeframe: string
): Promise<ScreenerSetup | null> {
  try {
    const candles = await fetchStockCandles(symbol, timeframe);
    if (candles.length < 50) return null;

    const result = evaluateEmaPullback(candles);
    if (!result.hasSetup || !result.direction || !result.quality) return null;

    // Map LONG/SHORT to CALL/PUT for stocks
    const setupType: "CALL" | "PUT" = result.direction === "LONG" ? "CALL" : "PUT";

    return {
      id: `${symbol}-${timeframe}-${Date.now()}`,
      symbol,
      displaySymbol: symbol,
      assetClass: "STOCK",
      setupType,
      quality: result.quality,
      pattern: result.pattern,
      timeframe,
      currentPrice: result.currentPrice,
      levels: {
        entry: result.entry,
        stopLoss: result.stopLoss,
        takeProfit: result.takeProfit,
        takeProfit2: result.takeProfit2,
        takeProfit3: result.takeProfit3,
      },
      rrRatio: result.rrRatio,
      confluences: result.confluences,
      sector: STOCK_SECTORS[symbol],
      ema20: result.ema20 ?? undefined,
      ema50: result.ema50 ?? undefined,
      scannedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error(`[Stock Scan] Error scanning ${symbol}:`, err);
    return null;
  }
}

// ─── App Router ───────────────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ── Forex Screener ──────────────────────────────────────────────────────────
  screener: router({
    forex: publicProcedure
      .input(
        z.object({
          timeframe: z.enum(["15m", "30m", "1H", "4H", "Daily"]).default("4H"),
          minRR: z.number().min(2).max(5).default(2),
        })
      )
      .query(async ({ ctx, input }) => {
        // Resolve active forex pairs: merge defaults with user overrides when authenticated
        let activePairs: string[];
        if (ctx.user) {
          const userOverrides = await getScreenerSymbols(ctx.user.id, "FOREX");
          const overrideMap = new Map(userOverrides.map((r) => [r.symbol, r]));
          // Start from default pairs, apply disable overrides
          const defaultActive = FOREX_PAIRS.filter((p) => {
            const override = overrideMap.get(p);
            return override ? override.enabled !== 0 : true;
          });
          // Add custom (non-default) enabled symbols
          const defaultSet = new Set(FOREX_PAIRS);
          const customActive = userOverrides
            .filter((r) => !defaultSet.has(r.symbol) && r.enabled !== 0)
            .map((r) => r.symbol);
          activePairs = [...defaultActive, ...customActive];
        } else {
          activePairs = FOREX_PAIRS;
        }

        const results = await Promise.allSettled(
          activePairs.map((pair) => scanForexPair(pair, input.timeframe))
        );

        const setups: ScreenerSetup[] = results
          .filter((r): r is PromiseFulfilledResult<ScreenerSetup | null> => r.status === "fulfilled")
          .map((r) => r.value)
          .filter((s): s is ScreenerSetup => s !== null && s.rrRatio >= input.minRR)
          .sort((a, b) => {
            const qualityOrder = { PREMIUM: 0, STRONG: 1, DEVELOPING: 2 };
            return qualityOrder[a.quality] - qualityOrder[b.quality] || b.rrRatio - a.rrRatio;
          });

        return {
          setups,
          scannedAt: new Date().toISOString(),
          totalPairs: activePairs.length,
        };
      }),

    stocks: publicProcedure
      .input(
        z.object({
          timeframe: z.enum(["15m", "30m", "1H", "4H", "Daily"]).default("Daily"),
        })
      )
      .query(async ({ ctx, input }) => {
        // Resolve active stock symbols: merge defaults with user overrides when authenticated
        let activeSymbols: string[];
        if (ctx.user) {
          const userOverrides = await getScreenerSymbols(ctx.user.id, "STOCK");
          const overrideMap = new Map(userOverrides.map((r) => [r.symbol, r]));
          // Start from default symbols, apply disable overrides
          const defaultActive = STOCK_SYMBOLS.filter((s) => {
            const override = overrideMap.get(s);
            return override ? override.enabled !== 0 : true;
          });
          // Add custom (non-default) enabled symbols
          const defaultSet = new Set(STOCK_SYMBOLS);
          const customActive = userOverrides
            .filter((r) => !defaultSet.has(r.symbol) && r.enabled !== 0)
            .map((r) => r.symbol);
          activeSymbols = [...defaultActive, ...customActive];
        } else {
          activeSymbols = STOCK_SYMBOLS;
        }

        // Return cached data instantly; kick off background warming for any uncached symbols.
        // This prevents the 504 Gateway Timeout caused by blocking on 13s-per-symbol rate-limited fetches.
        warmCacheInBackground(activeSymbols, input.timeframe);
        const candleMap = fetchStockCandlesCached(activeSymbols, input.timeframe);

        // HTF regime filter: warm the higher timeframe cache in the background too
        const htfTimeframe = STOCK_HTF_MAP_TF[input.timeframe] ?? "Weekly";
        warmHTFCacheInBackground(activeSymbols, htfTimeframe);
        // Also warm SPY for relative strength calculation
        warmHTFCacheInBackground(["SPY"], input.timeframe);

        // Pattern win rates from journal history (only available when authenticated)
        const patternWinRates = ctx.user ? await getPatternWinRates(ctx.user.id) : {};

        // SPY candles for relative strength calculation
        const spyCandles = fetchHTFCandlesCached("SPY", input.timeframe);

        const setups: ScreenerSetup[] = [];
        for (const symbol of activeSymbols) {
          try {
            const candles = candleMap.get(symbol);
            // EMA Pullback needs at least 55 candles for the 50 EMA to be valid
            if (!candles || candles.length < 55) continue;

            // HTF candles for regime filter
            const htfCandles = fetchHTFCandlesCached(symbol, htfTimeframe);

            // Relative strength vs SPY over last 20 candles
            // RS = (stock % change over 20 bars) - (SPY % change over 20 bars)
            let relativeStrength: number | null = null;
            if (spyCandles && spyCandles.length >= 21 && candles.length >= 21) {
              const stockChg = (candles[candles.length - 1].close - candles[candles.length - 21].close) / candles[candles.length - 21].close;
              const spyChg = (spyCandles[spyCandles.length - 1].close - spyCandles[spyCandles.length - 21].close) / spyCandles[spyCandles.length - 21].close;
              relativeStrength = stockChg - spyChg;
            }

            const result = evaluateEmaPullback(candles, { htfCandles, patternWinRates, relativeStrength });
            if (!result.hasSetup || !result.direction || !result.quality) continue;

            // Earnings blackout filter: flag setups near earnings, downgrade quality
            const earningsDate = await fetchNextEarningsDate(symbol);
            const nearEarnings = isNearEarnings(earningsDate);
            let quality = result.quality;
            const confluences = [...result.confluences];
            if (nearEarnings && earningsDate) {
              confluences.push(`Near Earnings (${earningsDate})`);
              // Downgrade quality by one tier
              if (quality === "PREMIUM") quality = "STRONG";
              else if (quality === "STRONG") quality = "DEVELOPING";
            }

            const setupType: "CALL" | "PUT" = result.direction === "LONG" ? "CALL" : "PUT";
            setups.push({
              id: `${symbol}-${input.timeframe}-${Date.now()}`,
              symbol,
              displaySymbol: symbol,
              assetClass: "STOCK",
              setupType,
              quality,
              pattern: result.pattern,
              timeframe: input.timeframe,
              currentPrice: result.currentPrice,
              levels: {
                entry: result.entry,
                stopLoss: result.stopLoss,
                takeProfit: result.takeProfit,
                takeProfit2: result.takeProfit2,
                takeProfit3: result.takeProfit3,
              },
              rrRatio: result.rrRatio,
              confluences,
              sector: STOCK_SECTORS[symbol],
              ema20: result.ema20 ?? undefined,
              ema50: result.ema50 ?? undefined,
              earningsDate: nearEarnings ? earningsDate ?? undefined : undefined,
              scannedAt: new Date().toISOString(),
              // Final-build enhanced fields
              structureBias: result.structureBias,
              structureScore: result.structureScore,
              locationTag: result.locationTag,
              locationScore: result.locationScore,
              roomToMove: result.roomToMove,
              roomScore: result.roomScore,
              timingState: result.timingState,
              setupQuality: result.setupQuality,
              finalTradeScore: result.finalTradeScore,
              reason: result.reason,
              distanceToSupport: result.distanceToSupport,
              distanceToResistance: result.distanceToResistance,
              support20: result.support20,
              resistance20: result.resistance20,
              rsi14: result.rsi14,
              relVolume: result.relVolume,
              bestScore: result.bestScore,
              callScore: result.callScore,
              putScore: result.putScore,
            });
          } catch (err) {
            console.error(`[Stock Scan] Error evaluating ${symbol}:`, err);
          }
        }

        setups.sort((a, b) => {
          const qualityOrder = { PREMIUM: 0, STRONG: 1, DEVELOPING: 2 };
          return qualityOrder[a.quality] - qualityOrder[b.quality] || b.rrRatio - a.rrRatio;
        });

        return {
          setups,
          scannedAt: new Date().toISOString(),
          totalSymbols: activeSymbols.length,
          cachedSymbols: getCachedCount(activeSymbols, input.timeframe),
          cacheAgeMs: getCacheAge(activeSymbols, input.timeframe),
          cacheWarm: isCacheWarm(activeSymbols, input.timeframe),
        };
      }),

    // ── Price Action scan mode ─────────────────────────────────────────────────
    stocksPriceAction: publicProcedure
      .input(
        z.object({
          timeframe: z.enum(["15m", "30m", "1H", "4H", "Daily"]).default("Daily"),
        })
      )
      .query(async ({ ctx, input }) => {
        // Resolve active symbols (same logic as stocks procedure)
        let activeSymbols: string[];
        if (ctx.user) {
          const userOverrides = await getScreenerSymbols(ctx.user.id, "STOCK");
          const overrideMap = new Map(userOverrides.map((r) => [r.symbol, r]));
          const defaultActive = STOCK_SYMBOLS.filter((s) => {
            const override = overrideMap.get(s);
            return override ? override.enabled !== 0 : true;
          });
          const defaultSet = new Set(STOCK_SYMBOLS);
          const customActive = userOverrides
            .filter((r) => !defaultSet.has(r.symbol) && r.enabled !== 0)
            .map((r) => r.symbol);
          activeSymbols = [...defaultActive, ...customActive];
        } else {
          activeSymbols = STOCK_SYMBOLS;
        }

        // Same non-blocking cache-first approach as EMA Pullback mode
        warmCacheInBackground(activeSymbols, input.timeframe);
        const candleMap = fetchStockCandlesCached(activeSymbols, input.timeframe);

        const results: Array<{
          id: string;
          symbol: string;
          displaySymbol: string;
          sector?: string;
          currentPrice: number;
          dominantDirection: string;
          overallStrength: string;
          atr: number;
          avgVolume: number;
          signals: Array<{
            signalType: string;
            direction: string;
            strength: string;
            tags: string[];
            keyLevel?: number;
            rangeHigh?: number;
            rangeLow?: number;
            trendBars?: number;
            bodyRatio?: number;
            volumeRatio?: number;
          }>;
          timeframe: string;
          scannedAt: string;
        }> = [];

        for (const symbol of activeSymbols) {
          try {
            const candles = candleMap.get(symbol);
            if (!candles || candles.length < 20) continue;

            const result = evaluatePriceAction(candles);
            if (!result.hasSignal) continue;

            results.push({
              id: `${symbol}-pa-${input.timeframe}-${Date.now()}`,
              symbol,
              displaySymbol: symbol,
              sector: STOCK_SECTORS[symbol],
              currentPrice: result.currentPrice,
              dominantDirection: result.dominantDirection,
              overallStrength: result.overallStrength,
              atr: result.atr,
              avgVolume: result.avgVolume,
              signals: result.signals.map((s) => ({
                signalType: s.signalType,
                direction: s.direction,
                strength: s.strength,
                tags: s.tags,
                keyLevel: s.keyLevel,
                rangeHigh: s.rangeHigh,
                rangeLow: s.rangeLow,
                trendBars: s.trendBars,
                bodyRatio: s.bodyRatio,
                volumeRatio: s.volumeRatio,
              })),
              timeframe: input.timeframe,
              scannedAt: new Date().toISOString(),
            });
          } catch (err) {
            console.error(`[PA Scan] Error evaluating ${symbol}:`, err);
          }
        }

        // Sort: STRONG first, then by signal count
        const strengthOrder: Record<string, number> = { STRONG: 0, MODERATE: 1, WEAK: 2 };
        results.sort((a, b) =>
          (strengthOrder[a.overallStrength] ?? 2) - (strengthOrder[b.overallStrength] ?? 2) ||
          b.signals.length - a.signals.length
        );

        return {
          results,
          scannedAt: new Date().toISOString(),
          totalSymbols: activeSymbols.length,
          cachedSymbols: getCachedCount(activeSymbols, input.timeframe),
          cacheWarm: isCacheWarm(activeSymbols, input.timeframe),
        };
      }),
  }),

  // ── Price Alerts ────────────────────────────────────────────────────────────
  alerts: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getPriceAlerts(ctx.user.id);
    }),

    create: protectedProcedure
      .input(
        z.object({
          symbol: z.string(),
          displaySymbol: z.string(),
          assetClass: z.enum(["STOCK", "FOREX"]),
          direction: z.enum(["LONG", "SHORT", "CALL", "PUT"]),
          targetPrice: z.number(),
          currentPrice: z.number(),
          proximityPct: z.number().min(0.1).max(5).default(0.5),
          timeframe: z.string().default("4H"),
          pattern: z.string().optional(),
          notes: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await createPriceAlert({
          userId: ctx.user.id,
          symbol: input.symbol,
          displaySymbol: input.displaySymbol,
          assetClass: input.assetClass,
          direction: input.direction,
          targetPrice: String(input.targetPrice),
          currentPrice: String(input.currentPrice),
          proximityPct: String(input.proximityPct),
          timeframe: input.timeframe,
          pattern: input.pattern,
          notes: input.notes,
          isActive: 1,
          isTriggered: 0,
        });
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deletePriceAlert(input.id, ctx.user.id);
        return { success: true };
      }),

    toggle: protectedProcedure
      .input(z.object({ id: z.number(), isActive: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        await togglePriceAlert(input.id, ctx.user.id, input.isActive ? 1 : 0);
        return { success: true };
      }),
  }),

  // ── Analytics ────────────────────────────────────────────────────────────────
  analytics: router({
    summary: protectedProcedure.query(async ({ ctx }) => {
      const entries = await getJournalEntries(ctx.user.id);
      const total = entries.length;
      const closed = entries.filter((e) => e.outcome !== "PENDING");
      const wins = closed.filter((e) => e.outcome === "WIN").length;
      const losses = closed.filter((e) => e.outcome === "LOSS").length;
      const breakevens = closed.filter((e) => e.outcome === "BREAKEVEN").length;
      const pending = entries.filter((e) => e.outcome === "PENDING").length;
      const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;
      const totalPnl = entries.reduce((sum, e) => sum + (e.pnl ?? 0), 0);
      const avgRR = entries.length > 0 ? entries.reduce((sum, e) => sum + e.rrRatio, 0) / entries.length : 0;

      // Equity curve: cumulative PnL over time
      const equityCurve = entries
        .filter((e) => e.pnl !== null && e.pnl !== undefined)
        .sort((a, b) => new Date(a.pushedAt).getTime() - new Date(b.pushedAt).getTime())
        .reduce<{ date: string; cumPnl: number; pnl: number }[]>((acc, e) => {
          const prev = acc.length > 0 ? acc[acc.length - 1].cumPnl : 0;
          acc.push({
            date: new Date(e.pushedAt).toLocaleDateString(),
            pnl: e.pnl ?? 0,
            cumPnl: prev + (e.pnl ?? 0),
          });
          return acc;
        }, []);

      // Pattern breakdown
      const patternMap: Record<string, { wins: number; losses: number; total: number }> = {};
      for (const e of entries) {
        if (!patternMap[e.pattern]) patternMap[e.pattern] = { wins: 0, losses: 0, total: 0 };
        patternMap[e.pattern].total++;
        if (e.outcome === "WIN") patternMap[e.pattern].wins++;
        if (e.outcome === "LOSS") patternMap[e.pattern].losses++;
      }
      const patternBreakdown = Object.entries(patternMap)
        .map(([pattern, stats]) => ({
          pattern,
          ...stats,
          winRate: stats.total > 0 ? (stats.wins / stats.total) * 100 : 0,
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

      // Asset class breakdown
      const assetMap: Record<string, { wins: number; losses: number; total: number; pnl: number }> = {};
      for (const e of entries) {
        if (!assetMap[e.assetClass]) assetMap[e.assetClass] = { wins: 0, losses: 0, total: 0, pnl: 0 };
        assetMap[e.assetClass].total++;
        assetMap[e.assetClass].pnl += e.pnl ?? 0;
        if (e.outcome === "WIN") assetMap[e.assetClass].wins++;
        if (e.outcome === "LOSS") assetMap[e.assetClass].losses++;
      }
      const assetBreakdown = Object.entries(assetMap).map(([assetClass, stats]) => ({
        assetClass,
        ...stats,
        winRate: stats.total > 0 ? (stats.wins / stats.total) * 100 : 0,
      }));

      // Monthly performance
      const monthMap: Record<string, { wins: number; losses: number; total: number; pnl: number }> = {};
      for (const e of entries) {
        const month = new Date(e.pushedAt).toLocaleDateString("en-US", { year: "numeric", month: "short" });
        if (!monthMap[month]) monthMap[month] = { wins: 0, losses: 0, total: 0, pnl: 0 };
        monthMap[month].total++;
        monthMap[month].pnl += e.pnl ?? 0;
        if (e.outcome === "WIN") monthMap[month].wins++;
        if (e.outcome === "LOSS") monthMap[month].losses++;
      }
      const monthlyPerformance = Object.entries(monthMap)
        .map(([month, stats]) => ({ month, ...stats }))
        .sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime())
        .slice(-12);

      // Timeframe breakdown
      const tfMap: Record<string, { wins: number; losses: number; total: number; pnl: number; totalRR: number }> = {};
      for (const e of entries) {
        const tf = e.timeframe || "Unknown";
        if (!tfMap[tf]) tfMap[tf] = { wins: 0, losses: 0, total: 0, pnl: 0, totalRR: 0 };
        tfMap[tf].total++;
        tfMap[tf].pnl += e.pnl ?? 0;
        tfMap[tf].totalRR += e.rrRatio;
        if (e.outcome === "WIN") tfMap[tf].wins++;
        if (e.outcome === "LOSS") tfMap[tf].losses++;
      }
      const timeframeBreakdown = Object.entries(tfMap)
        .map(([timeframe, stats]) => ({
          timeframe,
          ...stats,
          winRate: stats.total > 0 ? (stats.wins / stats.total) * 100 : 0,
          avgRR: stats.total > 0 ? stats.totalRR / stats.total : 0,
        }))
        .sort((a, b) => b.total - a.total);

      // Strategy breakdown (EMA Pullback vs Supply/Demand vs other)
      const strategyMap: Record<string, { wins: number; losses: number; total: number; pnl: number; totalRR: number }> = {};
      for (const e of entries) {
        let strategy = "Other";
        if (e.pattern?.toLowerCase().includes("ema")) strategy = "EMA Pullback";
        else if (e.pattern?.toLowerCase().includes("supply") || e.pattern?.toLowerCase().includes("demand")) strategy = "Supply & Demand";
        else if (e.pattern?.toLowerCase().includes("pullback")) strategy = "EMA Pullback";
        if (!strategyMap[strategy]) strategyMap[strategy] = { wins: 0, losses: 0, total: 0, pnl: 0, totalRR: 0 };
        strategyMap[strategy].total++;
        strategyMap[strategy].pnl += e.pnl ?? 0;
        strategyMap[strategy].totalRR += e.rrRatio;
        if (e.outcome === "WIN") strategyMap[strategy].wins++;
        if (e.outcome === "LOSS") strategyMap[strategy].losses++;
      }
      const strategyBreakdown = Object.entries(strategyMap)
        .map(([strategy, stats]) => ({
          strategy,
          ...stats,
          winRate: stats.total > 0 ? (stats.wins / stats.total) * 100 : 0,
          avgRR: stats.total > 0 ? stats.totalRR / stats.total : 0,
        }))
        .sort((a, b) => b.total - a.total);

      return {
        total,
        wins,
        losses,
        breakevens,
        pending,
        winRate,
        totalPnl,
        avgRR,
        equityCurve,
        patternBreakdown,
        assetBreakdown,
        monthlyPerformance,
        timeframeBreakdown,
        strategyBreakdown,
      };
    }),
  }),

  // ── Watchlist ────────────────────────────────────────────────────────────────
  watchlist: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getWatchlist(ctx.user.id);
    }),

    create: protectedProcedure
      .input(
        z.object({
          symbol: z.string().min(1),
          displaySymbol: z.string().min(1),
          assetClass: z.enum(["STOCK", "FOREX"]),
          timeframe: z.string().default("4H"),
          notes: z.string().optional(),
          keyLevel1: z.string().optional(),
          keyLevel1Label: z.string().optional(),
          keyLevel2: z.string().optional(),
          keyLevel2Label: z.string().optional(),
          keyLevel3: z.string().optional(),
          keyLevel3Label: z.string().optional(),
          bias: z.enum(["BULLISH", "BEARISH", "NEUTRAL"]).default("NEUTRAL"),
          tags: z.array(z.string()).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Duplicate guard: check if same symbol+timeframe already exists
        const existing = await findWatchlistDuplicate(ctx.user.id, input.symbol, input.timeframe);
        if (existing) {
          return {
            success: false,
            duplicate: true,
            existingId: existing.id,
            message: `${input.displaySymbol} (${input.timeframe}) is already on your watchlist`,
          };
        }
        await createWatchlistItem({
          userId: ctx.user.id,
          symbol: input.symbol,
          displaySymbol: input.displaySymbol,
          assetClass: input.assetClass,
          timeframe: input.timeframe,
          notes: input.notes,
          keyLevel1: input.keyLevel1,
          keyLevel1Label: input.keyLevel1Label,
          keyLevel2: input.keyLevel2,
          keyLevel2Label: input.keyLevel2Label,
          keyLevel3: input.keyLevel3,
          keyLevel3Label: input.keyLevel3Label,
          bias: input.bias,
          tags: input.tags ? JSON.stringify(input.tags) : null,
        });
        return { success: true, duplicate: false };
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          notes: z.string().optional(),
          keyLevel1: z.string().optional().nullable(),
          keyLevel1Label: z.string().optional().nullable(),
          keyLevel2: z.string().optional().nullable(),
          keyLevel2Label: z.string().optional().nullable(),
          keyLevel3: z.string().optional().nullable(),
          keyLevel3Label: z.string().optional().nullable(),
          bias: z.enum(["BULLISH", "BEARISH", "NEUTRAL"]).optional(),
          timeframe: z.string().optional(),
          tags: z.array(z.string()).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, tags, ...rest } = input;
        await updateWatchlistItem(id, ctx.user.id, {
          ...rest,
          ...(tags !== undefined ? { tags: JSON.stringify(tags) } : {}),
        });
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteWatchlistItem(input.id, ctx.user.id);
        return { success: true };
      }),
  }),

  // ── Journal ─────────────────────────────────────────────────────────────────
  journal: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getJournalEntries(ctx.user.id);
    }),

    pushedIds: protectedProcedure.query(async ({ ctx }) => {
      return getJournalEntrySetupIds(ctx.user.id);
    }),

    create: protectedProcedure
      .input(CreateJournalEntryInput)
      .mutation(async ({ ctx, input }) => {
        await createJournalEntry({
          userId: ctx.user.id,
          setupId: input.setupId,
          symbol: input.symbol,
          assetClass: input.assetClass,
          setupType: input.setupType,
          quality: input.quality,
          pattern: input.pattern,
          timeframe: input.timeframe,
          levels: input.levels,
          rrRatio: input.rrRatio,
          confluences: input.confluences,
          notes: input.notes ?? "",
          tags: input.tags,
          sector: input.sector,
          ivRank: input.ivRank,
          session: input.session,
          outcome: "PENDING",
        });
        return { success: true };
      }),

    update: protectedProcedure
      .input(UpdateJournalEntryInput)
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        await updateJournalEntry(id, ctx.user.id, data);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteJournalEntry(input.id, ctx.user.id);
        return { success: true };
      }),

    /**
     * Get a map of setupId → outcome for the current user.
     * Used by the screener to show current outcome state on setup cards.
     */
    outcomes: protectedProcedure.query(async ({ ctx }) => {
      return getOutcomesByUser(ctx.user.id);
    }),

    /**
     * Mark the outcome of a setup directly from the screener.
     * If a journal entry already exists for this setupId, updates its outcome.
     * If not, creates a minimal journal entry with the given outcome.
     * Passing outcome = "PENDING" clears the outcome (toggles back).
     */
    markOutcome: protectedProcedure
      .input(z.object({
        setupId: z.string(),
        outcome: z.enum(["WIN", "LOSS", "BREAKEVEN", "PENDING"]),
        // Setup details needed to create the entry if it doesn't exist yet
        symbol: z.string(),
        assetClass: z.enum(["STOCK", "FOREX"]),
        setupType: z.enum(["CALL", "PUT", "LONG", "SHORT"]),
        quality: z.enum(["PREMIUM", "STRONG", "DEVELOPING"]),
        pattern: z.string(),
        timeframe: z.string(),
        levels: LevelsSchema,
        rrRatio: z.number(),
        confluences: z.array(z.string()),
        sector: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const existing = await getJournalEntryBySetupId(ctx.user.id, input.setupId);
        if (existing) {
          // Update the outcome on the existing entry
          await updateJournalEntry(existing.id, ctx.user.id, { outcome: input.outcome });
        } else {
          // Auto-create a minimal journal entry with the outcome
          await createJournalEntry({
            userId: ctx.user.id,
            setupId: input.setupId,
            symbol: input.symbol,
            assetClass: input.assetClass,
            setupType: input.setupType,
            quality: input.quality,
            pattern: input.pattern,
            timeframe: input.timeframe,
            levels: input.levels,
            rrRatio: input.rrRatio,
            confluences: input.confluences,
            notes: "",
            tags: [input.setupType.toLowerCase(), input.quality.toLowerCase()],
            sector: input.sector,
            outcome: input.outcome,
          });
        }
        return { success: true, outcome: input.outcome };
      }),
  }),

  // ─── Screener Symbols Router ──────────────────────────────────────────────────
  symbols: router({
    list: protectedProcedure
      .input(z.object({ assetClass: z.enum(["stock", "forex"]) }))
      .query(async ({ ctx, input }) => {
        const assetClassUpper = input.assetClass === "forex" ? "FOREX" : "STOCK";
        const custom = await getScreenerSymbols(ctx.user.id, assetClassUpper);
        // Merge defaults with user custom list
        const defaults =
          input.assetClass === "forex"
            ? FOREX_PAIRS.map((symbol) => ({
                symbol,
                label: FOREX_PAIR_LABELS[symbol] ?? symbol,
                enabled: 1,
                isDefault: true,
                id: null as number | null,
              }))
            : STOCK_SYMBOLS.map((symbol) => ({
                symbol,
                label: symbol,
                enabled: 1,
                isDefault: true,
                id: null as number | null,
              }));
        // Apply user overrides
        const userMap = new Map(custom.map((c) => [c.symbol, c]));
        const merged = defaults.map((d) => {
          const override = userMap.get(d.symbol);
          if (override) {
            return { ...d, enabled: override.enabled, isDefault: true, id: override.id };
          }
          return { ...d };
        });
        // Add user custom (non-default) symbols
        const defaultSymbols = new Set(defaults.map((d) => d.symbol));
        const customOnly = custom.filter((c) => !defaultSymbols.has(c.symbol));
        const customMapped = customOnly.map((c) => ({
          symbol: c.symbol,
          label: c.displaySymbol ?? c.symbol,
          enabled: c.enabled,
          isDefault: false,
          id: c.id as number | null,
        }));
        return [...merged, ...customMapped];
      }),

    add: protectedProcedure
      .input(
        z.object({
          assetClass: z.enum(["stock", "forex"]),
          symbol: z.string().min(1).max(20),
          label: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const symbolUpper = input.symbol.toUpperCase();
        const assetClassUpper = input.assetClass === "forex" ? "FOREX" : "STOCK";
        const dup = await findScreenerSymbolDuplicate(
          ctx.user.id,
          symbolUpper,
          assetClassUpper
        );
        if (dup) {
          return { success: false, duplicate: true, message: `${symbolUpper} is already in your ${input.assetClass} screener` };
        }
        await addScreenerSymbol({
          userId: ctx.user.id,
          assetClass: assetClassUpper,
          symbol: symbolUpper,
          displaySymbol: input.label ?? symbolUpper,
          enabled: 1,
        });
        return { success: true, duplicate: false };
      }),

    remove: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await removeScreenerSymbol(input.id, ctx.user.id);
        return { success: true };
      }),

    toggle: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          enabled: z.boolean(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await toggleScreenerSymbol(
          input.id,
          ctx.user.id,
          input.enabled ? 1 : 0
        );
        return { success: true };
      }),

    // Create a DB override row for a default symbol so it can be disabled
    toggleDefault: protectedProcedure
      .input(
        z.object({
          assetClass: z.enum(["stock", "forex"]),
          symbol: z.string().min(1).max(20),
          enabled: z.boolean(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const symbolUpper = input.symbol.toUpperCase();
        const assetClassUpper = input.assetClass === "forex" ? "FOREX" : "STOCK";
        // Check if a row already exists
        const existing = await findScreenerSymbolDuplicate(ctx.user.id, symbolUpper, assetClassUpper);
        if (existing) {
          // Update the existing row
          await toggleScreenerSymbol(existing.id, ctx.user.id, input.enabled ? 1 : 0);
        } else {
          // Create a new override row with the desired enabled state
          await addScreenerSymbol({
            userId: ctx.user.id,
            assetClass: assetClassUpper,
            symbol: symbolUpper,
            displaySymbol: symbolUpper,
            enabled: input.enabled ? 1 : 0,
          });
        }
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
