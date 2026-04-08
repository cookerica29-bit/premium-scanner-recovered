// ============================================================
// TRADING SCREENER — Core Types & Data Models
// Design: Dark Terminal / Bloomberg-Inspired Data Dashboard
// Colors: #0A0D12 bg, #00FF88 bullish, #FF3B5C bearish, #F5A623 neutral
// ============================================================

export type SetupType = "CALL" | "PUT" | "LONG" | "SHORT";
export type SetupQuality = "PREMIUM" | "STRONG" | "DEVELOPING";
export type SetupStatus = "ACTIVE" | "TRIGGERED" | "INVALIDATED" | "CLOSED";
export type AssetClass = "STOCK" | "FOREX";

export interface PriceLevel {
  entry: number;
  stopLoss: number;
  takeProfit: number;
  takeProfit2?: number;
  takeProfit3?: number;
}

export interface Setup {
  id: string;
  symbol: string;
  assetClass: AssetClass;
  setupType: SetupType;
  quality: SetupQuality;
  status: SetupStatus;
  timeframe: string;
  pattern: string;
  description: string;
  levels: PriceLevel;
  rrRatio: number;
  rrRatio2?: number;
  rrRatio3?: number;
  confluences: string[];
  scannedAt: Date;
  pushedToJournal: boolean;
  // For stocks
  sector?: string;
  marketCap?: string;
  volume?: number;
  avgVolume?: number;
  ivRank?: number; // Implied Volatility Rank for options
  // For forex
  session?: string;
  pipValue?: number;
}

export interface JournalEntry {
  id: string;
  setupId: string;
  symbol: string;
  assetClass: AssetClass;
  setupType: SetupType;
  quality: SetupQuality;
  pattern: string;
  timeframe: string;
  levels: PriceLevel;
  rrRatio: number;
  confluences: string[];
  notes: string;
  outcome?: "WIN" | "LOSS" | "BREAKEVEN" | "PENDING";
  pnl?: number;
  pnlPercent?: number;
  entryDate?: Date;
  exitDate?: Date;
  pushedAt: Date;
  tags: string[];
  // For stocks
  sector?: string;
  ivRank?: number;
  // For forex
  session?: string;
}

export interface ScreenerFilters {
  quality: SetupQuality[];
  setupType: SetupType[];
  timeframes: string[];
  minRR: number;
  sessions?: string[];
  sectors?: string[];
}

export interface ScanStats {
  totalScanned: number;
  premiumSetups: number;
  strongSetups: number;
  developingSetups: number;
  lastScanTime: Date;
  isScanning: boolean;
}
