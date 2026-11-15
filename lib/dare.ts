// Dare15: pure rules for a two-friend BTC 15-minute dare with a client-side (test) escrow.
// No I/O here, so every rule is unit-tested. All amounts are TEST USDC, not real money.
import { ROUND_MS, outcome, roundAt, roundById, type RoundPrice, type Side } from "./game";

export const STAKE = 2; // test USDC each side
export const POT = STAKE * 2; // total escrow for a matched dare
/** Platform commission on a resolved (won) dare, as a share of the whole pot. Ties and expiries pay no fee. */
export const PLATFORM_FEE = 0.08;
// Money math in integer cents so the payout is exactly 3.68, never 3.6799999.
const toCents = (n: number) => Math.round(n * 100);
export const FEE_AMOUNT = Math.round(toCents(POT) * PLATFORM_FEE) / 100; // 0.32
export const WIN_PAYOUT = (toCents(POT) - toCents(FEE_AMOUNT)) / 100; // 3.68
export const START_BALANCE = 5; // test USDC on a new device
export const TOP_UP = 5; // test-only top-up
/** A dare always targets a round that opens at least this far in the future, so the friend has time to accept. */
export const MIN_LEAD_MS = 5 * 60_000;
const NAME_MAX = 18;

export const opposite = (s: Side): Side => (s === "UP" ? "DOWN" : "UP");
const cents = (n: number) => Math.round(n * 100) / 100;

// ---------- rounds ----------

/**
 * The round a new dare is locked to: the next 15-minute round, or the one after it if the next bell is less
 * than MIN_LEAD_MS away. Never the current round, because its open is already known and the challenger
 * could pick a side that is already winning.
 */
export function targetRound(now: number): number {
  const next = roundAt(now).id + 1;
  return roundById(next).start - now >= MIN_LEAD_MS ? next : next + 1;
}

/** The friend must accept before the round's bell (its open is unknown until then). */
export const acceptDeadline = (roundId: number) => roundById(roundId).start;
export const roundEnd = (roundId: number) => roundById(roundId).start + ROUND_MS;

// ---------- share links ----------

export interface DareOffer {
  v: 1;
  id: string;
  roundId: number;
  side: Side; // the challenger's call; the friend takes the opposite
  stake: number; // always STAKE
  from: string; // challenger name
  at: number; // created at (ms)
}

export interface DareAcceptance {
  v: 1;
  id: string;
  roundId: number;
  by: string; // friend name
  at: number; // accepted at (ms)
}

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export const encodeToken = (o: DareOffer | DareAcceptance) => b64urlEncode(JSON.stringify(o));

const isName = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0 && x.length <= NAME_MAX;
const isId = (x: unknown): x is string => typeof x === "string" && /^[A-Za-z0-9]{6,16}$/.test(x);
const isInt = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x > 0;

