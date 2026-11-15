// Pure game logic for HeadlineOdds Arena (web edition). No I/O here, so it is easy to test.

export const ROUND_MS = 15 * 60 * 1000;
export const LOCK_BEFORE_CLOSE_MS = 60 * 1000;
export const STAKE_PCTS = [0.01, 0.025, 0.05, 0.1] as const;
const PRIZE_SPLIT = [0.5, 0.3, 0.2] as const;
const HOUSE_FEE = 0.08; // example platform fee, mirrors the bot's commission setting
const ENTRY_MULTIPLIER = 100; // virtual bankroll = entry fee x 100 (min 1,000 chips)

export type Side = "UP" | "DOWN";

export interface RoundInfo {
  id: number; // floor(time / ROUND_MS)
  start: number;
  lockAt: number;
  end: number;
}

export function roundAt(t: number): RoundInfo {
  const id = Math.floor(t / ROUND_MS);
  const start = id * ROUND_MS;
  return { id, start, lockAt: start + ROUND_MS - LOCK_BEFORE_CLOSE_MS, end: start + ROUND_MS };
}

export function roundById(id: number): RoundInfo {
  return roundAt(id * ROUND_MS);
}

export function isLocked(t: number): boolean {
  return t >= roundAt(t).lockAt;
}

/** Arenas always start on a round boundary: the current round if under a third gone, otherwise the next. */
export function arenaStartRound(t: number): number {
  const r = roundAt(t);
  return (t - r.start) / ROUND_MS <= 0.33 ? r.id : r.id + 1;
}

export function virtualBankroll(entryFee: number): number {
  return Math.max(1000, Math.round(entryFee * ENTRY_MULTIPLIER));
}

export function stakeOptions(bankroll: number): number[] {
  return STAKE_PCTS.map((p) => Math.max(1, Math.floor(bankroll * p)));
}

export type Outcome = "WIN" | "LOSS" | "PUSH";

export function outcome(side: Side, open: number, close: number): Outcome {
  if (close === open) return "PUSH";
  const up = close > open;
  return (up && side === "UP") || (!up && side === "DOWN") ? "WIN" : "LOSS";
}

/** Even-money settlement: win +stake, loss -stake, flat close refunds. */
export function settleDelta(side: Side, stake: number, open: number, close: number): number {
  const o = outcome(side, open, close);
  return o === "WIN" ? stake : o === "LOSS" ? -stake : 0;
}

export interface PrizeLine {
  place: number;
  pct: number;
  amount: number;
}

export interface PrizeBreakdown {
  players: number;
  entryFee: number;
  gross: number;
  fee: number;
  net: number;
  lines: PrizeLine[];
}

const cents = (n: number) => Math.round(n * 100) / 100;

export function prizeSplit(entryFee: number, players: number, feeRate = HOUSE_FEE): PrizeBreakdown {
  const gross = cents(entryFee * players);
  const fee = cents(gross * feeRate);
  const net = cents(gross - fee);
  const paid = Math.min(3, Math.max(players, 0));
  // With fewer than 3 players the unused shares are folded into the places that exist.
  const weights = PRIZE_SPLIT.slice(0, paid);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const lines = weights.map((w, i) => ({ place: i + 1, pct: w / total, amount: cents((net * w) / total) }));
  return { players, entryFee, gross, fee, net, lines };
}

// ---------- deterministic randomness ----------

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- simulated BTC feed (deterministic in time, so every round open/close is reproducible) ----------

const SIM_BASE = 64000;
const STEP_MS = 5000;

function noiseAt(step: number): number {
  return rng(hashStr("btc" + step))() - 0.5;
}

export function simPrice(t: number): number {
  const s = t / 1000;
  const wave =
    0.012 * Math.sin(s / 5400 + 1.3) +
    0.006 * Math.sin(s / 1300 + 0.4) +
    0.0025 * Math.sin(s / 333 + 2.1) +
    0.0012 * Math.sin(s / 71 + 0.7);
  const step = Math.floor(t / STEP_MS);
  const frac = (t % STEP_MS) / STEP_MS;
  const n = noiseAt(step) * (1 - frac) + noiseAt(step + 1) * frac;
  return Math.round(SIM_BASE * Math.exp(wave + n * 0.0008) * 100) / 100;
}

