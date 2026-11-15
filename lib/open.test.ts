import { describe, expect, it } from "vitest";
import { openAtBoundary, selectOpen, type CandleRow } from "./open";

const B = Date.UTC(2026, 10, 15, 3, 15); // 04:15 WAT boundary
const rows: CandleRow[] = [
  [B / 1000 + 120, 65225.28, 65294.73, 65240.5, 65247.28, 12.2],
  [B / 1000 + 60, 65169.35, 65256.09, 65245.53, 65240.5, 8.7],
  [B / 1000, 65154.78, 65255.44, 65162.06, 65245.54, 24.7],
  [B / 1000 - 60, 65200, 65260, 65226.06, 65162.06, 9.1],
];

describe("openAtBoundary", () => {
  it("takes the open of the 1m candle starting exactly at the boundary", () => {
    expect(openAtBoundary(rows, B)).toBe(65162.06);
  });
  it("returns null until that candle exists (never the previous minute)", () => {
    expect(openAtBoundary(rows.slice(3), B)).toBeNull();
    expect(openAtBoundary(null, B)).toBeNull();
  });
});

describe("selectOpen", () => {
  it("prefers 15m, then 1m, then the provisional tick", () => {
    expect(selectOpen({ c15: 65162.06, m1: 65162.06, provisional: 65177.68 })).toEqual({ open: 65162.06, source: "15m" });
    expect(selectOpen({ m1: 65162.06, provisional: 65177.68 })).toEqual({ open: 65162.06, source: "1m" });
    expect(selectOpen({ provisional: 65177.68 })).toEqual({ open: 65177.68, source: "provisional" });
  });
  it("replaces the provisional value as soon as the 1m candle lands", () => {
    const before = selectOpen({ provisional: 65177.68 });
    const after = selectOpen({ provisional: 65177.68, m1: 65162.06 });
    expect(before.source).toBe("provisional");
    expect(after).toEqual({ open: 65162.06, source: "1m" });
  });
  it("uses the simulated open in sim mode and is blank only with no data at all", () => {
    expect(selectOpen({ sim: 64000, c15: 1 })).toEqual({ open: 64000, source: "sim" });
    expect(selectOpen({})).toEqual({ open: null, source: null });
  });
});
