import { describe, expect, it } from "vitest";
import { ROUND_MS, roundAt } from "./game";
import {
  POT, STAKE, START_BALANCE, MIN_LEAD_MS, acceptDare, acceptDeadline, applyResult, buildLink, canAfford, createDare,
  decodeAcceptance, decodeOffer, encodeToken, escrowView, newEscrow, parseHash, reconcile, recordAcceptance, roundEnd,
  roundsToSettle, statusOf, targetRound, type DareOffer, type Escrow,
} from "./dare";

const B = Date.UTC(2026, 10, 15, 6, 0); // 07:00 WAT bell
const T0 = B + 2 * 60_000; // 2 minutes into a round
const at = (e: Escrow, i = 0) => e.dares[i];

function setup(side: "UP" | "DOWN" = "UP") {
  const c0 = newEscrow(T0);
  const made = createDare(c0, { id: "AbCdEf1234", side, name: "Bayo", now: T0 });
  if (!made.ok) throw new Error(made.error);
  const f0 = newEscrow(T0);
  const acc = acceptDare(f0, made.value, "Ada", T0 + 60_000);
  if (!acc.ok) throw new Error(acc.error);
  const rec = recordAcceptance(made.escrow, acc.value);
  if (!rec.ok) throw new Error(rec.error);
  return { offer: made.value, challenger: rec.escrow, friend: acc.escrow, acceptance: acc.value };
}

describe("round selection", () => {
  it("locks to the next round, or the one after if the bell is under 5 minutes away", () => {
    expect(targetRound(T0)).toBe(roundAt(T0).id + 1);
    expect(targetRound(B + ROUND_MS - MIN_LEAD_MS + 1)).toBe(roundAt(B).id + 2);
    expect(targetRound(B + ROUND_MS - MIN_LEAD_MS)).toBe(roundAt(B).id + 1);
  });
});

describe("share links", () => {
  const offer: DareOffer = { v: 1, id: "AbCdEf1234", roundId: 1_970_000, side: "DOWN", stake: STAKE, from: "Bàyọ̀ 🚀", at: T0 };
  it("round-trips an offer and an acceptance (unicode names too)", () => {
    expect(decodeOffer(encodeToken(offer))).toEqual(offer);
    const acc = { v: 1 as const, id: offer.id, roundId: offer.roundId, by: "Ada", at: T0 + 1 };
    expect(decodeAcceptance(encodeToken(acc))).toEqual(acc);
  });
  it("rejects tampered or malformed tokens", () => {
    expect(decodeOffer("not-a-token")).toBeNull();
    expect(decodeOffer(encodeToken({ ...offer, stake: 200 }))).toBeNull();
    expect(decodeOffer(encodeToken({ ...offer, side: "SIDEWAYS" as never }))).toBeNull();
    expect(decodeOffer(encodeToken({ ...offer, from: "" }))).toBeNull();
  });
  it("builds links under the GitHub Pages base path and at /, and parses them back", () => {
    const tok = encodeToken(offer);
    const gh = buildLink("https://abioduncreatives.github.io", "/headlineodds-arena-web", "dare", tok);
    expect(gh).toBe(`https://abioduncreatives.github.io/headlineodds-arena-web/#dare=${tok}`);
    expect(buildLink("http://localhost:3000", "", "accept", tok)).toBe(`http://localhost:3000/#accept=${tok}`);
    expect(buildLink("http://x.test/", "/app/", "dare", tok)).toBe(`http://x.test/app/#dare=${tok}`);
    expect(parseHash(new URL(gh).hash)).toEqual({ kind: "dare", token: tok });
    expect(parseHash("#other=1")).toBeNull();
  });
});

describe("balance check", () => {
  it("blocks a dare or an acceptance with less than 2 test USDC", () => {
    expect(canAfford(1.99)).toBe(false);
    expect(canAfford(2)).toBe(true);
    const poor = { ...newEscrow(T0), balance: 1.5 };
    const r = createDare(poor, { id: "AbCdEf1234", side: "UP", name: "Bayo", now: T0 });
    expect(r.ok).toBe(false);
    const ok = createDare(newEscrow(T0), { id: "AbCdEf1234", side: "UP", name: "Bayo", now: T0 });
    if (!ok.ok) throw new Error();
    expect(acceptDare(poor, ok.value, "Ada", T0).ok).toBe(false);
  });
});

