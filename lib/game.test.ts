import { describe, expect, it } from "vitest";
import {
  ROUND_MS, roundAt, isLocked, arenaStartRound, settleDelta, outcome, prizeSplit, stakeOptions,
  standings, simPrice, type Arena,
} from "./game";

const T = Date.UTC(2026, 10, 15, 2, 0, 0); // a :00 boundary

describe("round timing", () => {
  it("aligns rounds to :00/:15/:30/:45", () => {
    const r = roundAt(T + 7 * 60_000);
    expect(r.start).toBe(T);
    expect(r.end).toBe(T + ROUND_MS);
    expect(new Date(r.end).getUTCMinutes()).toBe(15);
  });
  it("locks calls one minute before close", () => {
    expect(isLocked(T + 13 * 60_000 + 59_000)).toBe(false);
    expect(isLocked(T + 14 * 60_000)).toBe(true);
    expect(isLocked(T + ROUND_MS)).toBe(false); // new round open
  });
  it("starts arenas on a round boundary", () => {
    expect(arenaStartRound(T + 2 * 60_000)).toBe(roundAt(T).id);
    expect(arenaStartRound(T + 10 * 60_000)).toBe(roundAt(T).id + 1);
  });
});

describe("settlement", () => {
  it("pays even money on close vs open", () => {
    expect(settleDelta("UP", 50, 100, 101)).toBe(50);
    expect(settleDelta("UP", 50, 100, 99)).toBe(-50);
    expect(settleDelta("DOWN", 50, 100, 99)).toBe(50);
    expect(outcome("DOWN", 100, 100)).toBe("PUSH");
    expect(settleDelta("DOWN", 50, 100, 100)).toBe(0);
  });
  it("scales stake chips to bankroll", () => {
    expect(stakeOptions(1000)).toEqual([10, 25, 50, 100]);
  });
  it("replays an arena with a human call", () => {
    const start = roundAt(T).id;
    const arena: Arena = {
      code: "TEST01", name: "t", entryFee: 5, startRound: start, rounds: 4, bankroll: 1000,
      players: [{ id: "me", name: "Me" }],
      calls: { [start]: { me: { side: "UP", stake: 100, at: T } }, [start + 1]: { me: { side: "UP", stake: 100, at: T } } },
    };
    const prices = (id: number) => (id === start ? { open: 1, close: 2 } : { open: 2, close: 1 });
    const s = standings(arena, prices, T + 2 * ROUND_MS + 1);
    expect(s[0].bankroll).toBe(1000); // +100 then -100
    expect(s[0].wins).toBe(1);
    expect(s[0].losses).toBe(1);
  });
});

describe("tie-break", () => {
  it("ranks equal bankrolls by who reached them first, then join order", () => {
    const start = roundAt(T).id;
    const arena: Arena = {
      code: "TIE001", name: "t", entryFee: 1, startRound: start, rounds: 4, bankroll: 1000,
      players: [
        { id: "zed", name: "Zed", joinedAt: T },
        { id: "amy", name: "Amy", joinedAt: T + 1000 },
        { id: "bob", name: "Bob", joinedAt: T + 2000 },
        { id: "cat", name: "Cat", joinedAt: T + 500 },
      ],
      calls: {
        // round 1 goes UP: Bob wins +100 at 5 min, Amy wins +100 at 2 min
        [start]: { bob: { side: "UP", stake: 100, at: T + 300_000 }, amy: { side: "UP", stake: 100, at: T + 120_000 } },
      },
    };
    const s = standings(arena, () => ({ open: 1, close: 2 }), T + ROUND_MS + 1);
    // Amy and Bob tie on 1,100; Amy got there first. Zed and Cat tie on 1,000; Zed joined first.
    expect(s.map((x) => x.player.id)).toEqual(["amy", "bob", "zed", "cat"]);
  });
});

describe("prize split", () => {
  it("splits the net pot 50/30/20", () => {
    const p = prizeSplit(10, 10, 0.08);
    expect(p.gross).toBe(100);
    expect(p.fee).toBe(8);
    expect(p.net).toBe(92);
    expect(p.lines.map((l) => l.amount)).toEqual([46, 27.6, 18.4]);
  });
  it("folds unused shares when fewer than 3 players", () => {
    const p = prizeSplit(10, 2, 0);
    expect(p.lines.map((l) => l.amount)).toEqual([12.5, 7.5]);
  });
});

describe("sim feed", () => {
  it("is deterministic", () => {
    expect(simPrice(T)).toBe(simPrice(T));
    expect(simPrice(T)).toBeGreaterThan(10000);
  });
});
