import { describe, expect, it } from "vitest";
import { ROUND_MS, roundAt, roundById, outcome, simPrice } from "./game";

const T = Date.UTC(2026, 10, 15, 2, 0, 0); // a :00 boundary

describe("round timing", () => {
  it("aligns rounds to :00/:15/:30/:45", () => {
    const r = roundAt(T + 7 * 60_000);
    expect(r.start).toBe(T);
    expect(r.end).toBe(T + ROUND_MS);
    expect(new Date(r.end).getUTCMinutes()).toBe(15);
    expect(roundById(r.id + 1).start).toBe(r.end);
  });
});

describe("outcome", () => {
  it("compares close with open; a flat close is a push", () => {
    expect(outcome("UP", 100, 101)).toBe("WIN");
    expect(outcome("UP", 100, 99)).toBe("LOSS");
    expect(outcome("DOWN", 100, 99)).toBe("WIN");
    expect(outcome("DOWN", 100, 100)).toBe("PUSH");
  });
});

describe("sim feed", () => {
  it("is deterministic", () => {
    expect(simPrice(T)).toBe(simPrice(T));
    expect(simPrice(T)).toBeGreaterThan(10000);
  });
});
