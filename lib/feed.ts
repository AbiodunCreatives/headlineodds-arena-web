"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ROUND_MS, roundAt, roundById, simPrice, type RoundPrice } from "./game";

export type FeedMode = "live" | "sim";
export interface Point { t: number; p: number }

const CB = "https://api.exchange.coinbase.com/products/BTC-USD";
// Coinbase candle rows: [time(s), low, high, open, close, volume]
type Candle = [number, number, number, number, number, number];
interface CandleRound extends RoundPrice { fetchedAt: number }

async function getJSON<T>(url: string): Promise<T> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()) as T;
  } finally {
    clearTimeout(id);
  }
}

export function useBtcFeed(forceSim: boolean) {
  const [now, setNow] = useState(() => Date.now());
  const [mode, setMode] = useState<FeedMode>(forceSim ? "sim" : "live");
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [rounds, setRounds] = useState<Map<number, CandleRound>>(new Map());
  const [minuteBars, setMinuteBars] = useState<Point[]>([]);
  // provisional opens: the last live tick seen at (or just before) each round's bell
  const [provisional, setProvisional] = useState<Record<number, number>>({});
  const ticks = useRef<Point[]>([]);
  const lastTick = useRef<Point | null>(null);
  const fails = useRef(0);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setMode(forceSim ? "sim" : "live");
    fails.current = 0;
  }, [forceSim]);

  const fail = useCallback(() => {
    fails.current++;
    if (fails.current >= 2) setMode("sim");
  }, []);

  const pullTicker = useCallback(async () => {
    try {
      const t = await getJSON<{ price: string }>(`${CB}/ticker`);
      const p = Number(t.price);
      if (!Number.isFinite(p)) return;
      fails.current = 0;
      const pt = { t: Date.now(), p };
      lastTick.current = pt;
      setLivePrice(p);
      ticks.current = [...ticks.current.filter((x) => x.t > Date.now() - ROUND_MS * 2), pt];
      // first tick we see in a round becomes its provisional open if we have nothing better
      const r = roundAt(pt.t);
      if (pt.t - r.start < 20_000) setProvisional((m) => (m[r.id] ? m : { ...m, [r.id]: p }));
    } catch {
      fail();
    }
  }, [fail]);

  /** Returns true when the candle for the current round exists. */
  const pullCandles = useCallback(async (): Promise<boolean> => {
    try {
      const [c15, c1] = await Promise.all([
        getJSON<Candle[]>(`${CB}/candles?granularity=900`),
        getJSON<Candle[]>(`${CB}/candles?granularity=60`),
      ]);
      const fetchedAt = Date.now();
      const m = new Map<number, CandleRound>();
      for (const c of c15) m.set(Math.floor((c[0] * 1000) / ROUND_MS), { open: c[3], close: c[4], fetchedAt });
      setRounds(m);
      setMinuteBars(c1.map((c) => ({ t: c[0] * 1000 + 60_000, p: c[4] })).sort((a, b) => a.t - b.t));
      return m.has(roundAt(fetchedAt).id);
    } catch {
      fail();
      return false;
    }
  }, [fail]);

  // live ticker every 5s, candles every 30s
  useEffect(() => {
    if (mode !== "live") return;
    pullTicker();
    pullCandles();
    const a = setInterval(pullTicker, 5000);
    const b = setInterval(pullCandles, 30_000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [mode, pullTicker, pullCandles]);

  // At every bell: use the last tick as a provisional open straight away, grab a fresh tick,
  // then poll the 15m candles every 2.5s until the new round's official candle exists.
  const roundId = roundAt(now).id;
  useEffect(() => {
    if (mode !== "live") return;
    const lt = lastTick.current;
    if (lt && lt.t > roundById(roundId).start - 30_000) setProvisional((m) => (m[roundId] ? m : { ...m, [roundId]: lt.p }));
    pullTicker();
    let alive = true;
    let tries = 0;
    const loop = async () => {
      while (alive && tries < 24) {
        tries++;
        if (await pullCandles()) return;
        await new Promise((r) => setTimeout(r, 2500));
      }
    };
    loop();
    return () => { alive = false; };
  }, [roundId, mode, pullTicker, pullCandles]);

  const round = roundAt(now);
  const price = mode === "live" && livePrice ? livePrice : simPrice(now);

  const prices = useCallback(
    (id: number): RoundPrice | null => {
      const r = roundById(id);
      if (r.end > Date.now()) return null;
      if (mode === "sim") return { open: simPrice(r.start), close: simPrice(r.end) };
      const c = rounds.get(id);
      // a candle is final once it was fetched after the round's bell
      if (!c || c.fetchedAt < r.end) return null;
      return { open: c.open, close: c.close };
    },
    [mode, rounds],
  );

  let open: number | null;
  let openSource: "candle" | "tick" | "sim" | null;
  if (mode === "sim") {
    open = simPrice(round.start);
    openSource = "sim";
  } else if (rounds.get(round.id)) {
    open = rounds.get(round.id)!.open;
    openSource = "candle";
  } else if (provisional[round.id]) {
    open = provisional[round.id];
    openSource = "tick";
  } else {
    open = null;
    openSource = null;
  }

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

  return { now, mode, price, open, openSource, round, prices, chart, ready: mode === "sim" || livePrice !== null };
}