describe("escrow lock", () => {
  it("locks 2 on each device and logs both stakes", () => {
    const { challenger, friend } = setup();
    expect(challenger.balance).toBe(START_BALANCE - STAKE);
    expect(friend.balance).toBe(START_BALANCE - STAKE);
    expect(escrowView(at(challenger))).toEqual({ challenger: 2, friend: 2, total: 4 });
    expect(escrowView(at(friend))).toEqual({ challenger: 2, friend: 2, total: 4 });
    expect(statusOf(at(challenger), T0 + 61_000)).toBe("matched");
  });
  it("refuses your own dare, a second acceptance, and acceptance after the bell", () => {
    const { offer, challenger, friend, acceptance } = setup();
    expect(acceptDare(challenger, offer, "Bayo", T0).ok).toBe(false);
    expect(acceptDare(friend, offer, "Ada", T0).ok).toBe(false);
    expect(acceptDare(newEscrow(T0), offer, "Kemi", acceptDeadline(offer.roundId)).ok).toBe(false);
    expect(recordAcceptance(challenger, { ...acceptance, by: "Kemi" }).ok).toBe(false);
    const again = recordAcceptance(challenger, acceptance);
    expect(again.ok && again.escrow).toBe(challenger); // idempotent
  });
});

describe("resolution", () => {
  const settle = (e: Escrow, roundId: number, open: number, close: number) => reconcile(applyResult(e, roundId, { open, close }), roundEnd(roundId) + 5000);

  it("UP wins: the challenger (UP) gets 4, the friend gets 0", () => {
    const { offer, challenger, friend } = setup("UP");
    expect(roundsToSettle(challenger, roundEnd(offer.roundId))).toEqual([offer.roundId]);
    const c = settle(challenger, offer.roundId, 65000, 65010);
    const f = settle(friend, offer.roundId, 65000, 65010);
    expect(statusOf(at(c), roundEnd(offer.roundId))).toBe("won");
    expect(c.balance).toBe(START_BALANCE - STAKE + POT);
    expect(f.balance).toBe(START_BALANCE - STAKE);
    expect(c.balance + f.balance).toBe(2 * START_BALANCE); // nothing created or lost
  });
  it("DOWN wins: the friend (DOWN) gets 4", () => {
    const { offer, challenger, friend } = setup("UP");
    const c = settle(challenger, offer.roundId, 65000, 64990);
    const f = settle(friend, offer.roundId, 65000, 64990);
    expect(statusOf(at(f), roundEnd(offer.roundId))).toBe("won");
    expect(f.balance).toBe(START_BALANCE - STAKE + POT);
    expect(c.balance).toBe(START_BALANCE - STAKE);
  });
  it("a flat close refunds both", () => {
    const { offer, challenger, friend } = setup("DOWN");
    expect(settle(challenger, offer.roundId, 65000, 65000).balance).toBe(START_BALANCE);
    expect(settle(friend, offer.roundId, 65000, 65000).balance).toBe(START_BALANCE);
  });
  it("is idempotent: reconciling again pays nothing more", () => {
    const { offer, challenger } = setup("UP");
    const c = settle(challenger, offer.roundId, 65000, 65010);
    expect(reconcile(c, roundEnd(offer.roundId) + 60_000)).toBe(c);
  });
  it("waits for prices: no payout without the round's candle", () => {
    const { offer, challenger } = setup("UP");
    const c = reconcile(challenger, roundEnd(offer.roundId) + 5000);
    expect(c).toBe(challenger);
    expect(statusOf(at(c), roundEnd(offer.roundId) + 5000)).toBe("settling");
  });
  it("expiry: no acceptance refunds the challenger when the round closes", () => {
    const made = createDare(newEscrow(T0), { id: "AbCdEf1234", side: "UP", name: "Bayo", now: T0 });
    if (!made.ok) throw new Error();
    const rid = made.value.roundId;
    expect(statusOf(at(made.escrow), acceptDeadline(rid))).toBe("unanswered");
    expect(reconcile(made.escrow, acceptDeadline(rid) + 1).balance).toBe(START_BALANCE - STAKE);
    const done = reconcile(made.escrow, roundEnd(rid));
    expect(statusOf(at(done), roundEnd(rid))).toBe("expired");
    expect(done.balance).toBe(START_BALANCE);
  });
  it("a late return link (accepted before the bell) re-settles the challenger correctly", () => {
    const { offer, acceptance } = setup("UP");
    const made = createDare(newEscrow(T0), { id: offer.id, side: "UP", name: "Bayo", now: T0 });
    if (!made.ok) throw new Error();
    const refunded = reconcile(made.escrow, roundEnd(offer.roundId));
    expect(refunded.balance).toBe(START_BALANCE);
    const rec = recordAcceptance(refunded, acceptance);
    if (!rec.ok) throw new Error(rec.error);
    const won = reconcile(applyResult(rec.escrow, offer.roundId, { open: 1, close: 2 }), roundEnd(offer.roundId) + 1);
    expect(won.balance).toBe(START_BALANCE - STAKE + POT);
  });
});