function parse(token: string): Record<string, unknown> | null {
  try {
    const o = JSON.parse(b64urlDecode(token));
    return o && typeof o === "object" ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function decodeOffer(token: string): DareOffer | null {
  const o = parse(token);
  if (!o || o.v !== 1 || !isId(o.id) || !isInt(o.roundId) || (o.side !== "UP" && o.side !== "DOWN")) return null;
  if (o.stake !== STAKE || !isName(o.from) || !isInt(o.at)) return null;
  return { v: 1, id: o.id, roundId: o.roundId, side: o.side, stake: STAKE, from: o.from, at: o.at };
}

export function decodeAcceptance(token: string): DareAcceptance | null {
  const o = parse(token);
  if (!o || o.v !== 1 || !isId(o.id) || !isInt(o.roundId) || !isName(o.by) || !isInt(o.at)) return null;
  return { v: 1, id: o.id, roundId: o.roundId, by: o.by, at: o.at };
}

export type LinkKind = "dare" | "accept";

/** Absolute link to the app root under the deploy base path (e.g. "/headlineodds-arena-web" on GitHub Pages, "" at "/"). */
export function buildLink(origin: string, basePath: string, kind: LinkKind, token: string): string {
  const base = basePath.replace(/\/+$/, "");
  return `${origin.replace(/\/+$/, "")}${base}/#${kind}=${token}`;
}

export function parseHash(hash: string): { kind: LinkKind; token: string } | null {
  const m = /^#?(dare|accept)=([A-Za-z0-9_-]+)$/.exec(hash.trim());
  return m ? { kind: m[1] as LinkKind, token: m[2] } : null;
}

// ---------- escrow ----------

export type Role = "challenger" | "friend";

export interface DareRecord {
  offer: DareOffer;
  role: Role; // which side this device plays
  friend?: string; // set once the acceptance is known on this device
  acceptedAt?: number;
  result?: RoundPrice; // the round's Binance 15m open/close, once settled
  paid: number; // test USDC already returned to this device's balance for this dare
  fee?: number; // platform fee already recorded in this device's ledger for this dare
}

/** `amount` is the change to this device's balance. Platform entries move nothing here: `platform` is what the platform took. */
export interface LedgerItem { at: number; text: string; amount: number; platform?: number }

export interface Escrow {
  balance: number; // this device's spendable test USDC
  dares: DareRecord[];
  ledger: LedgerItem[]; // newest first
}

export const newEscrow = (now: number): Escrow => ({
  balance: START_BALANCE,
  dares: [],
  ledger: [{ at: now, text: "test balance (not real money)", amount: START_BALANCE }],
});

export const canAfford = (balance: number) => balance >= STAKE;

export type Result<T> = { ok: true; escrow: Escrow; value: T } | { ok: false; error: string };

const debit = (e: Escrow, now: number, text: string): Escrow => ({
  ...e,
  balance: cents(e.balance - STAKE),
  ledger: [{ at: now, text, amount: -STAKE }, ...e.ledger],
});

/** Challenger: lock 2 test USDC in escrow and create the offer that goes into the share link. */
export function createDare(e: Escrow, i: { id: string; side: Side; name: string; now: number }): Result<DareOffer> {
  if (!canAfford(e.balance)) return { ok: false, error: `you need at least ${STAKE} test USDC to dare a friend.` };
  if (!isName(i.name.trim())) return { ok: false, error: "add your name first." };
  if (!isId(i.id) || e.dares.some((d) => d.offer.id === i.id)) return { ok: false, error: "couldn't create a dare id, try again." };
  const offer: DareOffer = { v: 1, id: i.id, roundId: targetRound(i.now), side: i.side, stake: STAKE, from: i.name.trim(), at: i.now };
  const next = debit(e, i.now, `escrow: you locked ${STAKE} (dare ${offer.id})`);
  return { ok: true, value: offer, escrow: { ...next, dares: [{ offer, role: "challenger", paid: 0 }, ...next.dares] } };
}

/** Friend: accept an offer from a link. Locks the friend's 2 test USDC; the challenger's 2 is logged from the link. */
export function acceptDare(e: Escrow, offer: DareOffer, name: string, now: number): Result<DareAcceptance> {
  const mine = e.dares.find((d) => d.offer.id === offer.id);
  if (mine?.role === "challenger") return { ok: false, error: "this is your own dare. send the link to a friend." };
  if (mine) return { ok: false, error: "you already accepted this dare." };
  if (now >= acceptDeadline(offer.roundId)) return { ok: false, error: "too late: this dare's round has already started." };
  if (!canAfford(e.balance)) return { ok: false, error: `you need at least ${STAKE} test USDC to accept.` };
  const by = name.trim();
  if (!isName(by)) return { ok: false, error: "add your name first." };
  const acc: DareAcceptance = { v: 1, id: offer.id, roundId: offer.roundId, by, at: now };
  let next = debit(e, now, `escrow: you locked ${STAKE} (dare ${offer.id})`);
  next = { ...next, ledger: [{ at: now, text: `escrow: ${offer.from} locked ${STAKE} (from their link)`, amount: 0 }, ...next.ledger] };
  const rec: DareRecord = { offer, role: "friend", friend: by, acceptedAt: now, paid: 0 };
  return { ok: true, value: acc, escrow: { ...next, dares: [rec, ...next.dares] } };
}

/** Challenger: record the friend's acceptance from the link they sent back. */
export function recordAcceptance(e: Escrow, acc: DareAcceptance): Result<DareRecord> {
  const rec = e.dares.find((d) => d.offer.id === acc.id);
  if (!rec || rec.role !== "challenger") return { ok: false, error: "this acceptance is for a dare that wasn't created on this device." };
  if (rec.offer.roundId !== acc.roundId) return { ok: false, error: "this acceptance doesn't match the dare's round." };
  if (acc.at >= acceptDeadline(rec.offer.roundId)) return { ok: false, error: "that acceptance came after the round started, so it doesn't count." };
  if (rec.friend) {
    if (rec.friend === acc.by) return { ok: true, value: rec, escrow: e };
    return { ok: false, error: `this dare was already accepted by ${rec.friend}.` };
  }
  const upd: DareRecord = { ...rec, friend: acc.by, acceptedAt: acc.at };
  return {
    ok: true,
    value: upd,
    escrow: {
      ...e,
      dares: e.dares.map((d) => (d === rec ? upd : d)),
      ledger: [{ at: acc.at, text: `escrow: ${acc.by} locked ${STAKE} (dare ${rec.offer.id})`, amount: 0 }, ...e.ledger],
    },
  };
}

export type Winner = "challenger" | "friend" | "tie";

export function winnerOf(offer: DareOffer, px: RoundPrice): Winner {
  const o = outcome(offer.side, px.open, px.close);
  return o === "PUSH" ? "tie" : o === "WIN" ? "challenger" : "friend";
}

export const mySide = (r: DareRecord): Side => (r.role === "challenger" ? r.offer.side : opposite(r.offer.side));

export type DareStatus =
  | "waiting" // challenger: link sent, no acceptance yet, before the bell
  | "unanswered" // challenger: bell passed without an acceptance on this device; refunded at round end
  | "matched" // both stakes in escrow, before the bell
  | "live" // round running
  | "settling" // round ended, waiting for Binance's 15m candle
  | "won" | "lost" | "tie" | "expired";

export function statusOf(r: DareRecord, now: number): DareStatus {
  const start = acceptDeadline(r.offer.roundId);
  const end = roundEnd(r.offer.roundId);
  if (!r.friend) return now < start ? "waiting" : now < end ? "unanswered" : "expired";
  if (now < start) return "matched";
  if (now < end) return "live";
  if (!r.result) return "settling";
  const w = winnerOf(r.offer, r.result);
  return w === "tie" ? "tie" : w === r.role ? "won" : "lost";
}

/** What this device should have been paid back for a dare by now. */
export function targetPaid(r: DareRecord, now: number): number {
  switch (statusOf(r, now)) {
    case "expired": return STAKE; // nobody accepted: refund the challenger
    case "tie": return STAKE; // flat close: refund both
    case "won": return WIN_PAYOUT; // the pot minus the platform fee moves to the winner's side
    default: return 0; // still in escrow, or lost
  }
}

/** Platform fee that should be recorded for a dare by now: only when it resolved with a winner. */
export function targetFee(r: DareRecord, now: number): number {
  const st = statusOf(r, now);
  return st === "won" || st === "lost" ? FEE_AMOUNT : 0;
}

/** Attach the round's settlement prices to every matched dare on that round. */
export function applyResult(e: Escrow, roundId: number, px: RoundPrice): Escrow {
  let changed = false;
  const dares = e.dares.map((d) => {
    if (d.offer.roundId !== roundId || d.result || !d.friend) return d;
    changed = true;
    return { ...d, result: px };
  });
  return changed ? { ...e, dares } : e;
}

/**
 * Pay out (or claw back) the difference between what each dare is owed and what it was paid, and record the
 * platform fee the same way. Idempotent, and also used when a late return link re-settles a dare.
 */
export function reconcile(e: Escrow, now: number): Escrow {
  let balance = e.balance;
  const ledger: LedgerItem[] = [];
  let changed = false;
  const dares = e.dares.map((d) => {
    const delta = cents(targetPaid(d, now) - d.paid);
    const feeDelta = cents(targetFee(d, now) - (d.fee ?? 0));
    if (delta === 0 && feeDelta === 0) return d;
    changed = true;
    const st = statusOf(d, now);
    if (feeDelta !== 0) {
      ledger.push({
        at: now,
        text: feeDelta > 0 ? `escrow → platform: ${PLATFORM_FEE * 100}% fee on the ${POT} pot (dare ${d.offer.id})` : `platform fee reversed (dare ${d.offer.id})`,
        amount: 0,
        platform: feeDelta,
      });
    }
    if (delta !== 0) {
      balance = cents(balance + delta);
      const text =
        st === "won" ? `escrow → you: won dare ${d.offer.id} (${WIN_PAYOUT.toFixed(2)} after the platform fee)`
        : st === "tie" ? `escrow → you: flat close, stake refunded (dare ${d.offer.id})`
        : st === "expired" ? `escrow → you: no one accepted, refunded (dare ${d.offer.id})`
        : `escrow adjustment (dare ${d.offer.id})`;
      ledger.push({ at: now, text, amount: delta });
    }
    return { ...d, paid: cents(d.paid + delta), fee: cents((d.fee ?? 0) + feeDelta) };
  });
  if (!changed) return e;
  return { balance, dares, ledger: [...ledger, ...e.ledger] };
}

/** Where the pot went once a dare settled with a winner: winner + platform always equals the pot. */
export function payoutSplit(): { pot: number; winner: number; platform: number } {
  return { pot: POT, winner: WIN_PAYOUT, platform: FEE_AMOUNT };
}

/** Escrow contents for one dare as seen on this device. */
export function escrowView(r: DareRecord): { challenger: number; friend: number; total: number } {
  const friend = r.friend ? STAKE : 0;
  return { challenger: STAKE, friend, total: STAKE + friend };
}

/** Dares on rounds that have closed but have no settlement prices yet. */
export function roundsToSettle(e: Escrow, now: number): number[] {
  const ids = new Set<number>();
  for (const d of e.dares) if (d.friend && !d.result && now >= roundEnd(d.offer.roundId)) ids.add(d.offer.roundId);
  return [...ids];
}

export function newDareId(rand: () => number = Math.random): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return Array.from({ length: 10 }, () => chars[Math.floor(rand() * chars.length)]).join("");
}
