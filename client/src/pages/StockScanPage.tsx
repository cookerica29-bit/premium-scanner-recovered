// ============================================================
// STOCK SCAN PAGE — Twelve Data Call/Put Scanner + Tradier Option Chain
// Design: Dark Terminal / Bloomberg-Inspired Data Dashboard
// ============================================================

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Search,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
  BarChart3,
  Activity,
  BookOpen,
  Layers,
  Lock,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ── Types ────────────────────────────────────────────────────
interface StockResult {
  ticker: string;
  exchange: string;
  price: number;
  percentChange: number;
  trend: "bullish" | "bearish" | "neutral";
  emaStack: "bullish" | "bearish" | "mixed";
  rsi: number;
  relVolume: number;
  distanceToSupport: number;
  distanceToResistance: number;
  support20: number;
  resistance20: number;
  pullbackQuality: number;
  callScore: number;
  putScore: number;
  bestScore: number;
  bias: "Calls" | "Puts" | "Neutral";
  setupType: string;
}

interface OptionContract {
  ticker: string;
  expiration: string;
  contractType: "call" | "put";
  strike: number;
  bid: number;
  ask: number;
  spreadPct: number;
  volume: number;
  openInterest: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  iv: number;
  contractScore: number;
}

// Journal push setup shape (matches App.tsx ScreenerSetup)
interface JournalSetup {
  id: string;
  symbol: string;
  displaySymbol: string;
  assetClass: "STOCK" | "FOREX";
  setupType: "CALL" | "PUT" | "LONG" | "SHORT";
  quality: "PREMIUM" | "STRONG" | "DEVELOPING";
  pattern: string;
  timeframe: string;
  currentPrice: number;
  levels: { entry: number; stopLoss: number; takeProfit: number };
  rrRatio: number;
  confluences: string[];
  sector?: string;
  scannedAt: string;
}

interface StockScanPageProps {
  onPushToJournal?: (setup: JournalSetup) => void;
  pushedIds?: Set<string>;
  autoPush?: boolean;
}

// ── Score bar ────────────────────────────────────────────────
function ScoreBar({ score, color }: { score: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="text-xs font-mono w-7 text-right">{score}</span>
    </div>
  );
}

// ── Setup type badge ─────────────────────────────────────────
function SetupBadge({ type }: { type: string }) {
  const isCall = type.toLowerCase().includes("call");
  const isPut = type.toLowerCase().includes("put");
  const isWait = type.toLowerCase().includes("wait");

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wide",
        isCall && "bg-[#00FF88]/10 border-[#00FF88]/30 text-[#00FF88]",
        isPut && "bg-[#FF3B5C]/10 border-[#FF3B5C]/30 text-[#FF3B5C]",
        isWait && "bg-slate-800 border-slate-700 text-slate-500",
        !isCall && !isPut && !isWait && "bg-[#F5A623]/10 border-[#F5A623]/30 text-[#F5A623]"
      )}
    >
      {isCall && <TrendingUp className="w-2.5 h-2.5" />}
      {isPut && <TrendingDown className="w-2.5 h-2.5" />}
      {type}
    </span>
  );
}

// ── Contract score colour ─────────────────────────────────────
function scoreClass(score: number): string {
  if (score >= 70) return "text-[#00FF88] font-bold font-mono";
  if (score >= 50) return "text-[#F5A623] font-bold font-mono";
  return "text-slate-400 font-mono";
}

