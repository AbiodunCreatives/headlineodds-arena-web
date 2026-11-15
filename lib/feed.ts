"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ROUND_MS, roundAt, roundById, simPrice, type RoundPrice } from "./game";
import { openAtBoundary, parseKline, roundResultFromKlines, selectOpen, type CandleRow, type OpenSource } from "./open";

export type FeedMode = "live" | "sim";
export interface Point { t: number; p: number }

// Binance public market data (no key, CORS open). The data-api.binance.vision mirror is used because
// api.binance.com refuses requests from some regions (HTTP 451). Pair: BTCUSDT.
const BN = "https://data-api.binance.vision/api/v3";
const SYMBOL = "BTCUSDT";
const klines = (interval: "1m" | "15m", extra = "") => `${BN}/klines?symbol=${SYMBOL}&interval=${interval}&limit=300${extra}`;
interface CandleRound extends RoundPrice { fetchedAt: number }

async function getJSON<T>(url: string): Promise<T> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), 6000);
  try {
    // Binance rejects unknown query params, so no cache-buster: it already sends Cache-Control: no-store.
    const r = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()) as T;
  } finally {
    clearTimeout(id);
  }
}

/**
 * Settlement prices (Binance 15m open and close) for one round, fetched directly so a dare can settle even when
 * the device was offline for days. Returns null until the round is final on Binance.
 */
export async function fetchRoundResult(roundId: number): Promise<RoundPrice | null> {
  const start = roundById(roundId).start;
  try {
    const rows = await getJSON<CandleRow[]>(klines("15m", `&startTime=${start}&endTime=${start + ROUND_MS}`));
    return roundResultFromKlines(rows, start, ROUND_MS);
  } catch {
    return null;
  }
}

