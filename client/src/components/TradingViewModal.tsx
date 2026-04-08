/**
 * TradingView Chart Modal
 * Embeds a TradingView widget for any symbol/timeframe combination.
 * Uses the free TradingView widget (no API key required).
 */

import { useEffect, useRef } from "react";
import { X, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface TradingViewModalProps {
  symbol: string;
  displaySymbol: string;
  timeframe: string;
  assetClass: "STOCK" | "FOREX";
  isOpen: boolean;
  onClose: () => void;
}

// Map our timeframes to TradingView intervals
const TV_INTERVAL_MAP: Record<string, string> = {
  "15m": "15",
  "30m": "30",
  "1H": "60",
  "4H": "240",
  "Daily": "D",
};

// Map our instrument names to TradingView symbols
function toTVSymbol(symbol: string, assetClass: "STOCK" | "FOREX"): string {
  if (assetClass === "FOREX") {
    // Convert OANDA format (EUR_USD) to TradingView (OANDA:EURUSD)
    const clean = symbol.replace("_", "");
    // Gold/Silver special cases
    if (symbol === "XAU_USD") return "OANDA:XAUUSD";
    if (symbol === "XAG_USD") return "OANDA:XAGUSD";
    if (symbol === "US30_USD") return "FOREXCOM:DJI";
    if (symbol === "SPX500_USD") return "FOREXCOM:SPXUSD";
    if (symbol === "NAS100_USD") return "FOREXCOM:NSXUSD";
    return `OANDA:${clean}`;
  }
  // Stocks — use NASDAQ or NYSE prefix
  return symbol;
}

export default function TradingViewModal({
  symbol,
  displaySymbol,
  timeframe,
  assetClass,
  isOpen,
  onClose,
}: TradingViewModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<HTMLDivElement>(null);

  const tvSymbol = toTVSymbol(symbol, assetClass);
  const tvInterval = TV_INTERVAL_MAP[timeframe] ?? "D";

  useEffect(() => {
    if (!isOpen || !widgetRef.current) return;

    // Clear any previous widget
    widgetRef.current.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval: tvInterval,
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "en",
      backgroundColor: "#0A0D12",
      gridColor: "rgba(255, 255, 255, 0.04)",
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: false,
      calendar: false,
      hide_volume: false,
      support_host: "https://www.tradingview.com",
      studies: ["STD;Volume"],
    });

    widgetRef.current.appendChild(script);

    return () => {
      if (widgetRef.current) {
        widgetRef.current.innerHTML = "";
      }
    };
  }, [isOpen, tvSymbol, tvInterval]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const tvUrl = `https://www.tradingview.com/chart/?symbol=${tvSymbol}&interval=${tvInterval}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

      {/* Modal */}
      <div
        ref={containerRef}
        className="relative z-10 w-full max-w-5xl h-[80vh] bg-[#0A0D12] border border-slate-700/60 rounded-xl overflow-hidden shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/60 bg-[#080B10] flex-shrink-0">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "w-2 h-2 rounded-full",
                assetClass === "FOREX" ? "bg-[#60A5FA]" : "bg-[#00FF88]"
              )}
            />
            <span className="font-bold text-white font-mono">{displaySymbol}</span>
            <span className="text-slate-500 text-sm">·</span>
            <span className="text-slate-400 text-sm font-mono">{timeframe}</span>
            <span className="text-slate-500 text-sm">·</span>
            <span className="text-slate-500 text-xs font-mono">{tvSymbol}</span>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={tvUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors px-2 py-1 rounded border border-slate-700 hover:border-slate-500"
            >
              <ExternalLink className="w-3 h-3" />
              Open in TradingView
            </a>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-slate-500 hover:text-white hover:bg-slate-800 transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Chart Container */}
        <div className="flex-1 relative">
          <div
            ref={widgetRef}
            className="tradingview-widget-container w-full h-full"
            style={{ height: "100%" }}
          >
            <div className="tradingview-widget-container__widget" style={{ height: "100%", width: "100%" }} />
          </div>
        </div>
      </div>
    </div>
  );
}
