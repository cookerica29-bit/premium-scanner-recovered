// ============================================================
// STOCK SCREENER ENGINE
// Generates premium call/put setups with entry, SL, TP levels
// Design: Dark Terminal / Bloomberg-Inspired
// ============================================================

import { nanoid } from "nanoid";
import type { Setup, SetupQuality, PriceLevel } from "./types";

const STOCK_SYMBOLS = [
  { symbol: "AAPL", sector: "Technology", marketCap: "3.1T", basePrice: 189.5 },
  { symbol: "NVDA", sector: "Technology", marketCap: "2.8T", basePrice: 875.2 },
  { symbol: "TSLA", sector: "Consumer Discretionary", marketCap: "580B", basePrice: 182.3 },
  { symbol: "MSFT", sector: "Technology", marketCap: "3.0T", basePrice: 415.8 },
  { symbol: "AMZN", sector: "Consumer Discretionary", marketCap: "1.9T", basePrice: 178.6 },
  { symbol: "META", sector: "Communication Services", marketCap: "1.4T", basePrice: 548.9 },
  { symbol: "GOOGL", sector: "Communication Services", marketCap: "2.1T", basePrice: 168.4 },
  { symbol: "SPY", sector: "ETF", marketCap: "ETF", basePrice: 521.3 },
  { symbol: "QQQ", sector: "ETF", marketCap: "ETF", basePrice: 445.7 },
  { symbol: "AMD", sector: "Technology", marketCap: "245B", basePrice: 148.9 },
  { symbol: "NFLX", sector: "Communication Services", marketCap: "285B", basePrice: 655.2 },
  { symbol: "JPM", sector: "Financials", marketCap: "590B", basePrice: 198.4 },
  { symbol: "GS", sector: "Financials", marketCap: "165B", basePrice: 512.6 },
  { symbol: "BA", sector: "Industrials", marketCap: "108B", basePrice: 171.3 },
  { symbol: "COIN", sector: "Financials", marketCap: "52B", basePrice: 218.7 },
  { symbol: "PLTR", sector: "Technology", marketCap: "58B", basePrice: 25.4 },
  { symbol: "SOFI", sector: "Financials", marketCap: "8B", basePrice: 7.82 },
  { symbol: "MSTR", sector: "Technology", marketCap: "32B", basePrice: 1425.0 },
  { symbol: "IWM", sector: "ETF", marketCap: "ETF", basePrice: 198.6 },
  { symbol: "XLF", sector: "ETF", marketCap: "ETF", basePrice: 42.3 },
];

const CALL_PATTERNS = [
  "Bull Flag Breakout",
  "Ascending Triangle",
  "Cup & Handle",
  "Golden Cross",
  "Demand Zone Bounce",
  "Bullish Engulfing",
  "Morning Star",
  "Double Bottom",
  "Higher Low Structure",
  "VWAP Reclaim",
  "EMA 21 Bounce",
  "Consolidation Breakout",
  "Hammer at Support",
  "Bullish Divergence RSI",
  "Order Block Bounce",
];

const PUT_PATTERNS = [
  "Bear Flag Breakdown",
  "Descending Triangle",
  "Head & Shoulders",
  "Death Cross",
  "Supply Zone Rejection",
  "Bearish Engulfing",
  "Evening Star",
  "Double Top",
  "Lower High Structure",
  "VWAP Rejection",
  "EMA 21 Rejection",
  "Distribution Breakdown",
  "Shooting Star at Resistance",
  "Bearish Divergence RSI",
  "Fair Value Gap Fill",
];

const CALL_CONFLUENCES = [
  "Above 200 EMA",
  "RSI > 50 with momentum",
  "High volume on breakout",
  "IV Rank < 30 (cheap options)",
  "Earnings catalyst upcoming",
  "Sector rotation bullish",
  "Market structure bullish",
  "MACD bullish crossover",
  "Stochastic oversold bounce",
  "Key support holding",
  "Institutional accumulation",
  "Options flow: unusual calls",
];

const PUT_CONFLUENCES = [
  "Below 200 EMA",
  "RSI < 50 with weakness",
  "High volume on breakdown",
  "IV Rank < 30 (cheap options)",
  "Earnings risk elevated",
  "Sector rotation bearish",
  "Market structure bearish",
  "MACD bearish crossover",
  "Stochastic overbought rejection",
  "Key resistance holding",
  "Institutional distribution",
  "Options flow: unusual puts",
];

const TIMEFRAMES = ["5m", "15m", "1H", "4H", "Daily", "Weekly"];

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickRandomN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function determineQuality(rrRatio: number, confluenceCount: number): SetupQuality {
  if (rrRatio >= 3.0 && confluenceCount >= 4) return "PREMIUM";
  if (rrRatio >= 2.0 && confluenceCount >= 3) return "STRONG";
  return "DEVELOPING";
}

