// ============================================================
// FOREX SCREENER ENGINE
// Generates premium setups with minimum 2:1 RR
// Design: Dark Terminal / Bloomberg-Inspired
// ============================================================

import { nanoid } from "nanoid";
import type { Setup, SetupQuality, PriceLevel } from "./types";

const FOREX_PAIRS = [
  { symbol: "EUR/USD", basePrice: 1.0842, pipSize: 0.0001, session: "London/NY" },
  { symbol: "GBP/USD", basePrice: 1.2654, pipSize: 0.0001, session: "London" },
  { symbol: "USD/JPY", basePrice: 149.85, pipSize: 0.01, session: "Tokyo/London" },
  { symbol: "AUD/USD", basePrice: 0.6521, pipSize: 0.0001, session: "Sydney/Tokyo" },
  { symbol: "USD/CAD", basePrice: 1.3642, pipSize: 0.0001, session: "NY" },
  { symbol: "NZD/USD", basePrice: 0.5987, pipSize: 0.0001, session: "Sydney" },
  { symbol: "USD/CHF", basePrice: 0.8965, pipSize: 0.0001, session: "London/NY" },
  { symbol: "EUR/GBP", basePrice: 0.8568, pipSize: 0.0001, session: "London" },
  { symbol: "EUR/JPY", basePrice: 162.45, pipSize: 0.01, session: "London/Tokyo" },
  { symbol: "GBP/JPY", basePrice: 189.72, pipSize: 0.01, session: "London/Tokyo" },
  { symbol: "AUD/JPY", basePrice: 97.65, pipSize: 0.01, session: "Tokyo/Sydney" },
  { symbol: "EUR/AUD", basePrice: 1.6624, pipSize: 0.0001, session: "London/Sydney" },
  { symbol: "GBP/AUD", basePrice: 1.9412, pipSize: 0.0001, session: "London" },
  { symbol: "USD/MXN", basePrice: 17.245, pipSize: 0.0001, session: "NY" },
  { symbol: "EUR/CAD", basePrice: 1.4785, pipSize: 0.0001, session: "London/NY" },
  { symbol: "GBP/CAD", basePrice: 1.7243, pipSize: 0.0001, session: "London/NY" },
  { symbol: "XAU/USD", basePrice: 2345.5, pipSize: 0.01, session: "24H" },
  { symbol: "XAG/USD", basePrice: 27.85, pipSize: 0.001, session: "24H" },
];

const LONG_PATTERNS = [
  "Bullish Order Block",
  "Fair Value Gap (Bullish)",
  "Breaker Block Long",
  "Liquidity Sweep + Reversal",
  "Demand Zone Bounce",
  "Bullish Engulfing",
  "Morning Star",
  "Pin Bar at Support",
  "Inside Bar Breakout",
  "Ascending Channel",
  "Bull Flag",
  "Inverse Head & Shoulders",
  "Double Bottom",
  "EMA 50 Bounce",
  "Fibonacci 61.8% Retracement",
  "Displacement + FVG",
  "CHOCH (Change of Character)",
  "BOS + Pullback",
];

const SHORT_PATTERNS = [
  "Bearish Order Block",
  "Fair Value Gap (Bearish)",
  "Breaker Block Short",
  "Liquidity Grab + Reversal",
  "Supply Zone Rejection",
  "Bearish Engulfing",
  "Evening Star",
  "Pin Bar at Resistance",
  "Inside Bar Breakdown",
  "Descending Channel",
  "Bear Flag",
  "Head & Shoulders",
  "Double Top",
  "EMA 50 Rejection",
  "Fibonacci 61.8% Resistance",
  "Displacement + FVG Short",
  "CHOCH Bearish",
  "BOS + Pullback Short",
];

const LONG_CONFLUENCES = [
  "HTF bullish bias (Daily/Weekly)",
  "Price at major support",
  "London session open momentum",
  "NY session continuation",
  "DXY bearish correlation",
  "RSI bullish divergence",
  "MACD bullish crossover",
  "Volume spike on entry",
  "Institutional order flow bullish",
  "Fibonacci confluence zone",
  "Previous day high reclaim",
  "Asian session range breakout",
  "SMC: Liquidity taken below",
  "ICT Power of 3 accumulation",
  "Clean structure break",
];

const SHORT_CONFLUENCES = [
  "HTF bearish bias (Daily/Weekly)",
  "Price at major resistance",
  "London session reversal",
  "NY session distribution",
  "DXY bullish correlation",
  "RSI bearish divergence",
  "MACD bearish crossover",
  "Volume spike on rejection",
  "Institutional order flow bearish",
  "Fibonacci resistance zone",
  "Previous day low breakdown",
  "Asian session range breakdown",
  "SMC: Liquidity taken above",
  "ICT Power of 3 distribution",
  "Clean structure break down",
];

