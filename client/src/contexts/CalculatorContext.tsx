import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type CalcSetupPayload = {
  symbol: string;
  displaySymbol: string;
  assetClass: "FOREX" | "STOCK";
  direction: "LONG" | "SHORT" | "CALL" | "PUT";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  takeProfit2?: number;
  takeProfit3?: number;
  rrRatio: number;
  pattern: string;
  timeframe: string;
};

interface CalculatorContextValue {
  pendingSetups: CalcSetupPayload[];
  pushToCalculator: (setup: CalcSetupPayload) => void;
  consumeSetups: () => CalcSetupPayload[];
}

const CalculatorContext = createContext<CalculatorContextValue | null>(null);

export function CalculatorProvider({ children }: { children: ReactNode }) {
  const [pendingSetups, setPendingSetups] = useState<CalcSetupPayload[]>([]);

  const pushToCalculator = useCallback((setup: CalcSetupPayload) => {
    setPendingSetups((prev) => {
      // Avoid duplicates by id (symbol + timeframe)
      const key = `${setup.symbol}-${setup.timeframe}`;
      const exists = prev.some((s) => `${s.symbol}-${s.timeframe}` === key);
      if (exists) return prev;
      return [setup, ...prev];
    });
  }, []);

  const consumeSetups = useCallback((): CalcSetupPayload[] => {
    const current = pendingSetups;
    setPendingSetups([]);
    return current;
  }, [pendingSetups]);

  return (
    <CalculatorContext.Provider value={{ pendingSetups, pushToCalculator, consumeSetups }}>
      {children}
    </CalculatorContext.Provider>
  );
}

export function useCalculator() {
  const ctx = useContext(CalculatorContext);
  if (!ctx) throw new Error("useCalculator must be used within CalculatorProvider");
  return ctx;
}
