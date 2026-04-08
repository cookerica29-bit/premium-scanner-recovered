// ============================================================
// SYMBOL MANAGER — Add/Remove/Toggle stocks and forex pairs
// Used in both StockScreener and ForexScreener
// ============================================================

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Settings2, Plus, Trash2, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface SymbolManagerProps {
  assetClass: "stock" | "forex";
  onSymbolsChanged?: () => void;
}

export default function SymbolManager({ assetClass, onSymbolsChanged }: SymbolManagerProps) {
  const [open, setOpen] = useState(false);
  const [newSymbol, setNewSymbol] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [search, setSearch] = useState("");

  const utils = trpc.useUtils();

  const { data: symbols = [], isLoading } = trpc.symbols.list.useQuery(
    { assetClass },
    { enabled: open }
  );

  const addMutation = trpc.symbols.add.useMutation({
    onSuccess: (data) => {
      if (data.duplicate) {
        toast.warning(data.message ?? "Symbol already exists");
      } else {
        toast.success(`${newSymbol.toUpperCase()} added to ${assetClass} screener`);
        setNewSymbol("");
        setNewLabel("");
        utils.symbols.list.invalidate({ assetClass });
        onSymbolsChanged?.();
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const removeMutation = trpc.symbols.remove.useMutation({
    onSuccess: () => {
      utils.symbols.list.invalidate({ assetClass });
      onSymbolsChanged?.();
    },
    onError: (err) => toast.error(err.message),
  });

  const toggleMutation = trpc.symbols.toggle.useMutation({
    onSuccess: () => {
      utils.symbols.list.invalidate({ assetClass });
      onSymbolsChanged?.();
    },
    onError: (err) => toast.error(err.message),
  });

  const toggleDefaultMutation = trpc.symbols.toggleDefault.useMutation({
    onSuccess: () => {
      utils.symbols.list.invalidate({ assetClass });
      onSymbolsChanged?.();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleAdd = () => {
    const sym = newSymbol.trim().toUpperCase();
    if (!sym) return;
    addMutation.mutate({ assetClass, symbol: sym, label: newLabel.trim() || sym });
  };

  const handleRemove = (id: number | null, symbol: string, isDefault: boolean) => {
    if (isDefault && id === null) {
      // Default symbol with no DB row — need to create a disabled row
      // We just toggle it off which will create the row
      toast.info(`${symbol} is a default symbol. Use the toggle to disable it instead.`);
      return;
    }
    if (id === null) return;
    removeMutation.mutate({ id });
    toast.success(`${symbol} removed from screener`);
  };

  const handleToggle = (id: number | null, symbol: string, isDefault: boolean, currentEnabled: number) => {
    const newEnabled = currentEnabled === 0;
    if (id === null && isDefault) {
      // Create a DB override row for this default symbol with the desired enabled state
      toggleDefaultMutation.mutate({ assetClass, symbol, enabled: newEnabled });
      toast.success(`${symbol} ${newEnabled ? "enabled" : "disabled"}`);
      return;
    }
    if (id === null) return;
    toggleMutation.mutate({ id, enabled: newEnabled });
    toast.success(`${symbol} ${newEnabled ? "enabled" : "disabled"}`);
  };

  const filtered = symbols.filter(
    (s) =>
      s.symbol.toLowerCase().includes(search.toLowerCase()) ||
      s.label.toLowerCase().includes(search.toLowerCase())
  );

  const enabledCount = symbols.filter((s) => s.enabled !== 0).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 border-slate-700 bg-slate-800/60 text-slate-300 hover:text-white hover:bg-slate-700 hover:border-slate-600 text-xs"
        >
          <Settings2 className="w-3.5 h-3.5" />
          Manage Symbols
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 border-slate-600 text-slate-400 ml-1"
          >
            {enabledCount}
          </Badge>
        </Button>
      </DialogTrigger>

      <DialogContent className="bg-[#0D1117] border-slate-700 text-white max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Settings2 className="w-4 h-4 text-[#60A5FA]" />
            Manage {assetClass === "forex" ? "Forex Pairs" : "Stock Symbols"}
          </DialogTitle>
        </DialogHeader>

        {/* Add new symbol */}
        <div className="flex gap-2 mt-2">
          <Input
            placeholder={assetClass === "forex" ? "e.g. USD/CAD" : "e.g. MSFT"}
            value={newSymbol}
            onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            className="bg-slate-800/60 border-slate-700 text-white placeholder:text-slate-500 text-sm h-9 font-mono"
          />
          <Input
            placeholder="Display name (optional)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            className="bg-slate-800/60 border-slate-700 text-white placeholder:text-slate-500 text-sm h-9"
          />
          <Button
            onClick={handleAdd}
            disabled={!newSymbol.trim() || addMutation.isPending}
            size="sm"
            className="bg-[#00FF88]/10 border border-[#00FF88]/30 text-[#00FF88] hover:bg-[#00FF88]/20 h-9 px-3 flex-shrink-0"
          >
            {addMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
          </Button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <Input
            placeholder="Search symbols..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-slate-800/40 border-slate-700/60 text-white placeholder:text-slate-500 text-sm h-8 pl-8"
          />
        </div>

        {/* Symbol list */}
        <div className="flex-1 overflow-y-auto space-y-1 min-h-0 pr-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-sm">No symbols found</div>
          ) : (
            filtered.map((sym) => (
              <div
                key={sym.symbol}
                className={cn(
                  "flex items-center justify-between px-3 py-2 rounded-lg border transition-all",
                  sym.enabled !== 0
                    ? "bg-slate-800/40 border-slate-700/60"
                    : "bg-slate-900/40 border-slate-800/40 opacity-50"
                )}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className={cn(
                      "w-1.5 h-1.5 rounded-full flex-shrink-0",
                      sym.enabled !== 0 ? "bg-[#00FF88]" : "bg-slate-600"
                    )}
                  />
                  <span className="font-mono text-sm text-white font-medium">{sym.symbol}</span>
                  {sym.label !== sym.symbol && (
                    <span className="text-xs text-slate-500 truncate">{sym.label}</span>
                  )}
                  {sym.isDefault && (
                    <Badge
                      variant="outline"
                      className="text-[9px] px-1 py-0 border-slate-700 text-slate-600 flex-shrink-0"
                    >
                      default
                    </Badge>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* Toggle enable/disable */}
                  <span className={cn(
                    "text-[10px] font-mono font-bold uppercase tracking-wider w-6 text-right",
                    sym.enabled !== 0 ? "text-[#00FF88]" : "text-slate-600"
                  )}>
                    {sym.enabled !== 0 ? "ON" : "OFF"}
                  </span>
                  <Switch
                    checked={sym.enabled !== 0}
                    onCheckedChange={() => handleToggle(sym.id, sym.symbol, sym.isDefault, sym.enabled)}
                    disabled={toggleMutation.isPending || addMutation.isPending || toggleDefaultMutation.isPending}
                    className="data-[state=checked]:bg-[#00FF88]"
                  />

                  {/* Remove — only for custom (non-default) symbols */}
                  {!sym.isDefault && sym.id !== null && (
                    <button
                      onClick={() => handleRemove(sym.id, sym.symbol, sym.isDefault)}
                      disabled={removeMutation.isPending}
                      className="p-1.5 rounded-md text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all"
                      title="Remove symbol"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="text-xs text-slate-600 pt-2 border-t border-slate-800">
          {enabledCount} of {symbols.length} symbols active •{" "}
          {assetClass === "forex"
            ? "Default pairs can be disabled but not removed"
            : "Default stocks can be disabled but not removed"}
        </div>
      </DialogContent>
    </Dialog>
  );
}