/** Live BTCUSDT price, the current round's open and a chart. Falls back to a simulated feed for display only. */
export function useBtcFeed() {
  const [now, setNow] = useState(() => Date.now());
  // live unless the public feed has failed three times in a row (it keeps retrying and switches back)
  const [liveOk, setLiveOk] = useState(true);
  const mode: FeedMode = !liveOk ? "sim" : "live";
  const [livePt, setLivePt] = useState<Point | null>(null);
  const livePrice = livePt?.p ?? null;
  const [rounds, setRounds] = useState<Map<number, CandleRound>>(new Map());
  const [minuteBars, setMinuteBars] = useState<Point[]>([]);
  // 1-minute candles keyed by start ms. they are published as soon as the minute starts,
  // so they give the official round open right after the boundary and the exact close at settlement.
  const [minutes, setMinutes] = useState<{ at: number; m: Map<number, RoundPrice> }>({ at: 0, m: new Map() });
  // provisional opens: a live tick fetched within 15s of each boundary (shown only until the 1m candle lands);
  // if we have none (tab opened mid-round), the latest tick of this round stands in so OPEN is never blank
  const [provisional, setProvisional] = useState<Record<number, number>>({});
  // official round opens from the first 1-minute candle of each round
  const [m1Opens, setM1Opens] = useState<Record<number, number>>({});
  const ticks = useRef<Point[]>([]);
  const fails = useRef(0);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const fail = useCallback(() => {
    fails.current++;
    if (fails.current >= 3) setLiveOk(false);
  }, []);

  const pullTicker = useCallback(async () => {
    try {
      const t = await getJSON<{ price: string }>(`${BN}/ticker/price?symbol=${SYMBOL}`);
      const p = Number(t.price);
      if (!Number.isFinite(p)) return;
      fails.current = 0;
      setLiveOk(true);
      const pt = { t: Date.now(), p };
      setLivePt(pt);
      ticks.current = [...ticks.current.filter((x) => x.t > Date.now() - ROUND_MS * 2), pt];
      // a tick taken right after the boundary is the best stand-in for the open until the 1m candle lands
      const r = roundAt(pt.t);
      if (pt.t - r.start < 15_000) setProvisional((m) => (m[r.id] ? m : { ...m, [r.id]: p }));
    } catch {
      fail();
    }
  }, [fail]);

  /** Returns true when the candle for the current round exists. */
  const pullCandles = useCallback(async (): Promise<boolean> => {
    try {
      const [c15, c1] = await Promise.all([
        getJSON<CandleRow[]>(klines("15m")),
        getJSON<CandleRow[]>(klines("1m")),
      ]);
      const fetchedAt = Date.now();
      const m = new Map<number, CandleRound>();
      for (const r of c15) { const c = parseKline(r); m.set(Math.floor(c.start / ROUND_MS), { open: c.open, close: c.close, fetchedAt }); }
      setRounds(m);
      const k1 = c1.map(parseKline);
      setMinuteBars(k1.map((c) => ({ t: c.start + 60_000, p: c.close })).sort((a, b) => a.t - b.t));
      const mm = new Map<number, RoundPrice>();
      for (const c of k1) mm.set(c.start, { open: c.open, close: c.close });
      setMinutes({ at: fetchedAt, m: mm });
      const cur = roundAt(fetchedAt);
      return m.has(cur.id) || mm.has(cur.start);
    } catch {
      fail();
      return false;
    }
  }, [fail]);

  // live ticker every 5s, candles every 30s (kept running during a sim fallback so live data can resume)
  useEffect(() => {
    pullTicker();
    pullCandles();
    const a = setInterval(pullTicker, 5000);
    const b = setInterval(pullCandles, 30_000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [pullTicker, pullCandles]);

  // At every bell (and on first load): grab a fresh tick right away as a provisional stand-in, then poll the
  // 1-minute candle that starts at the boundary every 1.5s until it exists. Its open equals the 15m open.
  const roundId = roundAt(now).id;
  useEffect(() => {
    const start = roundById(roundId).start;
    let alive = true;
    pullTicker();
    pullCandles();
    const loop = async () => {
      for (let tries = 0; alive && tries < 200; tries++) {
        try {
          const rows = await getJSON<CandleRow[]>(klines("1m", `&startTime=${start}&endTime=${start + 120_000}`));
          const o = openAtBoundary(rows, start);
          if (o != null) {
            if (alive) setM1Opens((m) => ({ ...m, [roundId]: o }));
            pullCandles(); // refresh the chart and the settled round's close
            return;
          }
        } catch {
          /* keep trying */
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    };
    loop();
    return () => { alive = false; };
  }, [roundId, pullTicker, pullCandles]);

  const round = roundAt(now);
  const price = mode === "live" && livePrice ? livePrice : simPrice(now);

  const choice = selectOpen({
    sim: mode === "sim" ? simPrice(round.start) : null,
    c15: rounds.get(round.id)?.open ?? null,
    m1: m1Opens[round.id] ?? minutes.m.get(round.start)?.open ?? null,
    provisional: provisional[round.id] ?? (livePt && livePt.t >= round.start ? livePt.p : null),
  });
  const open = choice.open;
  const openSource: OpenSource | null = choice.source;

  let chart: Point[];
  if (mode === "sim") {
    chart = [];
    for (let t = round.start; t < now; t += 10_000) chart.push({ t, p: simPrice(t) });
    chart.push({ t: now, p: price });
  } else {
    const pts = [
      ...minuteBars.filter((b) => b.t > round.start && b.t < now - 30_000),
      ...ticks.current.filter((x) => x.t > round.start),
    ];
    pts.sort((a, b) => a.t - b.t);
    chart = open ? [{ t: round.start, p: open }, ...pts] : pts;
    if (chart.length && livePrice && chart[chart.length - 1].t < now - 1000) chart.push({ t: now, p: livePrice });
  }

  return { now, mode, price, open, openSource, round, chart, ready: mode === "sim" || livePrice !== null };
}
