"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ROUND_MS, roundAt, roundById, simPrice, type RoundPrice } from "./game";

export type FeedMode = "live" | "sim";
export interface Point { t: number; p: number }

const CB = "https://api.exchange.coinbase.com/products/BTC-USD";
// Coinbase candle rows: [time(s), low, high, open, close, volume]
type Candle = [number, number, number, number, number, number];

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
  const [rounds, setRounds] = useState<Map<number, RoundPrice & { done: boolean }>>(new Map());
  const [minuteBars, setMinuteBars] = useState<Point[]>([]);
  const ticks = useRef<Point[]>([]);
  const fails = useRef(0);

  // 1s clock
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

  // live ticker every 5s
  useEffect(() => {
    if (mode !== "live") return;
    let alive = true;
    const pull = async () => {
      try {
        const t = await getJSON<{ price: string }>(`${CB}/ticker`);
        const p = Number(t.price);
        if (!alive || !Number.isFinite(p)) return;
        fails.current = 0;
        setLivePrice(p);
        ticks.current = [...ticks.current.filter((x) => x.t > Date.now() - ROUND_MS * 2), { t: Date.now(), p }];
      } catch {
        fail();
      }
    };
    pull();
    const id = setInterval(pull, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [mode, fail]);

  // live 15m + 1m candles every 30s
  useEffect(() => {
    if (mode !== "live") return;
    let alive = true;
    const pull = async () => {
      try {
        const [c15, c1] = await Promise.all([
          getJSON<Candle[]>(`${CB}/candles?granularity=900`),
          getJSON<Candle[]>(`${CB}/candles?granularity=60`),
        ]);
        if (!alive) return;
        const m = new Map<number, RoundPrice & { done: boolean }>();
        const cur = roundAt(Date.now()).id;
        for (const c of c15) {
          const id = Math.floor((c[0] * 1000) / ROUND_MS);
          m.set(id, { open: c[3], close: c[4], done: id < cur });
        }
        setRounds(m);
        setMinuteBars(c1.map((c) => ({ t: c[0] * 1000 + 60_000, p: c[4] })).sort((a, b) => a.t - b.t));
      } catch {
        fail();
      }
    };
    pull();
    const id = setInterval(pull, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, [mode, fail]);

  const round = roundAt(now);
  const price = mode === "live" && livePrice ? livePrice : simPrice(now);

  const prices = useCallback(
    (id: number): RoundPrice | null => {
      const r = roundById(id);
      if (r.end > Date.now()) return null;
      if (mode === "sim") return { open: simPrice(r.start), close: simPrice(r.end) };
      const c = rounds.get(id);
      // the candle for a just-closed round is final once the next one exists
      if (!c || !c.done) return null;
      return { open: c.open, close: c.close };
    },
    [mode, rounds],
  );

  let open: number | null;
  if (mode === "sim") open = simPrice(round.start);
  else open = rounds.get(round.id)?.open ?? null;

  let chart: Point[];
  if (mode === "sim") {
    chart = [];
    for (let t = round.start; t < now; t += 10_000) chart.push({ t, p: simPrice(t) });
    chart.push({ t: now, p: price });
  } else {
    const pts = [...minuteBars.filter((b) => b.t > round.start && b.t < now - 30_000), ...ticks.current.filter((x) => x.t >= round.start)];
    pts.sort((a, b) => a.t - b.t);
    chart = open ? [{ t: round.start, p: open }, ...pts] : pts;
  }

  return { now, mode, price, open, round, prices, chart, ready: mode === "sim" || livePrice !== null };
}
