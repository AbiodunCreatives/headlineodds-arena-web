// Picking the round's open price. Pure, so it can be unit-tested.

export type OpenSource = "15m" | "1m" | "provisional" | "sim";
export interface OpenChoice { open: number | null; source: OpenSource | null }

/**
 * Binance kline rows, oldest first: [openTime(ms), open, high, low, close, volume, closeTime(ms), ...].
 * Prices arrive as strings.
 */
export type CandleRow = [number, string, string, string, string, string, number, ...unknown[]];

export interface Kline { start: number; open: number; high: number; low: number; close: number }

export function parseKline(r: CandleRow): Kline {
  return { start: r[0], open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]) };
}

/** Open of the candle that starts exactly at `boundaryMs`, or null if it isn't published yet. */
export function openAtBoundary(rows: CandleRow[] | null | undefined, boundaryMs: number): number | null {
  if (!rows) return null;
  const row = rows.find((r) => r[0] === boundaryMs);
  if (!row) return null;
  const open = Number(row[1]);
  return Number.isFinite(open) ? open : null;
}

/**
 * Priority: simulated feed (when in sim mode) > official 15m candle > first 1m candle of the round
 * (same open as the 15m one, published within seconds) > provisional live tick taken in this round.
 * Every input must belong to the current round, so a previous round's open can never leak through.
 */
export function selectOpen(i: { sim?: number | null; c15?: number | null; m1?: number | null; provisional?: number | null }): OpenChoice {
  if (i.sim != null) return { open: i.sim, source: "sim" };
  if (i.c15 != null) return { open: i.c15, source: "15m" };
  if (i.m1 != null) return { open: i.m1, source: "1m" };
  if (i.provisional != null) return { open: i.provisional, source: "provisional" };
  return { open: null, source: null };
}

/**
 * Settlement for the 15-minute round starting at `roundStartMs`, from Binance 15m klines.
 * Only final once the next 15m candle exists (so the close can't be a still-moving snapshot).
 * Both friends' devices read the same candle, so they settle identically.
 */
export function roundResultFromKlines(rows: CandleRow[] | null | undefined, roundStartMs: number, roundMs = 15 * 60_000): { open: number; close: number } | null {
  if (!rows) return null;
  const row = rows.find((r) => r[0] === roundStartMs);
  if (!row || !rows.some((r) => r[0] === roundStartMs + roundMs)) return null;
  const k = parseKline(row);
  return Number.isFinite(k.open) && Number.isFinite(k.close) ? { open: k.open, close: k.close } : null;
}
