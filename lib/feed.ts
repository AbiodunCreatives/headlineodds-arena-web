"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ROUND_MS, roundAt, roundById, simPrice, type RoundPrice } from "./game";
import { openAtBoundary, selectOpen, type CandleRow, type OpenSource } from "./open";

export type FeedMode = "live" | "sim";
export interface Point { t: number; p: number }

const CB = "https://api.exchange.coinbase.com/products/BTC-USD";
// Coinbase candle rows: [time(s), low, high, open, close, volume]
type Candle = [number, number, number, number, number, number];
interface CandleRound extends RoundPrice { fetchedAt: number }

// Coinbase's CDN caches candle responses for up to 5 minutes per URL, which would hide a just-opened round.
// A unique query param forces a fresh response.
const fresh = (url: string) => `${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}`;

async function getJSON<T>(url: string): Promise<T> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(fresh(url), { signal: ctrl.signal, cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()) as T;
  } finally {
    clearTimeout(id);
  }
}

export function useBtcFeed(forceSim: boolean) {
  const [now, setNow] = useState(() => Date.now());
  // live unless forced to sim, or the public feed has failed three times in a row (it keeps retrying and switches back)
  const [liveOk, setLiveOk] = useState(true);
  const mode: FeedMode = forceSim || !liveOk ? "sim" : "live";
  const [livePt, setLivePt] = useState<Point | null>(null);
  const livePrice = livePt?.p ?? null;
  const [rounds, setRounds] = useState<Map<number, CandleRound>>(new Map());
  const [minuteBars, setMinuteBars] = useState<Point[]>([]);
  // 1-minute candles keyed by start ms. Coinbase serves these fresher than the 15m ones,
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

  useEffect(() => {
    fails.current = 0;
    setLiveOk(true);
  }, [forceSim]);

  const fail = useCallback(() => {
    fails.current++;
    if (fails.current >= 3) setLiveOk(false);
  }, []);

  const pullTicker = useCallback(async () => {
    try {
      const t = await getJSON<{ price: string }>(`${CB}/ticker`);
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
        getJSON<Candle[]>(`${CB}/candles?granularity=900`),
        getJSON<Candle[]>(`${CB}/candles?granularity=60`),
      ]);
      const fetchedAt = Date.now();
      const m = new Map<number, CandleRound>();
      for (const c of c15) m.set(Math.floor((c[0] * 1000) / ROUND_MS), { open: c[3], close: c[4], fetchedAt });
      setRounds(m);
      setMinuteBars(c1.map((c) => ({ t: c[0] * 1000 + 60_000, p: c[4] })).sort((a, b) => a.t - b.t));
      const mm = new Map<number, RoundPrice>();
      for (const c of c1) mm.set(c[0] * 1000, { open: c[3], close: c[4] });
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
    if (forceSim) return;
    pullTicker();
    pullCandles();
    const a = setInterval(pullTicker, 5000);
    const b = setInterval(pullCandles, 30_000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [forceSim, pullTicker, pullCandles]);

  // At every bell (and on first load): grab a fresh tick right away as a provisional stand-in, then poll the
  // 1-minute candle that starts at the boundary every 1.5s until it exists. Its open equals the 15m open.
  const roundId = roundAt(now).id;
  useEffect(() => {
    if (forceSim) return;
    const start = roundById(roundId).start;
    let alive = true;
    pullTicker();
    pullCandles();
    const loop = async () => {
      for (let tries = 0; alive && tries < 200; tries++) {
        try {
          const qs = `granularity=60&start=${new Date(start).toISOString()}&end=${new Date(start + 120_000).toISOString()}`;
          const rows = await getJSON<CandleRow[]>(`${CB}/candles?${qs}`);
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
  }, [roundId, forceSim, pullTicker, pullCandles]);

  const round = roundAt(now);
  const price = mode === "live" && livePrice ? livePrice : simPrice(now);

  const prices = useCallback(
    (id: number): RoundPrice | null => {
      const r = roundById(id);
      if (r.end > Date.now()) return null;
      if (mode === "sim") return { open: simPrice(r.start), close: simPrice(r.end) };
      const c = rounds.get(id);
      // Preferred: exact close from the round's last 1-minute candle, fetched after the boundary.
      const lastMin = minutes.m.get(r.end - 60_000);
      const open = c?.open ?? m1Opens[id] ?? minutes.m.get(r.start)?.open;
      if (lastMin && minutes.at >= r.end && open !== undefined) return { open, close: lastMin.close };
      // Otherwise use the 15m candle, but only once the next round's candle exists (so it can't be a stale snapshot).
      if (c && rounds.has(id + 1)) return { open: c.open, close: c.close };
      return null;
    },
    [mode, rounds, minutes, m1Opens],
  );

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

  return { now, mode, price, open, openSource, round, prices, chart, ready: mode === "sim" || livePrice !== null };
}
