// Picking the round's open price. Pure, so it can be unit-tested.

export type OpenSource = "15m" | "1m" | "provisional" | "sim";
export interface OpenChoice { open: number | null; source: OpenSource | null }

/** Coinbase candle rows: [time(s), low, high, open, close, volume], newest first. */
export type CandleRow = [number, number, number, number, number, number];

/** Open of the candle that starts exactly at `boundaryMs`, or null if it isn't published yet. */
export function openAtBoundary(rows: CandleRow[] | null | undefined, boundaryMs: number): number | null {
  if (!rows) return null;
  const row = rows.find((r) => r[0] * 1000 === boundaryMs);
  return row ? row[3] : null;
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