// ── Option chain panel ────────────────────────────────────────
function OptionChainPanel({ ticker, defaultSide }: { ticker: string; defaultSide: "calls" | "puts" }) {
  const [side, setSide] = useState<"calls" | "puts">(defaultSide);
  const [minVolume, setMinVolume] = useState(100);
  const [minOI, setMinOI] = useState(250);
  const [maxSpread, setMaxSpread] = useState(8);
  const [minDelta, setMinDelta] = useState(0.25);
  const [maxDelta, setMaxDelta] = useState(0.65);
  const [expirations, setExpirations] = useState(3);
  const [enabled, setEnabled] = useState(false);

  const { data, isFetching, error, refetch } = trpc.stockScan.optionChain.useQuery(
    { symbol: ticker, side, minVolume, minOpenInterest: minOI, maxSpreadPct: maxSpread, minDeltaAbs: minDelta, maxDeltaAbs: maxDelta, expirationCount: expirations },
    { enabled, staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false }
  );

  const handleLoad = () => {
    if (!enabled) {
      setEnabled(true);
    } else {
      refetch();
    }
  };

  const notConfigured = data && "configured" in data && !data.configured;
  const chainData = data && "configured" in data && data.configured ? data : null;

  return (
    <div className="border-t border-slate-800/60 pt-3 space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <Layers className="w-3.5 h-3.5 text-[#60A5FA]" />
        <span className="text-[10px] font-mono text-[#60A5FA] uppercase tracking-widest">Option Chain</span>
      </div>

      {/* Filters row */}
      <div className="grid grid-cols-2 gap-2">
        {/* Side toggle */}
        <div className="col-span-2 flex gap-1.5">
          {(["calls", "puts"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              className={cn(
                "flex-1 py-1 text-xs rounded border transition-all font-medium capitalize",
                side === s
                  ? s === "calls"
                    ? "bg-[#00FF88]/10 border-[#00FF88]/30 text-[#00FF88]"
                    : "bg-[#FF3B5C]/10 border-[#FF3B5C]/30 text-[#FF3B5C]"
                  : "bg-transparent border-slate-700 text-slate-500 hover:text-slate-300"
              )}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Filter inputs */}
        <div>
          <div className="text-[10px] text-slate-500 mb-1">Min Volume</div>
          <input
            type="number"
            value={minVolume}
            onChange={(e) => setMinVolume(Number(e.target.value) || 0)}
            className="w-full h-7 px-2 text-xs bg-[#080B10] border border-slate-700 rounded text-white focus:border-slate-500 focus:outline-none"
          />
        </div>
        <div>
          <div className="text-[10px] text-slate-500 mb-1">Min Open Interest</div>
          <input
            type="number"
            value={minOI}
            onChange={(e) => setMinOI(Number(e.target.value) || 0)}
            className="w-full h-7 px-2 text-xs bg-[#080B10] border border-slate-700 rounded text-white focus:border-slate-500 focus:outline-none"
          />
        </div>
        <div>
          <div className="text-[10px] text-slate-500 mb-1">Max Spread %</div>
          <input
            type="number"
            step="0.5"
            value={maxSpread}
            onChange={(e) => setMaxSpread(Number(e.target.value) || 0)}
            className="w-full h-7 px-2 text-xs bg-[#080B10] border border-slate-700 rounded text-white focus:border-slate-500 focus:outline-none"
          />
        </div>
        <div>
          <div className="text-[10px] text-slate-500 mb-1">Min |Δ| (0-1)</div>
          <input
            type="number"
            step="0.05"
            min={0}
            max={1}
            value={minDelta}
            onChange={(e) => setMinDelta(Math.min(1, Math.max(0, Number(e.target.value) || 0)))}
            className="w-full h-7 px-2 text-xs bg-[#080B10] border border-slate-700 rounded text-white focus:border-slate-500 focus:outline-none"
          />
        </div>
        <div>
          <div className="text-[10px] text-slate-500 mb-1">Max |Δ| (0-1)</div>
          <input
            type="number"
            step="0.05"
            min={0}
            max={1}
            value={maxDelta}
            onChange={(e) => setMaxDelta(Math.min(1, Math.max(0, Number(e.target.value) || 0)))}
            className="w-full h-7 px-2 text-xs bg-[#080B10] border border-slate-700 rounded text-white focus:border-slate-500 focus:outline-none"
          />
        </div>
        <div>
          <div className="text-[10px] text-slate-500 mb-1">Expirations (1-6)</div>
          <input
            type="number"
            min={1}
            max={6}
            value={expirations}
            onChange={(e) => setExpirations(Math.min(6, Math.max(1, Number(e.target.value) || 1)))}
            className="w-full h-7 px-2 text-xs bg-[#080B10] border border-slate-700 rounded text-white focus:border-slate-500 focus:outline-none"
          />
        </div>
      </div>

      <button
        onClick={handleLoad}
        disabled={isFetching}
        className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs rounded border border-[#60A5FA]/30 text-[#60A5FA] bg-[#60A5FA]/5 hover:bg-[#60A5FA]/10 transition-all disabled:opacity-50"
      >
        {isFetching ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        {isFetching ? "Loading…" : enabled ? "Refresh Contracts" : "Load Contracts"}
      </button>

      {/* Not configured */}
      {notConfigured && (
        <div className="flex items-start gap-2 p-3 bg-slate-800/40 border border-slate-700 rounded-lg">
          <Lock className="w-3.5 h-3.5 text-slate-500 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-xs font-medium text-slate-300">Polygon API not configured</div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              Add your <span className="font-mono text-slate-400">POLYGON_API_KEY</span> secret to enable live option chain data from{" "}
              <a href="https://polygon.io" target="_blank" rel="noopener noreferrer" className="text-[#60A5FA] hover:underline">polygon.io</a>.
              Option chain snapshots with Greeks require a Polygon Starter plan or higher.
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-2.5 bg-[#FF3B5C]/10 border border-[#FF3B5C]/20 rounded-lg">
          <AlertCircle className="w-3.5 h-3.5 text-[#FF3B5C] flex-shrink-0" />
          <span className="text-xs text-[#FF3B5C]">{error.message}</span>
        </div>
      )}

      {/* Results table */}
      {chainData && (
        <div className="space-y-2">
          {/* Meta */}
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400">
              {chainData.symbol}
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400">
              Underlying ${chainData.underlyingPrice.toFixed(2)}
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400">
              {chainData.expirationCount} exp
            </span>
            {chainData.expirationsUsed.map((exp) => (
              <span key={exp} className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#60A5FA]/10 border border-[#60A5FA]/20 text-[#60A5FA]">
                {exp}
              </span>
            ))}
          </div>

          {chainData.contracts.length === 0 ? (
            <div className="text-center py-4 text-xs text-slate-500">
              No contracts matched your filters. Try relaxing min volume, OI, or spread %.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[10px] font-mono">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-800">
                    <th className="text-left pb-1.5 pr-2">#</th>
                    <th className="text-left pb-1.5 pr-2">Strike</th>
                    <th className="text-left pb-1.5 pr-2">Exp</th>
                    <th className="text-right pb-1.5 pr-2">Bid</th>
                    <th className="text-right pb-1.5 pr-2">Ask</th>
                    <th className="text-right pb-1.5 pr-2">Sprd%</th>
                    <th className="text-right pb-1.5 pr-2">Vol</th>
                    <th className="text-right pb-1.5 pr-2">OI</th>
                    <th className="text-right pb-1.5 pr-2">Δ</th>
                    <th className="text-right pb-1.5">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {(chainData.contracts as OptionContract[]).map((c, idx) => (
                    <tr key={c.ticker || `${c.strike}-${c.expiration}-${idx}`} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                      <td className="py-1 pr-2 text-slate-600">{idx + 1}</td>
                      <td className="py-1 pr-2 text-white">{c.strike.toFixed(2)}</td>
                      <td className="py-1 pr-2 text-slate-400">{c.expiration}</td>
                      <td className="py-1 pr-2 text-right text-slate-300">{c.bid.toFixed(2)}</td>
                      <td className="py-1 pr-2 text-right text-slate-300">{c.ask.toFixed(2)}</td>
                      <td className="py-1 pr-2 text-right text-slate-400">{c.spreadPct.toFixed(1)}</td>
                      <td className="py-1 pr-2 text-right text-slate-400">{c.volume.toLocaleString()}</td>
                      <td className="py-1 pr-2 text-right text-slate-400">{c.openInterest.toLocaleString()}</td>
                      <td className="py-1 pr-2 text-right text-slate-400">{c.delta.toFixed(2)}</td>
                      <td className="py-1 text-right">
                        <span className={scoreClass(c.contractScore)}>{c.contractScore}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Stock card ───────────────────────────────────────────────
function StockCard({
  result,
  onPushToJournal,
  isPushed,
}: {
  result: StockResult;
  onPushToJournal?: (setup: JournalSetup) => void;
  isPushed?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showChain, setShowChain] = useState(false);
  const isCall = result.bias === "Calls";
  const isPut = result.bias === "Puts";
  const scoreColor = result.bestScore >= 75 ? "bg-[#00FF88]" : result.bestScore >= 60 ? "bg-[#F5A623]" : "bg-slate-500";
  const pctColor = result.percentChange >= 0 ? "text-[#00FF88]" : "text-[#FF3B5C]";

  const handlePush = () => {
    if (!onPushToJournal) return;
    // Build a minimal JournalSetup from the stock result
    const setupType: "CALL" | "PUT" = isCall ? "CALL" : "PUT";
    const quality: "PREMIUM" | "STRONG" | "DEVELOPING" =
      result.bestScore >= 75 ? "PREMIUM" : result.bestScore >= 60 ? "STRONG" : "DEVELOPING";
    // Derive approximate levels from support/resistance
    const entry = result.price;
    const stopLoss = isCall
      ? Number((result.support20 * 0.995).toFixed(2))
      : Number((result.resistance20 * 1.005).toFixed(2));
    const risk = Math.abs(entry - stopLoss);
    const takeProfit = isCall
      ? Number((entry + risk * 2).toFixed(2))
      : Number((entry - risk * 2).toFixed(2));
    const rrRatio = risk > 0 ? Number((Math.abs(takeProfit - entry) / risk).toFixed(2)) : 2;

    const setup: JournalSetup = {
      id: `${result.ticker}-STOCK-${Date.now()}`,
      symbol: result.ticker,
      displaySymbol: result.ticker,
      assetClass: "STOCK",
      setupType,
      quality,
      pattern: result.setupType,
      timeframe: "Daily",
      currentPrice: result.price,
      levels: { entry, stopLoss, takeProfit },
      rrRatio,
      confluences: [result.trend, result.emaStack, `RSI ${result.rsi.toFixed(0)}`],
      scannedAt: new Date().toISOString(),
    };
    onPushToJournal(setup);
  };

  return (
    <div className="bg-[#0D1117] border border-slate-800/60 rounded-xl overflow-hidden hover:border-slate-700/60 transition-colors">
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <div className={cn(
              "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 border",
              isCall ? "bg-[#00FF88]/10 border-[#00FF88]/20" : isPut ? "bg-[#FF3B5C]/10 border-[#FF3B5C]/20" : "bg-slate-800 border-slate-700"
            )}>
              {isCall ? <TrendingUp className="w-4 h-4 text-[#00FF88]" /> : isPut ? <TrendingDown className="w-4 h-4 text-[#FF3B5C]" /> : <Activity className="w-4 h-4 text-slate-500" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white text-base">{result.ticker}</span>
                <span className={cn("text-sm font-mono font-semibold", pctColor)}>
                  {result.percentChange >= 0 ? "+" : ""}{result.percentChange.toFixed(2)}%
                </span>
              </div>
              <div className="text-xs text-slate-500 mt-0.5">${result.price.toFixed(2)} · {result.exchange}</div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <SetupBadge type={result.setupType} />
            <div className="flex items-center gap-1.5">
              <div className={cn("w-2 h-2 rounded-full", scoreColor)} />
              <span className="text-xs font-mono text-slate-400">Score {result.bestScore}</span>
            </div>
          </div>
        </div>

        {/* Score bars */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
              <TrendingUp className="w-2.5 h-2.5 text-[#00FF88]" /> Call Score
            </div>
            <ScoreBar score={result.callScore} color="bg-[#00FF88]" />
          </div>
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
              <TrendingDown className="w-2.5 h-2.5 text-[#FF3B5C]" /> Put Score
            </div>
            <ScoreBar score={result.putScore} color="bg-[#FF3B5C]" />
          </div>
        </div>

        {/* Action buttons */}
        {onPushToJournal && (
          <div className="flex gap-2 mt-3">
            <button
              onClick={handlePush}
              disabled={isPushed}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-all",
                isPushed
                  ? "border-[#F5A623]/30 text-[#F5A623] bg-[#F5A623]/5 cursor-default"
                  : "border-slate-700 text-slate-400 hover:border-[#F5A623]/40 hover:text-[#F5A623] hover:bg-[#F5A623]/5"
              )}
            >
              {isPushed ? (
                <><CheckCircle2 className="w-3 h-3" /> In Journal</>
              ) : (
                <><BookOpen className="w-3 h-3" /> Push to Journal</>
              )}
            </button>
            <button
              onClick={() => setShowChain(!showChain)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-all",
                showChain
                  ? "border-[#60A5FA]/30 text-[#60A5FA] bg-[#60A5FA]/5"
                  : "border-slate-700 text-slate-400 hover:border-[#60A5FA]/40 hover:text-[#60A5FA] hover:bg-[#60A5FA]/5"
              )}
            >
              <Layers className="w-3 h-3" />
              {showChain ? "Hide Chain" : "Option Chain"}
            </button>
          </div>
        )}
        {!onPushToJournal && (
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => setShowChain(!showChain)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-all",
                showChain
                  ? "border-[#60A5FA]/30 text-[#60A5FA] bg-[#60A5FA]/5"
                  : "border-slate-700 text-slate-400 hover:border-[#60A5FA]/40 hover:text-[#60A5FA] hover:bg-[#60A5FA]/5"
              )}
            >
              <Layers className="w-3 h-3" />
              {showChain ? "Hide Chain" : "Option Chain"}
            </button>
          </div>
        )}
      </div>

      {/* Expand toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-slate-600 hover:text-slate-400 border-t border-slate-800/60 transition-colors"
      >
        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {expanded ? "Less" : "More details"}
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-slate-800/60 pt-3 space-y-3">
          {/* Key metrics grid */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "RSI", value: result.rsi.toFixed(1), color: result.rsi > 70 ? "text-[#FF3B5C]" : result.rsi < 30 ? "text-[#00FF88]" : "text-white" },
              { label: "Rel Vol", value: `${result.relVolume.toFixed(2)}x`, color: result.relVolume > 1.5 ? "text-[#F5A623]" : "text-white" },
              { label: "Pullback Q", value: `${result.pullbackQuality}`, color: result.pullbackQuality >= 70 ? "text-[#00FF88]" : "text-white" },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-[#080B10] rounded-lg p-2.5 border border-slate-800/60">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{label}</div>
                <div className={cn("text-sm font-mono font-bold", color)}>{value}</div>
              </div>
            ))}
          </div>

          {/* Trend & EMA */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-[#080B10] rounded-lg p-2.5 border border-slate-800/60">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Trend</div>
              <div className={cn("text-sm font-mono font-bold capitalize",
                result.trend === "bullish" ? "text-[#00FF88]" : result.trend === "bearish" ? "text-[#FF3B5C]" : "text-slate-400"
              )}>{result.trend}</div>
            </div>
            <div className="bg-[#080B10] rounded-lg p-2.5 border border-slate-800/60">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">EMA Stack</div>
              <div className={cn("text-sm font-mono font-bold capitalize",
                result.emaStack === "bullish" ? "text-[#00FF88]" : result.emaStack === "bearish" ? "text-[#FF3B5C]" : "text-slate-400"
              )}>{result.emaStack}</div>
            </div>
          </div>

          {/* Support / Resistance */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-[#080B10] rounded-lg p-2.5 border border-slate-800/60">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">20D Support</div>
              <div className="text-sm font-mono font-bold text-[#00FF88]">${result.support20.toFixed(2)}</div>
              <div className="text-[10px] text-slate-600 mt-0.5">{result.distanceToSupport.toFixed(1)}% away</div>
            </div>
            <div className="bg-[#080B10] rounded-lg p-2.5 border border-slate-800/60">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">20D Resistance</div>
              <div className="text-sm font-mono font-bold text-[#FF3B5C]">${result.resistance20.toFixed(2)}</div>
              <div className="text-[10px] text-slate-600 mt-0.5">{result.distanceToResistance.toFixed(1)}% away</div>
            </div>
          </div>

          {/* Option chain panel */}
          {showChain && (
            <OptionChainPanel
              ticker={result.ticker}
              defaultSide={result.bias === "Puts" ? "puts" : "calls"}
            />
          )}
        </div>
      )}

      {/* Option chain when not expanded */}
      {showChain && !expanded && (
        <div className="px-4 pb-4 border-t border-slate-800/60 pt-3">
          <OptionChainPanel
            ticker={result.ticker}
            defaultSide={result.bias === "Puts" ? "puts" : "calls"}
          />
        </div>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────
export default function StockScanPage({ onPushToJournal, pushedIds, autoPush }: StockScanPageProps) {
  const [minScore, setMinScore] = useState(50);
  const [searchQuery, setSearchQuery] = useState("");
  const [biasFilter, setBiasFilter] = useState<"ALL" | "Calls" | "Puts" | "Neutral">("ALL");

  const { data, isLoading, error, refetch, isFetching } = trpc.stockScan.scan.useQuery(
    { minScore },
    { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false }
  );

  const results = data?.results ?? [];
  const warmingCount = data?.warmingCount ?? 0;
  const cacheWarm = data?.cacheWarm ?? false;
  const cacheAgeMs = data?.cacheAgeMs ?? null;

  const cacheAgeLabel = useMemo(() => {
    if (!cacheAgeMs) return null;
    const mins = Math.floor(cacheAgeMs / 60000);
    if (mins < 1) return "Live data";
    return `${mins}m old`;
  }, [cacheAgeMs]);

  const filtered = useMemo(() => {
    return results.filter((r) => {
      if (searchQuery && !r.ticker.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (biasFilter !== "ALL" && r.bias !== biasFilter) return false;
      return true;
    });
  }, [results, searchQuery, biasFilter]);

  const callCount = results.filter((r) => r.bias === "Calls").length;
  const putCount = results.filter((r) => r.bias === "Puts").length;
  const premiumCount = results.filter((r) => r.bestScore >= 75).length;

  const handleRescan = () => {
    refetch();
    toast.info("Rescanning stocks...", { description: "Fetching latest data from Twelve Data" });
  };

  // Auto-push: push all premium setups to journal when autoPush is enabled
  // (handled at App level — we just need to surface the callback)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">LIVE STOCK SCANNER · TWELVE DATA</span>
            {cacheWarm && cacheAgeLabel && (
              <span className={cn(
                "text-[10px] font-mono px-2 py-0.5 rounded border",
                cacheAgeMs && cacheAgeMs < 60000
                  ? "text-[#00FF88] border-[#00FF88]/20 bg-[#00FF88]/5"
                  : "text-[#F5A623] border-[#F5A623]/20 bg-[#F5A623]/5"
              )}>
                {cacheAgeLabel}
              </span>
            )}
            {warmingCount > 0 && (
              <span className="text-[10px] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">
                Warming {warmingCount} symbols…
              </span>
            )}
          </div>
          <h2 className="text-xl font-bold text-white">Stock Options Scanner</h2>
          <p className="text-sm text-slate-500 mt-0.5">Call/Put scoring · SMA20/50 · RSI14 · Relative volume · Daily candles</p>
        </div>
        <Button
          onClick={handleRescan}
          disabled={isFetching}
          variant="outline"
          size="sm"
          className="border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 bg-transparent"
        >
          {isFetching ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
          Rescan
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "TOTAL", value: results.length, color: "text-white" },
          { label: "PREMIUM (75+)", value: premiumCount, color: "text-[#F5A623]" },
          { label: "CALLS", value: callCount, color: "text-[#00FF88]" },
          { label: "PUTS", value: putCount, color: "text-[#FF3B5C]" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-[#0D1117] border border-slate-800/60 rounded-xl p-4 text-center">
            <div className={cn("text-2xl font-bold font-mono", color)}>{value}</div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-1">{label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <Input
            placeholder="Search ticker..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-sm bg-[#0D1117] border-slate-700 text-white placeholder:text-slate-600 focus:border-slate-500"
          />
        </div>
        <div className="flex items-center gap-1.5">
          {(["ALL", "Calls", "Puts", "Neutral"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setBiasFilter(f)}
              className={cn(
                "px-3 py-1 text-xs rounded-md border transition-all",
                biasFilter === f
                  ? f === "Calls" ? "bg-[#00FF88]/10 border-[#00FF88]/30 text-[#00FF88]"
                    : f === "Puts" ? "bg-[#FF3B5C]/10 border-[#FF3B5C]/30 text-[#FF3B5C]"
                    : "bg-slate-700 border-slate-600 text-white"
                  : "bg-transparent border-slate-700 text-slate-500 hover:text-slate-300"
              )}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-slate-500">Min score:</span>
          {[40, 50, 60, 70, 75].map((s) => (
            <button
              key={s}
              onClick={() => setMinScore(s)}
              className={cn(
                "px-2.5 py-1 text-xs rounded border transition-all font-mono",
                minScore === s
                  ? "bg-[#F5A623]/10 border-[#F5A623]/30 text-[#F5A623]"
                  : "bg-transparent border-slate-700 text-slate-500 hover:text-slate-300"
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <Loader2 className="w-8 h-8 text-slate-500 animate-spin" />
          <div className="text-center">
            <div className="text-sm text-slate-400">Fetching stock data from Twelve Data…</div>
            <div className="text-xs text-slate-600 mt-1">First scan loads 3 symbols immediately, rest warm in background</div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-[#FF3B5C]/10 border border-[#FF3B5C]/20 rounded-xl">
          <AlertCircle className="w-5 h-5 text-[#FF3B5C] flex-shrink-0" />
          <div>
            <div className="text-sm font-medium text-[#FF3B5C]">Scan failed</div>
            <div className="text-xs text-slate-400 mt-0.5">{error.message}</div>
          </div>
        </div>
      )}

      {/* Results */}
      {!isLoading && !error && (
        <>
          {filtered.length > 0 ? (
            <>
              <div className="text-xs text-slate-500">
                Showing <span className="text-white font-mono">{filtered.length}</span> results · {data?.totalScanned ?? 0} symbols scanned · min score {minScore}
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {filtered.map((result) => (
                  <StockCard
                    key={result.ticker}
                    result={result}
                    onPushToJournal={onPushToJournal}
                    isPushed={pushedIds?.has(`${result.ticker}-STOCK-`) || false}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-14 h-14 rounded-full bg-slate-800/60 border border-slate-700 flex items-center justify-center">
                <BarChart3 className="w-6 h-6 text-slate-600" />
              </div>
              <div className="text-center">
                <div className="text-sm font-medium text-slate-400">
                  {warmingCount > 0 ? `Warming cache — ${warmingCount} symbols loading…` : "No setups found"}
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  {warmingCount > 0
                    ? "Rescan in ~30 seconds to see results"
                    : "Try lowering the minimum score or rescanning"}
                </div>
              </div>
              {warmingCount === 0 && (
                <Button onClick={handleRescan} variant="outline" size="sm" className="border-slate-700 text-slate-400 bg-transparent">
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Rescan
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
