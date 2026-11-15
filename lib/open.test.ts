import { describe, expect, it } from "vitest";
import { openAtBoundary, parseKline, roundResultFromKlines, selectOpen, type CandleRow } from "./open";

const B = Date.UTC(2026, 10, 15, 3, 15); // 04:15 WAT boundary
// Binance klines: [openTime(ms), open, high, low, close, volume, closeTime(ms)], oldest first, prices as strings
const k = (t: number, o: string, h: string, l: string, c: string): CandleRow => [t, o, h, l, c, "1.0", t + 59_999];
const rows: CandleRow[] = [
  k(B - 60_000, "65226.06", "65260.00", "65200.00", "65162.06"),
  k(B, "65162.06", "65255.44", "65154.78", "65245.54"),
  k(B + 60_000, "65245.53", "65256.09", "65169.35", "65240.50"),
  k(B + 120_000, "65240.50", "65294.73", "65225.28", "65247.28"),
];

describe("openAtBoundary", () => {
  it("takes the open of the 1m candle starting exactly at the boundary", () => {
    expect(openAtBoundary(rows, B)).toBe(65162.06);
  });
  it("returns null until that candle exists (never the previous minute)", () => {
    expect(openAtBoundary(rows.slice(0, 1), B)).toBeNull();
    expect(openAtBoundary(null, B)).toBeNull();
  });
  it("matches on milliseconds, not seconds", () => {
    expect(openAtBoundary(rows, B / 1000)).toBeNull();
  });
});

describe("parseKline", () => {
  it("reads Binance's open, high, low, close order and string prices", () => {
    expect(parseKline(rows[1])).toEqual({ start: B, open: 65162.06, high: 65255.44, low: 65154.78, close: 65245.54 });
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

describe("roundResultFromKlines", () => {
  const M15 = 15 * 60_000;
  const k15 = (t: number, o: string, c: string): CandleRow => [t, o, "0", "0", c, "1.0", t + M15 - 1];
  it("returns the 15m open and close once the next 15m candle exists", () => {
    const r = [k15(B, "65162.06", "65300.10"), k15(B + M15, "65300.10", "65310.00")];
    expect(roundResultFromKlines(r, B)).toEqual({ open: 65162.06, close: 65300.1 });
  });
  it("is null while the round's candle is still the latest (close not final)", () => {
    expect(roundResultFromKlines([k15(B, "65162.06", "65300.10")], B)).toBeNull();
    expect(roundResultFromKlines(null, B)).toBeNull();
  });
});
