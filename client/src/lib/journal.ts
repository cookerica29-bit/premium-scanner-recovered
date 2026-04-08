// ============================================================
// JOURNAL ENGINE
// Manages journal entries with localStorage persistence
// Design: Dark Terminal / Bloomberg-Inspired
// ============================================================

import { nanoid } from "nanoid";
import type { Setup, JournalEntry } from "./types";

const JOURNAL_KEY = "trading-screener-journal";

export function loadJournal(): JournalEntry[] {
  try {
    const raw = localStorage.getItem(JOURNAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return parsed.map((entry: JournalEntry) => ({
      ...entry,
      pushedAt: new Date(entry.pushedAt),
      entryDate: entry.entryDate ? new Date(entry.entryDate) : undefined,
      exitDate: entry.exitDate ? new Date(entry.exitDate) : undefined,
    }));
  } catch {
    return [];
  }
}

export function saveJournal(entries: JournalEntry[]): void {
  try {
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(entries));
  } catch {
    console.error("Failed to save journal");
  }
}

export function pushSetupToJournal(setup: Setup, existingEntries: JournalEntry[]): JournalEntry[] {
  // Check if already pushed
  const alreadyExists = existingEntries.some((e) => e.setupId === setup.id);
  if (alreadyExists) return existingEntries;

  const entry: JournalEntry = {
    id: nanoid(),
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
    notes: "",
    outcome: "PENDING",
    pushedAt: new Date(),
    tags: [setup.quality, setup.setupType, setup.timeframe],
    sector: setup.sector,
    ivRank: setup.ivRank,
    session: setup.session,
  };

  const updated = [entry, ...existingEntries];
  saveJournal(updated);
  return updated;
}

export function updateJournalEntry(
  id: string,
  updates: Partial<JournalEntry>,
  entries: JournalEntry[]
): JournalEntry[] {
  const updated = entries.map((e) => (e.id === id ? { ...e, ...updates } : e));
  saveJournal(updated);
  return updated;
}

export function deleteJournalEntry(id: string, entries: JournalEntry[]): JournalEntry[] {
  const updated = entries.filter((e) => e.id !== id);
  saveJournal(updated);
  return updated;
}

export function getJournalStats(entries: JournalEntry[]) {
  const closed = entries.filter((e) => e.outcome && e.outcome !== "PENDING");
  const wins = closed.filter((e) => e.outcome === "WIN").length;
  const losses = closed.filter((e) => e.outcome === "LOSS").length;
  const breakevens = closed.filter((e) => e.outcome === "BREAKEVEN").length;
  const pending = entries.filter((e) => e.outcome === "PENDING").length;
  const winRate = closed.length > 0 ? ((wins / closed.length) * 100).toFixed(1) : "0.0";
  const totalPnl = entries.reduce((sum, e) => sum + (e.pnl || 0), 0);

  return {
    total: entries.length,
    wins,
    losses,
    breakevens,
    pending,
    winRate,
    totalPnl: totalPnl.toFixed(2),
    closed: closed.length,
  };
}

export function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}
