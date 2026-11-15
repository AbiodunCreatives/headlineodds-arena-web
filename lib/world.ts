import {
  type Arena, type Player, type Side, type RoundPrice,
  ROUND_MS, LOCK_BEFORE_CLOSE_MS, botCall, hashStr, rng, roundById, outcome, roundAt,
} from "./game";

// Demo players. All fictional, no real people.
export const BOTS: Player[] = [
  { id: "bot-carl", name: "candle_carl", bot: true, style: 0.7 },
  { id: "bot-wick", name: "wickhunter", bot: true, style: 0.3 },
  { id: "bot-oracle", name: "oddsoracle", bot: true, style: 0.55 },
  { id: "bot-hawk", name: "headline_hawk", bot: true, style: 0.45 },
  { id: "bot-delta", name: "deltaneutral", bot: true, style: 0.6 },
  { id: "bot-larry", name: "long_larry", bot: true, style: 0.85 },
  { id: "bot-sally", name: "short_sally", bot: true, style: 0.15 },
  { id: "bot-kemi", name: "coinflip_kemi", bot: true, style: 0.5 },
  { id: "bot-fade", name: "fade_the_pump", bot: true, style: 0.4 },
];

export const SEED_FRIENDS: Player[] = [
  { id: "fr-tunde", name: "Tunde", bot: true, style: 0.65 },
  { id: "fr-ada", name: "Ada", bot: true, style: 0.35 },
  { id: "fr-kemi", name: "Kemi", bot: true, style: 0.5 },
  { id: "fr-chidi", name: "Chidi", bot: true, style: 0.75 },
];

export const ME_ID = "me";
export const PUBLIC_FEE = 1;
export const LAGOS_OFFSET_MS = 60 * 60 * 1000; // WAT is UTC+1 all year

/** The always-on public arena runs one day in West Africa Time (96 rounds). */
export function publicArena(now: number, me?: Player, myCalls?: Arena["calls"]): Arena {
  const day = Math.floor((now + LAGOS_OFFSET_MS) / 86_400_000);
  const start = day * 86_400_000 - LAGOS_OFFSET_MS;
  return {
    code: `OPEN-${day}`,
    name: "the open arena",
    entryFee: PUBLIC_FEE,
    startRound: Math.floor(start / ROUND_MS),
    rounds: 96,
    bankroll: 1000,
    players: me ? [me, ...BOTS] : [...BOTS],
    calls: myCalls ?? {},
    isPublic: true,
  };
}

// ---------- dares ----------

export interface Dare {
  id: string;
  roundId: number;
  fromId: string;
  toId: string;
  fromSide: Side; // the challenger's call; the other side takes the opposite
  stake: number; // dare chips
  createdAt: number;
  status: "pending" | "accepted" | "declined";
}

export const DARE_START_CHIPS = 500;

/** A bot friend answers an outgoing dare 5–25 s after it is sent. */
export function botReply(d: Dare): { at: number; accept: boolean } {
  const r = rng(hashStr("reply:" + d.id));
  return { at: d.createdAt + 5000 + Math.floor(r() * 20_000), accept: r() < 0.75 };
}

/** Each round one friend dares you, a few minutes in. Deterministic so it survives reloads. */
export function incomingDareFor(roundId: number, friends: Player[]): Dare | null {
  const botFriends = friends.filter((f) => f.bot);
  if (!botFriends.length) return null;
  const r = rng(hashStr("dare:" + roundId));
  if (r() < 0.2) return null;
  const f = botFriends[Math.floor(r() * botFriends.length)];
  const start = roundById(roundId).start;
  return {
    id: `in-${roundId}-${f.id}`,
    roundId,
    fromId: f.id,
    toId: ME_ID,
    fromSide: r() < (f.style ?? 0.5) ? "UP" : "DOWN",
    stake: [25, 50, 100][Math.floor(r() * 3)],
    createdAt: start + 60_000 + Math.floor(r() * 6 * 60_000),
    status: "pending",
  };
}

export function effectiveStatus(d: Dare, now: number): Dare["status"] {
  if (d.status !== "pending") return d.status;
  if (d.fromId === ME_ID) {
    const rep = botReply(d);
    if (now >= rep.at) return rep.accept ? "accepted" : "declined";
  }
  if (now >= roundById(d.roundId).end - LOCK_BEFORE_CLOSE_MS) return "declined"; // expired at lock
  return "pending";
}

/** Chips I won (+) or lost (-) on a settled dare, or null if not settled. */
export function dareResult(d: Dare, now: number, prices: (id: number) => RoundPrice | null): number | null {
  if (effectiveStatus(d, now) !== "accepted") return null;
  const px = prices(d.roundId);
  if (!px) return null;
  const mySide: Side = d.fromId === ME_ID ? d.fromSide : d.fromSide === "UP" ? "DOWN" : "UP";
  const o = outcome(mySide, px.open, px.close);
  return o === "WIN" ? d.stake : o === "LOSS" ? -d.stake : 0;
}

// ---------- live feed ----------

export interface FeedItem { at: number; text: string; tone: "up" | "down" | "dare" | "me" | "info" }

export function botFeed(roundId: number, players: Player[], now: number): FeedItem[] {
  const out: FeedItem[] = [];
  for (const p of players) {
    if (!p.bot) continue;
    const c = botCall(p.id, roundId, p.style ?? 0.5);
    if (c && c.at <= now) {
      out.push({ at: c.at, text: `${p.name} called ${c.side.toLowerCase()} (${(c.pct * 100).toFixed(c.pct < 0.025 ? 0 : 1).replace(".0", "")}% stake)`, tone: c.side === "UP" ? "up" : "down" });
    }
  }
  return out;
}

export function nowRoundId(now: number) {
  return roundAt(now).id;
}
