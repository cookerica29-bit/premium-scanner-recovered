/**
 * Stock OHLCV Data Fetcher
 * Uses Yahoo Finance v8 chart API directly (no API key required)
 * Implements batching + retry + dual-host fallback to avoid rate limiting
 */

import type { Candle } from "./analysis/supplyDemand";

export const STOCK_SYMBOLS = [
  "SPY",  // Broad market ETF (regime anchor)
  "QQQ",  // Tech ETF (regime anchor)
  "AAPL", // Mega-cap tech
  "NVDA", // High-beta tech (options favourite)
  "TSLA", // High-beta consumer (options favourite)
];

export const STOCK_SECTORS: Record<string, string> = {
  SPY: "ETF",
  QQQ: "ETF",
  AAPL: "Technology",
  NVDA: "Technology",
  TSLA: "Consumer Discretionary",
};

// Yahoo Finance interval → range mapping for ~150-200 candles
const INTERVAL_RANGE: Record<string, { interval: string; range: string }> = {
  "15m": { interval: "15m", range: "5d" },
  "30m": { interval: "30m", range: "1mo" },
  "1H":  { interval: "60m", range: "1mo" },
  "4H":  { interval: "60m", range: "3mo" },
  "Daily": { interval: "1d", range: "1y" },
};

// Rotate between Yahoo Finance hosts to avoid rate limits
const YAHOO_HOSTS = [
  "https://query1.finance.yahoo.com",
  "https://query2.finance.yahoo.com",
];

let hostIndex = 0;
function getNextHost(): string {
  const host = YAHOO_HOSTS[hostIndex % YAHOO_HOSTS.length];
  hostIndex++;
  return host;
}

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface YahooChartResult {
  timestamp: number[];
  indicators: {
    quote: Array<{
      open: (number | null)[];
      high: (number | null)[];
      low: (number | null)[];
      close: (number | null)[];
      volume: (number | null)[];
    }>;
  };
}

async function fetchWithRetry(symbol: string, interval: string, range: string, attempt = 0): Promise<YahooChartResult> {
  const host = getNextHost();
  const url = `${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
    });

    if (res.status === 429 && attempt < 2) {
      // Rate limited — wait and retry with the other host
      await new Promise((r) => setTimeout(r, 1500 + attempt * 1000));
      return fetchWithRetry(symbol, interval, range, attempt + 1);
    }

    if (!res.ok) {
      throw new Error(`Yahoo Finance error for ${symbol}: ${res.status} ${res.statusText}`);
    }

    const data = await res.json() as {
      chart?: {
        result?: YahooChartResult[];
        error?: { code: string; description: string };
      };
    };

    if (data.chart?.error) {
      throw new Error(`Yahoo Finance error for ${symbol}: ${data.chart.error.description}`);
    }

    const result = data.chart?.result?.[0];
    if (!result) throw new Error(`No data returned for ${symbol}`);
    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchStockCandles(
  symbol: string,
  timeframe: string = "Daily"
): Promise<Candle[]> {
  const { interval, range } = INTERVAL_RANGE[timeframe] ?? INTERVAL_RANGE["Daily"];
  const result = await fetchWithRetry(symbol, interval, range);

  const timestamps = result.timestamp;
  const quote = result.indicators.quote[0];

  const candles: Candle[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const o = quote.open[i];
    const h = quote.high[i];
    const l = quote.low[i];
    const c = quote.close[i];
    const v = quote.volume[i];
    if (o == null || h == null || l == null || c == null) continue;
    candles.push({
      time: new Date(timestamps[i] * 1000).toISOString(),
      open: o,
      high: h,
      low: l,
      close: c,
      volume: v ?? 0,
    });
  }

  return candles;
}

/**
 * Fetch multiple symbols in batches to avoid rate limiting.
 * Processes BATCH_SIZE symbols at a time with a delay between batches.
 */
export async function fetchStockCandlesBatch(
  symbols: string[],
  timeframe: string,
  batchSize = 5,
  delayMs = 300
): Promise<Map<string, Candle[]>> {
  const results = new Map<string, Candle[]>();

  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(async (sym) => ({ sym, candles: await fetchStockCandles(sym, timeframe) }))
    );
    for (const r of batchResults) {
      if (r.status === "fulfilled") {
        results.set(r.value.sym, r.value.candles);
      }
    }
    // Delay between batches (skip delay after last batch)
    if (i + batchSize < symbols.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return results;
}

// HTF mapping for stocks
export const STOCK_HTF_MAP: Record<string, string> = {
  "15m": "1H",
  "30m": "1H",
  "1H": "4H",
  "4H": "Daily",
  "Daily": "Daily",
};
