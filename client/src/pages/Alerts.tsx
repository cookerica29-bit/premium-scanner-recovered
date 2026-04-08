/**
 * Price Alerts Page
 * Set and manage entry proximity alerts for any setup.
 * Alerts are stored in the cloud DB and checked client-side via polling.
 * Browser push notifications fire when price enters the alert zone.
 */

import { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Bell, BellOff, Trash2, TrendingUp, TrendingDown,
  Plus, AlertCircle, Loader2, CheckCircle2, Clock,
  BarChart2, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type AlertRow = {
  id: number;
  symbol: string;
  displaySymbol: string;
  assetClass: "STOCK" | "FOREX";
  direction: "LONG" | "SHORT" | "CALL" | "PUT";
  targetPrice: string;
  currentPrice: string;
  proximityPct: string;
  timeframe: string;
  pattern: string | null;
  notes: string | null;
  isActive: number;
  isTriggered: number;
  triggeredAt: Date | null;
  createdAt: Date;
};

function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function fireNotification(title: string, body: string) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, icon: "/favicon.ico" });
  }
}

function AlertCard({
  alert,
  onDelete,
  onToggle,
}: {
  alert: AlertRow;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const isLong = alert.direction === "LONG" || alert.direction === "CALL";
  const targetPrice = parseFloat(alert.targetPrice);
  const currentPrice = parseFloat(alert.currentPrice);
  const proximityPct = parseFloat(alert.proximityPct);
  const pctFromTarget = currentPrice > 0
    ? Math.abs((currentPrice - targetPrice) / targetPrice) * 100
    : 0;
  const isNear = pctFromTarget <= proximityPct;
  const fmt = (n: number) => n > 100 ? n.toFixed(2) : n.toFixed(5);

  return (
    <div className={cn(
      "rounded-xl border bg-[#0D1117] p-4 transition-all",
      alert.isTriggered
        ? "border-[#00FF88]/30 bg-[#00FF88]/5"
        : isNear && alert.isActive
        ? "border-[#F5A623]/40 shadow-[0_0_16px_rgba(245,166,35,0.12)]"
        : alert.isActive
        ? "border-slate-700"
        : "border-slate-800 opacity-60"
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0",
            isLong ? "bg-[#00FF88]/10" : "bg-[#FF3B5C]/10"
          )}>
            {isLong
              ? <TrendingUp className="w-4 h-4 text-[#00FF88]" />
              : <TrendingDown className="w-4 h-4 text-[#FF3B5C]" />}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono font-bold text-white">{alert.displaySymbol}</span>
              <Badge variant="outline" className={cn(
                "text-[10px] px-1.5 py-0 border",
                isLong ? "border-[#00FF88]/30 text-[#00FF88] bg-[#00FF88]/5" : "border-[#FF3B5C]/30 text-[#FF3B5C] bg-[#FF3B5C]/5"
              )}>
                {alert.direction}
              </Badge>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-slate-700 text-slate-400">
                {alert.timeframe}
              </Badge>
              {alert.isTriggered && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-[#00FF88]/30 text-[#00FF88] bg-[#00FF88]/10">
                  <CheckCircle2 className="w-2.5 h-2.5 mr-1" />TRIGGERED
                </Badge>
              )}
              {isNear && alert.isActive && !alert.isTriggered && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-[#F5A623]/40 text-[#F5A623] bg-[#F5A623]/10 animate-pulse">
                  <Zap className="w-2.5 h-2.5 mr-1" />NEAR ENTRY
                </Badge>
              )}
            </div>
            {alert.pattern && (
              <div className="text-xs text-slate-500 mt-0.5">{alert.pattern}</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={onToggle}
            className={cn(
              "p-1.5 rounded-md transition-all",
              alert.isActive
                ? "text-[#00FF88] hover:bg-[#00FF88]/10"
                : "text-slate-600 hover:text-slate-400 hover:bg-slate-800"
            )}
            title={alert.isActive ? "Disable alert" : "Enable alert"}
          >
            {alert.isActive ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-md text-slate-600 hover:text-[#FF3B5C] hover:bg-[#FF3B5C]/10 transition-all"
            title="Delete alert"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Price levels */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="bg-[#080B10] rounded-lg p-2.5 border border-slate-800">
          <div className="text-[10px] text-slate-600 uppercase font-mono mb-1">Target Entry</div>
          <div className="font-mono font-semibold text-white text-sm">{fmt(targetPrice)}</div>
        </div>
        <div className="bg-[#080B10] rounded-lg p-2.5 border border-slate-800">
          <div className="text-[10px] text-slate-600 uppercase font-mono mb-1">Last Price</div>
          <div className="font-mono font-semibold text-slate-300 text-sm">{fmt(currentPrice)}</div>
        </div>
        <div className={cn(
          "rounded-lg p-2.5 border",
          isNear ? "bg-[#F5A623]/10 border-[#F5A623]/30" : "bg-[#080B10] border-slate-800"
        )}>
          <div className={cn("text-[10px] uppercase font-mono mb-1", isNear ? "text-[#F5A623]/70" : "text-slate-600")}>
            Distance
          </div>
          <div className={cn("font-mono font-semibold text-sm", isNear ? "text-[#F5A623]" : "text-slate-400")}>
            {pctFromTarget.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Proximity threshold */}
      <div className="mt-2 flex items-center gap-2">
        <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              isNear ? "bg-[#F5A623]" : "bg-[#60A5FA]"
            )}
            style={{ width: `${Math.min(100, (proximityPct / Math.max(pctFromTarget, proximityPct)) * 100)}%` }}
          />
        </div>
        <span className="text-[10px] text-slate-600 font-mono whitespace-nowrap">
          Alert at ≤{proximityPct}%
        </span>
      </div>

      {alert.notes && (
        <div className="mt-2 text-xs text-slate-500 italic">{alert.notes}</div>
      )}
      <div className="mt-2 text-[10px] text-slate-700 font-mono flex items-center gap-1">
        <Clock className="w-3 h-3" />
        Set {new Date(alert.createdAt).toLocaleDateString()}
        {alert.triggeredAt && ` · Triggered ${new Date(alert.triggeredAt).toLocaleString()}`}
      </div>
    </div>
  );
}

export default function Alerts() {
  const { isAuthenticated, loading } = useAuth();
  const utils = trpc.useUtils();

  const { data: alerts = [], isLoading } = trpc.alerts.list.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 60_000, // poll every 60s to check proximity
  });

  const createAlert = trpc.alerts.create.useMutation({
    onSuccess: () => {
      utils.alerts.list.invalidate();
      toast.success("Alert created");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteAlert = trpc.alerts.delete.useMutation({
    onSuccess: () => {
      utils.alerts.list.invalidate();
      toast.success("Alert deleted");
    },
  });

  const toggleAlert = trpc.alerts.toggle.useMutation({
    onSuccess: () => utils.alerts.list.invalidate(),
  });

  // Request browser notification permission on mount
  useEffect(() => {
    requestNotificationPermission();
  }, []);

  // Check for near-entry alerts and fire browser notifications
  useEffect(() => {
    if (!alerts.length) return;
    for (const alert of alerts) {
      if (!alert.isActive || alert.isTriggered) continue;
      const target = parseFloat(alert.targetPrice);
      const current = parseFloat(alert.currentPrice);
      const pct = parseFloat(alert.proximityPct);
      const dist = Math.abs((current - target) / target) * 100;
      if (dist <= pct) {
        fireNotification(
          `🔔 ${alert.displaySymbol} Near Entry!`,
          `${alert.direction} setup at ${target.toFixed(5)} — price is within ${dist.toFixed(2)}% of entry`
        );
      }
    }
  }, [alerts]);

  const activeAlerts = alerts.filter((a) => a.isActive && !a.isTriggered);
  const triggeredAlerts = alerts.filter((a) => a.isTriggered);
  const inactiveAlerts = alerts.filter((a) => !a.isActive && !a.isTriggered);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-[#60A5FA] animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Bell className="w-12 h-12 text-slate-600" />
        <div className="text-center">
          <h3 className="text-white font-semibold mb-1">Sign in to use Price Alerts</h3>
          <p className="text-slate-500 text-sm">Alerts sync across all your devices</p>
        </div>
        <Button
          onClick={() => window.location.assign(getLoginUrl())}
          className="bg-[#60A5FA] text-black hover:bg-[#60A5FA]/90"
        >
          Log In
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col space-y-4">
      {/* Header */}
      <div className="relative overflow-hidden rounded-xl border border-slate-800" style={{ minHeight: 100 }}>
        <div className="absolute inset-0 bg-gradient-to-r from-[#0A0D12] to-[#0D1117]" />
        <div className="relative z-10 p-5 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full bg-[#F5A623] animate-pulse" />
              <span className="text-[11px] text-[#F5A623] font-mono uppercase tracking-widest">Price Alert Monitor</span>
            </div>
            <h2 className="text-xl font-bold text-white">Price Alerts</h2>
            <p className="text-slate-400 text-sm mt-0.5">Get notified when price approaches your entry zone</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-center">
              <div className="text-xl font-bold font-mono text-[#F5A623]">{activeAlerts.length}</div>
              <div className="text-[10px] text-slate-500">Active</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold font-mono text-[#00FF88]">{triggeredAlerts.length}</div>
              <div className="text-[10px] text-slate-500">Triggered</div>
            </div>
          </div>
        </div>
      </div>

      {/* Notification permission banner */}
      {"Notification" in window && Notification.permission === "default" && (
        <div className="flex items-center gap-3 bg-[#F5A623]/10 border border-[#F5A623]/30 rounded-lg px-4 py-3">
          <Bell className="w-4 h-4 text-[#F5A623] flex-shrink-0" />
          <p className="text-sm text-[#F5A623] flex-1">Enable browser notifications to receive alerts when price approaches your entry</p>
          <Button
            size="sm"
            onClick={() => Notification.requestPermission().then(() => toast.success("Notifications enabled!"))}
            className="bg-[#F5A623] text-black hover:bg-[#F5A623]/90 text-xs h-7"
          >
            Enable
          </Button>
        </div>
      )}

      {/* How to add alerts */}
      <div className="bg-[#0D1117] border border-slate-800 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#60A5FA]/10 flex items-center justify-center flex-shrink-0">
            <BarChart2 className="w-4 h-4 text-[#60A5FA]" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white mb-1">How to Set Alerts</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Click the <strong className="text-[#F5A623]">Set Alert</strong> button on any setup card in the Stock or Forex screener. 
              Alerts fire a browser notification when the current price comes within your chosen proximity % of the entry price. 
              All alerts sync across your devices.
            </p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 text-[#F5A623] animate-spin" />
        </div>
      ) : alerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Bell className="w-10 h-10 text-slate-700" />
          <div className="text-slate-400 text-sm">No alerts set yet</div>
          <div className="text-slate-600 text-xs text-center max-w-sm">
            Go to the Stock or Forex screener, find a setup you like, and click "Set Alert" to get notified when price approaches the entry zone.
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Active alerts */}
          {activeAlerts.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Bell className="w-4 h-4 text-[#F5A623]" />
                <h3 className="text-sm font-semibold text-white">Active Alerts</h3>
                <Badge variant="outline" className="text-[10px] border-[#F5A623]/30 text-[#F5A623]">{activeAlerts.length}</Badge>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                {activeAlerts.map((alert) => (
                  <AlertCard
                    key={alert.id}
                    alert={alert as AlertRow}
                    onDelete={() => deleteAlert.mutate({ id: alert.id })}
                    onToggle={() => toggleAlert.mutate({ id: alert.id, isActive: !alert.isActive })}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Triggered alerts */}
          {triggeredAlerts.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="w-4 h-4 text-[#00FF88]" />
                <h3 className="text-sm font-semibold text-white">Triggered</h3>
                <Badge variant="outline" className="text-[10px] border-[#00FF88]/30 text-[#00FF88]">{triggeredAlerts.length}</Badge>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                {triggeredAlerts.map((alert) => (
                  <AlertCard
                    key={alert.id}
                    alert={alert as AlertRow}
                    onDelete={() => deleteAlert.mutate({ id: alert.id })}
                    onToggle={() => toggleAlert.mutate({ id: alert.id, isActive: !alert.isActive })}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Inactive alerts */}
          {inactiveAlerts.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <BellOff className="w-4 h-4 text-slate-500" />
                <h3 className="text-sm font-semibold text-slate-400">Paused</h3>
                <Badge variant="outline" className="text-[10px] border-slate-700 text-slate-500">{inactiveAlerts.length}</Badge>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                {inactiveAlerts.map((alert) => (
                  <AlertCard
                    key={alert.id}
                    alert={alert as AlertRow}
                    onDelete={() => deleteAlert.mutate({ id: alert.id })}
                    onToggle={() => toggleAlert.mutate({ id: alert.id, isActive: !alert.isActive })}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
