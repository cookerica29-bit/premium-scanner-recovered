// ============================================================
// APP ROOT — Main layout with sidebar navigation
// Design: Dark Terminal / Bloomberg-Inspired Data Dashboard
// Colors: #0A0D12 bg, #00FF88 bullish, #FF3B5C bearish, #F5A623 premium
// ============================================================

import { useState, useCallback, useMemo } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  Globe,
  BookOpen,
  Zap,
  BarChart3,
  Activity,
  ChevronLeft,
  ChevronRight,
  Menu,
  LogIn,
  LogOut,
  User,
  Bell,
  LineChart,
  Eye,
  Calculator as CalcIcon,
} from "lucide-react";
import ForexScreener from "@/pages/ForexScreener";
import StockScanPage from "@/pages/StockScanPage";
import Journal from "@/pages/Journal";
import Alerts from "@/pages/Alerts";
import Analytics from "@/pages/Analytics";
import WatchlistPage from "@/pages/Watchlist";
import Calculator from "@/pages/Calculator";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import ErrorBoundary from "./components/ErrorBoundary";

// Unified setup type for live screener data from tRPC
interface ScreenerSetup {
  id: string;
  symbol: string;
  displaySymbol?: string;
  assetClass: "STOCK" | "FOREX";
  setupType: "CALL" | "PUT" | "LONG" | "SHORT";
  quality: "PREMIUM" | "STRONG" | "DEVELOPING";
  pattern: string;
  timeframe: string;
  currentPrice?: number;
  levels: {
    entry: number;
    stopLoss: number;
    takeProfit: number;
    takeProfit2?: number;
    takeProfit3?: number;
  };
  rrRatio: number;
  confluences: string[];
  sector?: string;
  ivRank?: number;
  session?: string;
  scannedAt?: string | Date;
}

type ActiveTab = "stocks" | "forex" | "journal" | "alerts" | "analytics" | "watchlist" | "calculator";

const NAV_ITEMS = [
  {
    id: "stocks" as ActiveTab,
    label: "Stock Scanner",
    shortLabel: "Stocks",
    icon: TrendingUp,
    color: "text-[#00FF88]",
    activeBg: "bg-[#00FF88]/10 border-[#00FF88]/20",
    activeText: "text-[#00FF88]",
    dot: "bg-[#00FF88]",
    description: "Call/Put scores",
  },
  {
    id: "forex" as ActiveTab,
    label: "Forex Screener",
    shortLabel: "Forex",
    icon: Globe,
    color: "text-[#60A5FA]",
    activeBg: "bg-[#60A5FA]/10 border-[#60A5FA]/20",
    activeText: "text-[#60A5FA]",
    dot: "bg-[#60A5FA]",
    description: "Min 2:1 RR",
  },
  {
    id: "journal" as ActiveTab,
    label: "Trade Journal",
    shortLabel: "Journal",
    icon: BookOpen,
    color: "text-[#F5A623]",
    activeBg: "bg-[#F5A623]/10 border-[#F5A623]/20",
    activeText: "text-[#F5A623]",
    dot: "bg-[#F5A623]",
    description: "Track trades",
  },
  {
    id: "alerts" as ActiveTab,
    label: "Price Alerts",
    shortLabel: "Alerts",
    icon: Bell,
    color: "text-[#F87171]",
    activeBg: "bg-[#F87171]/10 border-[#F87171]/20",
    activeText: "text-[#F87171]",
    dot: "bg-[#F87171]",
    description: "Entry proximity",
  },
  {
    id: "analytics" as ActiveTab,
    label: "Analytics",
    shortLabel: "Stats",
    icon: LineChart,
    color: "text-[#A78BFA]",
    activeBg: "bg-[#A78BFA]/10 border-[#A78BFA]/20",
    activeText: "text-[#A78BFA]",
    dot: "bg-[#A78BFA]",
    description: "Performance",
  },
  {
    id: "watchlist" as ActiveTab,
    label: "Watchlist",
    shortLabel: "Watch",
    icon: Eye,
    color: "text-[#60A5FA]",
    activeBg: "bg-[#60A5FA]/10 border-[#60A5FA]/20",
    activeText: "text-[#60A5FA]",
    dot: "bg-[#60A5FA]",
    description: "Pinned symbols",
  },
  {
    id: "calculator" as ActiveTab,
    label: "Position Calc",
    shortLabel: "Calc",
    icon: CalcIcon,
    color: "text-[#34D399]",
    activeBg: "bg-[#34D399]/10 border-[#34D399]/20",
    activeText: "text-[#34D399]",
    dot: "bg-[#34D399]",
    description: "Risk & lot size",
  },
];

