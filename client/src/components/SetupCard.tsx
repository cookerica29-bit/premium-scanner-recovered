// ============================================================
// SETUP CARD COMPONENT
// Displays a single trading setup with entry/SL/TP levels
// Design: Dark Terminal / Bloomberg-Inspired
// Colors: #00FF88 bullish, #FF3B5C bearish, #F5A623 premium badge
// ============================================================

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronUp,
  BookOpen,
  Check,
  Clock,
  Zap,
  Star,
  Activity,
} from "lucide-react";
import type { Setup } from "@/lib/types";
import { formatTimeAgo } from "@/lib/journal";
import { cn } from "@/lib/utils";

interface SetupCardProps {
  setup: Setup;
  onPushToJournal: (setup: Setup) => void;
  isPushed?: boolean;
  autoPush?: boolean;
}

export function SetupCard({ setup, onPushToJournal, isPushed = false, autoPush = false }: SetupCardProps) {
  const [expanded, setExpanded] = useState(false);

  const isBullish = setup.setupType === "CALL" || setup.setupType === "LONG";
  const isCall = setup.setupType === "CALL";
  const isPut = setup.setupType === "PUT";
  const isForex = setup.assetClass === "FOREX";

  const signalColor = isBullish ? "text-[#00FF88]" : "text-[#FF3B5C]";
  const signalBg = isBullish ? "bg-[#00FF88]/10 border-[#00FF88]/20" : "bg-[#FF3B5C]/10 border-[#FF3B5C]/20";
  const signalGlow = isBullish ? "shadow-[0_0_12px_rgba(0,255,136,0.15)]" : "shadow-[0_0_12px_rgba(255,59,92,0.15)]";

  const qualityConfig = {
    PREMIUM: {
      color: "text-[#F5A623]",
      bg: "bg-[#F5A623]/10 border-[#F5A623]/30",
      glow: "shadow-[0_0_16px_rgba(245,166,35,0.2)]",
      icon: <Zap className="w-3 h-3" />,
      label: "PREMIUM",
    },
    STRONG: {
      color: "text-[#60A5FA]",
      bg: "bg-[#60A5FA]/10 border-[#60A5FA]/20",
      glow: "",
      icon: <Star className="w-3 h-3" />,
      label: "STRONG",
    },
    DEVELOPING: {
      color: "text-slate-400",
      bg: "bg-slate-400/10 border-slate-400/20",
      glow: "",
      icon: <Activity className="w-3 h-3" />,
      label: "DEVELOPING",
    },
  };

  const qConfig = qualityConfig[setup.quality];

  const formatPrice = (price: number) => {
    if (price >= 100) return price.toFixed(2);
    if (price >= 1) return price.toFixed(4);
    return price.toFixed(5);
  };

  return (
    <div
      className={cn(
        "rounded-lg border bg-[#0D1117] transition-all duration-200 overflow-hidden",
        signalBg,
        setup.quality === "PREMIUM" ? qConfig.glow : signalGlow,
        "hover:border-opacity-60"
      )}
    >
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          {/* Left: Symbol + Setup Info */}
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={cn(
                "flex items-center justify-center w-10 h-10 rounded-lg border flex-shrink-0",
                signalBg
              )}
            >
              {isBullish ? (
                <TrendingUp className={cn("w-5 h-5", signalColor)} />
              ) : (
                <TrendingDown className={cn("w-5 h-5", signalColor)} />
              )}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-bold text-white text-lg leading-none">{setup.symbol}</span>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] font-bold px-2 py-0.5 flex items-center gap-1 border",
                    qConfig.bg,
                    qConfig.color
                  )}
                >
                  {qConfig.icon}
                  {qConfig.label}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] font-bold px-2 py-0.5 border",
                    isBullish
                      ? "bg-[#00FF88]/10 border-[#00FF88]/30 text-[#00FF88]"
                      : "bg-[#FF3B5C]/10 border-[#FF3B5C]/30 text-[#FF3B5C]"
                  )}
                >
                  {isCall ? "CALL" : isPut ? "PUT" : isBullish ? "LONG" : "SHORT"}
                </Badge>
                <Badge variant="outline" className="text-[10px] px-2 py-0.5 border-slate-700 text-slate-400">
                  {setup.timeframe}
                </Badge>
              </div>
              <p className="text-slate-400 text-xs mt-1 font-medium">{setup.pattern}</p>
              {setup.sector && (
                <p className="text-slate-600 text-[11px] mt-0.5">{setup.sector}</p>
              )}
              {setup.session && (
                <p className="text-slate-600 text-[11px] mt-0.5">Session: {setup.session}</p>
              )}
            </div>
          </div>

          {/* Right: RR + Time */}
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <div className={cn("font-mono font-bold text-lg leading-none", signalColor)}>
              {setup.rrRatio.toFixed(1)}:1
            </div>
            <div className="text-[10px] text-slate-500">RR Ratio</div>
            <div className="flex items-center gap-1 text-[10px] text-slate-500 mt-1">
              <Clock className="w-3 h-3" />
              {formatTimeAgo(setup.scannedAt)}
            </div>
          </div>
        </div>

        {/* Price Levels Row */}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="bg-[#0A0D12] rounded-md p-2 border border-slate-800">
            <div className="text-[10px] text-slate-500 mb-0.5 uppercase tracking-wide">Entry</div>
            <div className="font-mono text-sm font-semibold text-white">{formatPrice(setup.levels.entry)}</div>
          </div>
          <div className="bg-[#0A0D12] rounded-md p-2 border border-[#FF3B5C]/20">
            <div className="text-[10px] text-[#FF3B5C]/70 mb-0.5 uppercase tracking-wide">Stop Loss</div>
            <div className="font-mono text-sm font-semibold text-[#FF3B5C]">{formatPrice(setup.levels.stopLoss)}</div>
          </div>
          <div className="bg-[#0A0D12] rounded-md p-2 border border-[#00FF88]/20">
            <div className="text-[10px] text-[#00FF88]/70 mb-0.5 uppercase tracking-wide">TP1</div>
            <div className="font-mono text-sm font-semibold text-[#00FF88]">{formatPrice(setup.levels.takeProfit)}</div>
          </div>
        </div>

        {/* Action Row */}
        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {expanded ? "Less details" : "More details"}
          </button>

          <div className="flex items-center gap-2">
            {autoPush && (
              <span className="text-[10px] text-[#F5A623] flex items-center gap-1">
                <Zap className="w-3 h-3" />
                Auto-pushed
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => onPushToJournal(setup)}
              disabled={isPushed}
              className={cn(
                "h-7 text-xs gap-1.5 border transition-all",
                isPushed
                  ? "border-[#00FF88]/30 text-[#00FF88]/60 bg-[#00FF88]/5 cursor-not-allowed"
                  : "border-slate-700 text-slate-400 hover:border-[#00FF88]/50 hover:text-[#00FF88] hover:bg-[#00FF88]/5"
              )}
            >
              {isPushed ? (
                <>
                  <Check className="w-3 h-3" />
                  In Journal
                </>
              ) : (
                <>
                  <BookOpen className="w-3 h-3" />
                  Push to Journal
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="border-t border-slate-800/50 bg-[#080B10] px-4 pb-4 pt-3">
          {/* Extended TPs */}
          {(setup.levels.takeProfit2 || setup.levels.takeProfit3) && (
            <div className="mb-3">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Extended Targets</div>
              <div className="grid grid-cols-2 gap-2">
                {setup.levels.takeProfit2 && (
                  <div className="bg-[#0A0D12] rounded-md p-2 border border-[#00FF88]/15">
                    <div className="text-[10px] text-[#00FF88]/50 mb-0.5">TP2 ({setup.rrRatio2?.toFixed(1)}:1)</div>
                    <div className="font-mono text-sm text-[#00FF88]/80">{formatPrice(setup.levels.takeProfit2)}</div>
                  </div>
                )}
                {setup.levels.takeProfit3 && (
                  <div className="bg-[#0A0D12] rounded-md p-2 border border-[#00FF88]/10">
                    <div className="text-[10px] text-[#00FF88]/40 mb-0.5">TP3 ({setup.rrRatio3?.toFixed(1)}:1)</div>
                    <div className="font-mono text-sm text-[#00FF88]/60">{formatPrice(setup.levels.takeProfit3)}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          <Separator className="bg-slate-800/50 mb-3" />

          {/* Confluences */}
          <div className="mb-3">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">
              Confluences ({setup.confluences.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {setup.confluences.map((c, i) => (
                <span
                  key={i}
                  className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800/60 text-slate-300 border border-slate-700/50"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>

          {/* Extra Info */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            {setup.ivRank !== undefined && (
              <div>
                <span className="text-slate-500">IV Rank: </span>
                <span
                  className={cn(
                    "font-mono font-semibold",
                    setup.ivRank < 30 ? "text-[#00FF88]" : setup.ivRank < 60 ? "text-[#F5A623]" : "text-[#FF3B5C]"
                  )}
                >
                  {setup.ivRank}%
                </span>
              </div>
            )}
            {setup.volume && (
              <div>
                <span className="text-slate-500">Volume: </span>
                <span className="font-mono text-white">
                  {setup.volume >= 1000000
                    ? `${(setup.volume / 1000000).toFixed(1)}M`
                    : `${(setup.volume / 1000).toFixed(0)}K`}
                </span>
              </div>
            )}
            {setup.marketCap && (
              <div>
                <span className="text-slate-500">Mkt Cap: </span>
                <span className="font-mono text-white">{setup.marketCap}</span>
              </div>
            )}
            {setup.session && (
              <div>
                <span className="text-slate-500">Session: </span>
                <span className="font-mono text-white">{setup.session}</span>
              </div>
            )}
          </div>

          {/* Description */}
          <div className="mt-3 text-[11px] text-slate-500 leading-relaxed border-t border-slate-800/50 pt-3">
            {setup.description}
          </div>
        </div>
      )}
    </div>
  );
}