const SESSIONS = ["London", "New York", "Tokyo", "Sydney", "London/NY Overlap", "Asian Killzone"];
const TIMEFRAMES = ["5m", "15m", "1H", "4H", "Daily"];

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
  if (rrRatio >= 3.5 && confluenceCount >= 4) return "PREMIUM";
  if (rrRatio >= 2.5 && confluenceCount >= 3) return "STRONG";
  return "DEVELOPING";
}

function generateLongLevels(
  basePrice: number,
  pipSize: number
): { levels: PriceLevel; rr: number; rr2: number; rr3: number } {
  const pips = Math.floor(randomBetween(15, 60));
  const risk = pips * pipSize;
  const entry = parseFloat((basePrice * (1 + randomBetween(-0.002, 0.002))).toFixed(basePrice > 10 ? 2 : 4));
  const stopLoss = parseFloat((entry - risk).toFixed(basePrice > 10 ? 2 : 4));
  const rr = parseFloat(randomBetween(2.0, 5.0).toFixed(2));
  const rr2 = parseFloat((rr + randomBetween(1.0, 2.0)).toFixed(2));
  const rr3 = parseFloat((rr2 + randomBetween(1.5, 3.0)).toFixed(2));

  return {
    levels: {
      entry,
      stopLoss,
      takeProfit: parseFloat((entry + risk * rr).toFixed(basePrice > 10 ? 2 : 4)),
      takeProfit2: parseFloat((entry + risk * rr2).toFixed(basePrice > 10 ? 2 : 4)),
      takeProfit3: parseFloat((entry + risk * rr3).toFixed(basePrice > 10 ? 2 : 4)),
    },
    rr,
    rr2,
    rr3,
  };
}

function generateShortLevels(
  basePrice: number,
  pipSize: number
): { levels: PriceLevel; rr: number; rr2: number; rr3: number } {
  const pips = Math.floor(randomBetween(15, 60));
  const risk = pips * pipSize;
  const entry = parseFloat((basePrice * (1 + randomBetween(-0.002, 0.002))).toFixed(basePrice > 10 ? 2 : 4));
  const stopLoss = parseFloat((entry + risk).toFixed(basePrice > 10 ? 2 : 4));
  const rr = parseFloat(randomBetween(2.0, 5.0).toFixed(2));
  const rr2 = parseFloat((rr + randomBetween(1.0, 2.0)).toFixed(2));
  const rr3 = parseFloat((rr2 + randomBetween(1.5, 3.0)).toFixed(2));

  return {
    levels: {
      entry,
      stopLoss,
      takeProfit: parseFloat((entry - risk * rr).toFixed(basePrice > 10 ? 2 : 4)),
      takeProfit2: parseFloat((entry - risk * rr2).toFixed(basePrice > 10 ? 2 : 4)),
      takeProfit3: parseFloat((entry - risk * rr3).toFixed(basePrice > 10 ? 2 : 4)),
    },
    rr,
    rr2,
    rr3,
  };
}

export function generateForexSetups(count: number = 18): Setup[] {
  const setups: Setup[] = [];

  for (let i = 0; i < count; i++) {
    const pairInfo = pickRandom(FOREX_PAIRS);
    const isLong = Math.random() > 0.45;
    const setupType = isLong ? "LONG" : "SHORT";
    const pattern = isLong ? pickRandom(LONG_PATTERNS) : pickRandom(SHORT_PATTERNS);
    const confluences = pickRandomN(
      isLong ? LONG_CONFLUENCES : SHORT_CONFLUENCES,
      Math.floor(randomBetween(2, 6))
    );
    const timeframe = pickRandom(TIMEFRAMES);

    const priceVariation = pairInfo.basePrice * randomBetween(-0.01, 0.01);
    const currentPrice = pairInfo.basePrice + priceVariation;

    const { levels, rr, rr2, rr3 } = isLong
      ? generateLongLevels(currentPrice, pairInfo.pipSize)
      : generateShortLevels(currentPrice, pairInfo.pipSize);

    const quality = determineQuality(rr, confluences.length);
    const session = pickRandom(SESSIONS);
    const minutesAgo = Math.floor(randomBetween(1, 180));
    const scannedAt = new Date(Date.now() - minutesAgo * 60 * 1000);

    setups.push({
      id: nanoid(),
      symbol: pairInfo.symbol,
      assetClass: "FOREX",
      setupType,
      quality,
      status: "ACTIVE",
      timeframe,
      pattern,
      description: `${quality} ${setupType} setup on ${pairInfo.symbol} — ${pattern} on the ${timeframe} with ${confluences.length} confluences. Min 2:1 RR confirmed.`,
      levels,
      rrRatio: rr,
      rrRatio2: rr2,
      rrRatio3: rr3,
      confluences,
      scannedAt,
      pushedToJournal: false,
      session,
      pipValue: pairInfo.pipSize,
    });
  }

  return setups.sort((a, b) => {
    const order = { PREMIUM: 0, STRONG: 1, DEVELOPING: 2 };
    return order[a.quality] - order[b.quality];
  });
}

export function rescanForexSetups(): Setup[] {
  return generateForexSetups(Math.floor(randomBetween(12, 22)));
}