function AppShell() {
  const { user, isAuthenticated, logout } = useAuth();
  const utils = trpc.useUtils();

  const [activeTab, setActiveTab] = useState<ActiveTab>("forex");
  const [autoPush, setAutoPush] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // ─── Cloud journal queries ──────────────────────────────────────────────────
  const { data: journalEntries = [], refetch: refetchJournal } = trpc.journal.list.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 30_000,
  });

  const { data: pushedIdsArray = [] } = trpc.journal.pushedIds.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 30_000,
  });

  const pushedIds = useMemo(() => new Set(pushedIdsArray), [pushedIdsArray]);

  const createEntry = trpc.journal.create.useMutation({
    onSuccess: () => {
      utils.journal.list.invalidate();
      utils.journal.pushedIds.invalidate();
    },
  });

  // ─── Push to journal ────────────────────────────────────────────────────────
  const handlePushToJournal = useCallback(
    (setup: ScreenerSetup) => {
      if (!isAuthenticated) {
        toast.error("Please log in to use the journal", {
          action: { label: "Log In", onClick: () => { window.location.assign(getLoginUrl()); } },
        });
        return;
      }
      if (pushedIds.has(setup.id)) {
        toast.info(`${setup.symbol} ${setup.setupType} already in journal`);
        return;
      }
      createEntry.mutate(
        {
          setupId: setup.id,
          symbol: setup.symbol,
          assetClass: setup.assetClass,
          setupType: setup.setupType,
          quality: setup.quality,
          pattern: setup.pattern,
          timeframe: setup.timeframe,
          levels: setup.levels,
          rrRatio: setup.rrRatio,
          confluences: setup.confluences,
          tags: [setup.quality.toLowerCase(), setup.setupType.toLowerCase(), setup.timeframe.toLowerCase()],
          sector: setup.sector,
          ivRank: setup.ivRank,
          session: setup.session,
        },
        {
          onSuccess: () => {
            toast.success(`${setup.symbol} ${setup.setupType} pushed to journal`, {
              description: `Entry: ${setup.levels.entry} | SL: ${setup.levels.stopLoss} | TP: ${setup.levels.takeProfit}`,
              action: { label: "View Journal", onClick: () => setActiveTab("journal") },
            });
          },
          onError: () => {
            toast.error("Failed to push to journal");
          },
        }
      );
    },
    [isAuthenticated, pushedIds, createEntry]
  );

  const toggleAutoPush = () => {
    if (!isAuthenticated) {
      toast.error("Please log in to use Auto-Push", {
        action: { label: "Log In", onClick: () => { window.location.assign(getLoginUrl()); } },
      });
      return;
    }
    setAutoPush((prev) => {
      const next = !prev;
      toast(next ? "Auto-Push Enabled" : "Auto-Push Disabled", {
        description: next
          ? "Premium setups will be automatically pushed to your journal"
          : "Manual push mode — click 'Push to Journal' on each setup",
        icon: next ? "⚡" : "📖",
      });
      return next;
    });
  };

  const journalCount = journalEntries.length;
  const pendingCount = journalEntries.filter((e) => e.outcome === "PENDING").length;

  return (
    <div className="min-h-screen bg-[#0A0D12] text-white flex overflow-hidden">
      {/* Sidebar */}
      <aside
        className={cn(
          "hidden md:flex flex-col border-r border-slate-800/60 bg-[#080B10] transition-all duration-300 flex-shrink-0",
          sidebarCollapsed ? "w-16" : "w-56"
        )}
      >
        {/* Logo */}
        <div className={cn("p-4 border-b border-slate-800/60", sidebarCollapsed ? "px-3" : "")}>
          <div className={cn("flex items-center gap-2.5", sidebarCollapsed ? "justify-center" : "")}>
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#00FF88]/20 to-[#60A5FA]/20 border border-[#00FF88]/20 flex items-center justify-center flex-shrink-0">
              <BarChart3 className="w-4 h-4 text-[#00FF88]" />
            </div>
            {!sidebarCollapsed && (
              <div>
                <div className="font-bold text-white text-sm leading-none">PremiumScan</div>
                <div className="text-[10px] text-slate-500 font-mono mt-0.5">TRADING SCREENER</div>
              </div>
            )}
          </div>
        </div>

        {/* Live Indicator */}
        {!sidebarCollapsed && (
          <div className="px-4 py-2 border-b border-slate-800/40">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#00FF88] animate-pulse" />
              <span className="text-[10px] font-mono text-[#00FF88]/70 uppercase tracking-widest">Live Scanning</span>
            </div>
          </div>
        )}

        {/* Nav Items */}
        <nav className="flex-1 p-2 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={cn(
                  "w-full flex items-center gap-3 rounded-lg border transition-all duration-150",
                  sidebarCollapsed ? "p-2 justify-center" : "px-3 py-2.5",
                  isActive
                    ? cn("border", item.activeBg, item.activeText)
                    : "border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-800/40"
                )}
                title={sidebarCollapsed ? item.label : undefined}
              >
                <Icon className={cn("w-4 h-4 flex-shrink-0", isActive ? item.color : "")} />
                {!sidebarCollapsed && (
                  <div className="flex-1 text-left min-w-0">
                    <div className="text-sm font-medium leading-none">{item.shortLabel}</div>
                    <div className="text-[10px] text-slate-600 mt-0.5">{item.description}</div>
                  </div>
                )}
                {!sidebarCollapsed && item.id === "journal" && journalCount > 0 && (
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] px-1.5 py-0 min-w-[20px] justify-center border",
                      pendingCount > 0
                        ? "border-[#F5A623]/30 text-[#F5A623] bg-[#F5A623]/10"
                        : "border-slate-700 text-slate-400"
                    )}
                  >
                    {journalCount}
                  </Badge>
                )}
              </button>
            );
          })}
        </nav>

        {/* Auto-Push Toggle */}
        <div className={cn("p-3 border-t border-slate-800/60", sidebarCollapsed ? "px-2" : "")}>
          {!sidebarCollapsed ? (
            <div className="bg-[#0D1117] rounded-lg border border-slate-800 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <Zap className={cn("w-3.5 h-3.5", autoPush ? "text-[#F5A623]" : "text-slate-500")} />
                  <span className="text-xs font-medium text-slate-300">Auto-Push</span>
                </div>
                <button
                  onClick={toggleAutoPush}
                  className={cn(
                    "relative w-9 h-5 rounded-full border transition-all duration-200",
                    autoPush ? "bg-[#F5A623]/20 border-[#F5A623]/40" : "bg-slate-800 border-slate-700"
                  )}
                >
                  <div
                    className={cn(
                      "absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200",
                      autoPush ? "left-4 bg-[#F5A623]" : "left-0.5 bg-slate-500"
                    )}
                  />
                </button>
              </div>
              <p className="text-[10px] text-slate-600 leading-relaxed">
                {autoPush ? "Premium setups auto-pushed to journal" : "Manually push setups to journal"}
              </p>
            </div>
          ) : (
            <button
              onClick={toggleAutoPush}
              className={cn(
                "w-full flex items-center justify-center p-2 rounded-lg border transition-all",
                autoPush
                  ? "bg-[#F5A623]/10 border-[#F5A623]/30 text-[#F5A623]"
                  : "bg-slate-800/40 border-slate-700 text-slate-500"
              )}
              title="Toggle Auto-Push"
            >
              <Zap className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* User / Auth */}
        <div className={cn("p-3 border-t border-slate-800/40", sidebarCollapsed ? "px-2" : "")}>
          {isAuthenticated && user ? (
            !sidebarCollapsed ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-6 h-6 rounded-full bg-[#00FF88]/10 border border-[#00FF88]/20 flex items-center justify-center flex-shrink-0">
                    <User className="w-3 h-3 text-[#00FF88]" />
                  </div>
                  <span className="text-xs text-slate-400 truncate">{user.name || user.email || "Trader"}</span>
                </div>
                <button
                  onClick={() => logout()}
                  className="p-1 text-slate-600 hover:text-slate-400 transition-colors"
                  title="Log out"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => logout()}
                className="w-full flex items-center justify-center p-2 rounded-lg text-slate-600 hover:text-slate-400 transition-colors"
                title="Log out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )
          ) : (
            <a
              href={getLoginUrl()}
              className={cn(
                "w-full flex items-center gap-2 rounded-lg border border-[#00FF88]/20 bg-[#00FF88]/5 text-[#00FF88] hover:bg-[#00FF88]/10 transition-all no-underline",
                sidebarCollapsed ? "p-2 justify-center" : "px-3 py-2"
              )}
              title="Log in to sync journal"
            >
              <LogIn className="w-4 h-4 flex-shrink-0" />
              {!sidebarCollapsed && <span className="text-xs font-medium">Log In to Sync</span>}
            </a>
          )}
        </div>

        {/* Collapse Toggle */}
        <div className="p-2 border-t border-slate-800/40">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="w-full flex items-center justify-center p-1.5 rounded-md text-slate-600 hover:text-slate-400 hover:bg-slate-800/40 transition-all"
          >
            {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Bar */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-slate-800/60 bg-[#080B10]/80 backdrop-blur-sm flex-shrink-0">
          {/* Mobile: Logo + Menu */}
          <div className="flex items-center gap-3 md:hidden">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-[#00FF88]" />
              <span className="font-bold text-sm">PremiumScan</span>
            </div>
          </div>

          {/* Desktop: Breadcrumb */}
          <div className="hidden md:flex items-center gap-2">
            <Activity className="w-4 h-4 text-slate-500" />
            <span className="text-slate-500 text-sm">/</span>
            <span className="text-sm font-medium text-white">
              {NAV_ITEMS.find((n) => n.id === activeTab)?.label}
            </span>
          </div>

          {/* Right: Status + Auth + Auto-Push */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500">
              <div className="w-1.5 h-1.5 rounded-full bg-[#00FF88] animate-pulse" />
              <span className="font-mono">Markets Open</span>
            </div>

            {/* Mobile Auto-Push Toggle */}
            <div className="flex items-center gap-2 md:hidden">
              <span className="text-xs text-slate-500">Auto-Push</span>
              <button
                onClick={toggleAutoPush}
                className={cn(
                  "relative w-9 h-5 rounded-full border transition-all duration-200",
                  autoPush ? "bg-[#F5A623]/20 border-[#F5A623]/40" : "bg-slate-800 border-slate-700"
                )}
              >
                <div
                  className={cn(
                    "absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200",
                    autoPush ? "left-4 bg-[#F5A623]" : "left-0.5 bg-slate-500"
                  )}
                />
              </button>
            </div>

            {autoPush && (
              <Badge variant="outline" className="text-[10px] border-[#F5A623]/30 text-[#F5A623] bg-[#F5A623]/5 hidden sm:flex">
                <Zap className="w-2.5 h-2.5 mr-1" />
                Auto-Push ON
              </Badge>
            )}

            {journalCount > 0 && (
              <button
                onClick={() => setActiveTab("journal")}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-[#F5A623] transition-colors"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span className="font-mono">{journalCount}</span>
              </button>
            )}

            {/* Desktop auth button */}
            {!isAuthenticated && (
              <a
                href={getLoginUrl()}
                className="hidden md:flex items-center gap-1.5 text-xs border border-[#00FF88]/20 bg-[#00FF88]/5 text-[#00FF88] hover:bg-[#00FF88]/10 px-2.5 py-1.5 rounded-md transition-all no-underline"
              >
                <LogIn className="w-3.5 h-3.5" />
                Log In
              </a>
            )}
          </div>
        </header>

        {/* Mobile Nav */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-[#080B10] border-b border-slate-800 px-3 py-2 flex gap-2">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => { setActiveTab(item.id); setMobileMenuOpen(false); }}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border text-xs font-medium transition-all",
                    isActive
                      ? cn("border", item.activeBg, item.activeText)
                      : "border-slate-800 text-slate-500"
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {item.shortLabel}
                </button>
              );
            })}
          </div>
        )}

        {/* Mobile Bottom Nav */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#080B10] border-t border-slate-800 flex">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={cn(
                  "flex-1 flex flex-col items-center justify-center py-3 gap-1 transition-all",
                  isActive ? item.activeText : "text-slate-600"
                )}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium">{item.shortLabel}</span>
                {item.id === "journal" && journalCount > 0 && (
                  <div className={cn("w-1.5 h-1.5 rounded-full", item.dot)} />
                )}
              </button>
            );
          })}
        </div>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-5 pb-20 md:pb-5">
          {activeTab === "stocks" && (
            <StockScanPage
              onPushToJournal={handlePushToJournal}
              pushedIds={pushedIds}
              autoPush={autoPush}
            />
          )}
          {activeTab === "forex" && (
            <ForexScreener
              onPushToJournal={handlePushToJournal}
              pushedIds={pushedIds}
              autoPush={autoPush}
              onSwitchToWatchlist={() => setActiveTab("watchlist")}
            />
          )}
          {activeTab === "journal" && (
            <Journal
              entries={journalEntries}
              onRefetch={refetchJournal}
              isAuthenticated={isAuthenticated}
              onLoginClick={() => { window.location.assign(getLoginUrl()); }}
            />
          )}
          {activeTab === "alerts" && <Alerts />}
          {activeTab === "analytics" && <Analytics />}
          {activeTab === "watchlist" && <WatchlistPage onSwitchToJournal={() => setActiveTab("journal")} />}
          {activeTab === "calculator" && <Calculator />}
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster richColors position="top-right" />
          <AppShell />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