function generateCallLevels(basePrice: number): { levels: PriceLevel; rr: number; rr2: number; rr3: number } {
  const volatility = basePrice * randomBetween(0.005, 0.025);
  const entry = basePrice * (1 + randomBetween(-0.005, 0.01));
  const stopLoss = entry - volatility * randomBetween(0.8, 1.5);
  const risk = entry - stopLoss;
  const rr = randomBetween(2.0, 4.5);
  const rr2 = rr + randomBetween(1.0, 2.0);
  const rr3 = rr2 + randomBetween(1.0, 2.5);

  return {
    levels: {
      entry: parseFloat(entry.toFixed(2)),
      stopLoss: parseFloat(stopLoss.toFixed(2)),
      takeProfit: parseFloat((entry + risk * rr).toFixed(2)),
      takeProfit2: parseFloat((entry + risk * rr2).toFixed(2)),
      takeProfit3: parseFloat((entry + risk * rr3).toFixed(2)),
    },
    rr: parseFloat(rr.toFixed(2)),
    rr2: parseFloat(rr2.toFixed(2)),
    rr3: parseFloat(rr3.toFixed(2)),
  };
}

function generatePutLevels(basePrice: number): { levels: PriceLevel; rr: number; rr2: number; rr3: number } {
  const volatility = basePrice * randomBetween(0.005, 0.025);
  const entry = basePrice * (1 + randomBetween(-0.01, 0.005));
  const stopLoss = entry + volatility * randomBetween(0.8, 1.5);
  const risk = stopLoss - entry;
  const rr = randomBetween(2.0, 4.5);
  const rr2 = rr + randomBetween(1.0, 2.0);
  const rr3 = rr2 + randomBetween(1.0, 2.5);

  return {
    levels: {
      entry: parseFloat(entry.toFixed(2)),
      stopLoss: parseFloat(stopLoss.toFixed(2)),
      takeProfit: parseFloat((entry - risk * rr).toFixed(2)),
      takeProfit2: parseFloat((entry - risk * rr2).toFixed(2)),
      takeProfit3: parseFloat((entry - risk * rr3).toFixed(2)),
    },
    rr: parseFloat(rr.toFixed(2)),
    rr2: parseFloat(rr2.toFixed(2)),
    rr3: parseFloat(rr3.toFixed(2)),
  };
}

export function generateStockSetups(count: number = 20): Setup[] {
  const setups: Setup[] = [];
  const usedSymbols = new Set<string>();

  for (let i = 0; i < count; i++) {
    const stockInfo = pickRandom(STOCK_SYMBOLS);
    const isCall = Math.random() > 0.45;
    const setupType = isCall ? "CALL" : "PUT";
    const pattern = isCall ? pickRandom(CALL_PATTERNS) : pickRandom(PUT_PATTERNS);
    const confluences = pickRandomN(isCall ? CALL_CONFLUENCES : PUT_CONFLUENCES, Math.floor(randomBetween(2, 5)));
    const timeframe = pickRandom(TIMEFRAMES);

    const priceVariation = stockInfo.basePrice * randomBetween(-0.05, 0.05);
    const currentPrice = stockInfo.basePrice + priceVariation;

    const { levels, rr, rr2, rr3 } = isCall
      ? generateCallLevels(currentPrice)
      : generatePutLevels(currentPrice);

    const quality = determineQuality(rr, confluences.length);
    const volume = Math.floor(randomBetween(500000, 50000000));
    const avgVolume = Math.floor(randomBetween(1000000, 30000000));
    const ivRank = Math.floor(randomBetween(10, 85));

    const minutesAgo = Math.floor(randomBetween(1, 120));
    const scannedAt = new Date(Date.now() - minutesAgo * 60 * 1000);

    setups.push({
      id: nanoid(),
      symbol: stockInfo.symbol,
      assetClass: "STOCK",
      setupType,
      quality,
      status: "ACTIVE",
      timeframe,
      pattern,
      description: `${quality} ${setupType} setup on ${stockInfo.symbol} — ${pattern} forming on the ${timeframe} chart with ${confluences.length} confluences.`,
      levels,
      rrRatio: rr,
      rrRatio2: rr2,
      rrRatio3: rr3,
      confluences,
      scannedAt,
      pushedToJournal: false,
      sector: stockInfo.sector,
      marketCap: stockInfo.marketCap,
      volume,
      avgVolume,
      ivRank,
    });
  }

  // Sort: PREMIUM first, then STRONG, then DEVELOPING
  return setups.sort((a, b) => {
    const order = { PREMIUM: 0, STRONG: 1, DEVELOPING: 2 };
    return order[a.quality] - order[b.quality];
  });
}

export function rescanStockSetups(): Setup[] {
  return generateStockSetups(Math.floor(randomBetween(15, 25)));
}