// ---------- demo bots ----------

export interface BotCall {
  playerId: string;
  side: Side;
  pct: number;
  at: number; // ms timestamp when the call is made
}

export function botCall(botId: string, roundId: number, style: number): BotCall | null {
  const r = rng(hashStr(`${botId}:${roundId}`));
  if (r() < 0.12) return null; // sits out this round
  const r2 = r();
  const side: Side = r2 < 0.5 + (style - 0.5) * 0.3 ? "UP" : "DOWN";
  const pct = STAKE_PCTS[Math.floor(r() * STAKE_PCTS.length)];
  const start = roundById(roundId).start;
  const at = start + Math.floor(r() * (ROUND_MS - LOCK_BEFORE_CLOSE_MS - 30_000)) + 10_000;
  return { playerId: botId, side, pct, at };
}

// ---------- arena replay ----------

export interface Player {
  id: string;
  name: string;
  bot?: boolean;
  style?: number;
  joinedAt?: number; // ms; used as the final tie-break
}

export interface UserCall {
  side: Side;
  stake: number;
  at: number;
}

export interface Arena {
  code: string;
  name: string;
  entryFee: number;
  startRound: number;
  rounds: number; // length in rounds
  bankroll: number; // starting virtual chips
  players: Player[];
  calls: Record<string, Record<string, UserCall>>; // roundId -> playerId -> call (human players)
  isPublic?: boolean;
}

export interface RoundPrice {
  open: number;
  close: number;
}

export interface Standing {
  player: Player;
  bankroll: number;
  wins: number;
  losses: number;
  lastDelta: number;
  /** When the player reached their current bankroll (time of the call that set it, or join time). */
  reachedAt: number;
  joinOrder: number;
}

/** Replay every settled round of an arena. prices(roundId) returns null when a close is not known yet. */
export function standings(
  arena: Arena,
  prices: (roundId: number) => RoundPrice | null,
  now: number,
): Standing[] {
  const st = new Map<string, Standing>();
  const arenaStart = roundById(arena.startRound).start;
  arena.players.forEach((p, i) =>
    st.set(p.id, {
      player: p, bankroll: arena.bankroll, wins: 0, losses: 0, lastDelta: 0,
      reachedAt: Math.max(arenaStart, p.joinedAt ?? arenaStart), joinOrder: i,
    }),
  );
  const last = Math.min(arena.startRound + arena.rounds - 1, roundAt(now).id - 1);
  for (let id = arena.startRound; id <= last; id++) {
    const px = prices(id);
    if (!px) continue;
    for (const p of arena.players) {
      const s = st.get(p.id)!;
      let side: Side | undefined;
      let stake = 0;
      let at = 0;
      if (p.bot) {
        const c = botCall(p.id, id, p.style ?? 0.5);
        if (c) {
          side = c.side;
          stake = Math.max(1, Math.floor(s.bankroll * c.pct));
          at = c.at;
        }
      } else {
        const c = arena.calls[id]?.[p.id];
        if (c) {
          side = c.side;
          stake = Math.min(c.stake, s.bankroll);
          at = c.at;
        }
      }
      if (!side || stake <= 0) continue;
      const d = settleDelta(side, stake, px.open, px.close);
      s.bankroll += d;
      s.lastDelta = d;
      if (d !== 0) s.reachedAt = at;
      if (d > 0) s.wins++;
      else if (d < 0) s.losses++;
    }
  }
  return [...st.values()].sort(compareStandings);
}

/** Higher bankroll first; ties go to whoever reached that bankroll first, then whoever joined first. */
function compareStandings(a: Standing, b: Standing): number {
  return b.bankroll - a.bankroll || a.reachedAt - b.reachedAt || (a.player.joinedAt ?? 0) - (b.player.joinedAt ?? 0) || a.joinOrder - b.joinOrder;
}

export function arenaEnded(arena: Arena, now: number): boolean {
  return roundAt(now).id >= arena.startRound + arena.rounds;
}

export function makeCode(seed: number): string {
  const r = rng(seed);
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(r() * chars.length)]).join("");
}
