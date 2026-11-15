"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Side } from "@/lib/game";
import { fetchRoundResult, useBtcFeed } from "@/lib/feed";
import { useSaved, type Saved } from "@/lib/store";
import {
  FEE_AMOUNT, PLATFORM_FEE, POT, STAKE, TOP_UP, WIN_PAYOUT, acceptDare, acceptDeadline, applyResult, buildLink, canAfford, createDare, decodeAcceptance,
  decodeOffer, encodeToken, escrowView, mySide, newDareId, opposite, parseHash, reconcile, recordAcceptance,
  roundEnd, roundsToSettle, statusOf, targetRound, type DareOffer, type DareRecord, type DareStatus, type Escrow,
} from "@/lib/dare";
import { usd, hhmm, clock, pct } from "@/lib/fmt";
import Chart from "./Chart";
import Logo from "./Logo";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
const roundLabel = (roundId: number) => `${hhmm(acceptDeadline(roundId))}–${hhmm(roundEnd(roundId))}`;

function randomId(): string {
  const buf = new Uint32Array(10);
  crypto.getRandomValues(buf);
  let i = 0;
  return newDareId(() => buf[i++] / 4294967296);
}

export default function App() {
  const { s, setS, loaded, reset } = useSaved();
  const feed = useBtcFeed();
  const { now, round, price, open, openSource } = feed;
  const [side, setSide] = useState<Side>("UP");
  const [incoming, setIncoming] = useState<DareOffer | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ kind: "dare" | "accept"; url: string; to: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(null), 3200); }, []);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const sRef = useRef<Saved>(s);
  sRef.current = s;

  const withEscrow = useCallback((fn: (e: Escrow) => Escrow) => setS((x) => {
    const e = fn(x);
    return e === x ? x : { ...x, ...e };
  }), [setS]);

  // ----- links: #dare=... (friend opens the challenge) and #accept=... (challenger records the acceptance) -----
  const readHash = useCallback(() => {
    const h = parseHash(window.location.hash);
    if (!h) return;
    if (h.kind === "dare") {
      const o = decodeOffer(h.token);
      if (!o) { setLinkError("this dare link is broken or incomplete."); return; }
      setIncoming(o);
      setLinkError(null);
      return;
    }
    const acc = decodeAcceptance(h.token);
    history.replaceState(null, "", window.location.pathname + window.location.search);
    if (!acc) { setLinkError("this acceptance link is broken or incomplete."); return; }
    const r = recordAcceptance(sRef.current, acc);
    if (!r.ok) { flash(r.error); return; }
    setS((x) => {
      const again = recordAcceptance(x, acc);
      return again.ok && again.escrow !== x ? { ...x, ...again.escrow } : x;
    });
    flash(`${acc.by} accepted. both stakes are in escrow for the ${roundLabel(acc.roundId)} round.`);
  }, [setS, flash]);

  useEffect(() => {
    if (!loaded) return;
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, [loaded, readHash]);

  // ----- escrow upkeep: pay out / refund whatever is due, and fetch settlement candles for closed rounds -----
  useEffect(() => {
    if (loaded) withEscrow((e) => reconcile(e, Date.now()));
  }, [loaded, now, s.dares, withEscrow]);

  const settling = useRef(false);
  const lastTry = useRef(0);
  useEffect(() => {
    if (!loaded || settling.current || Date.now() - lastTry.current < 5000) return;
    const ids = roundsToSettle(s, Date.now());
    if (!ids.length) return;
    settling.current = true;
    lastTry.current = Date.now();
    (async () => {
      for (const id of ids) {
        const px = await fetchRoundResult(id);
        if (px) withEscrow((e) => applyResult(e, id, px));
      }
      settling.current = false;
    })();
  }, [loaded, now, s, withEscrow]);

  // ----- actions -----
  function create() {
    const r = createDare(s, { id: randomId(), side, name: s.name, now: Date.now() });
    if (!r.ok) return flash(r.error);
    withEscrow(() => r.escrow);
    setFresh({ kind: "dare", url: buildLink(origin, BASE, "dare", encodeToken(r.value)), to: "your friend" });
  }

  function accept(o: DareOffer) {
    const r = acceptDare(s, o, s.name, Date.now());
    if (!r.ok) return flash(r.error);
    withEscrow(() => r.escrow);
    setIncoming(null);
    history.replaceState(null, "", window.location.pathname + window.location.search);
    setFresh({ kind: "accept", url: buildLink(origin, BASE, "accept", encodeToken(r.value)), to: o.from });
  }

  const linkFor = (d: DareRecord) =>
    d.role === "challenger"
      ? buildLink(origin, BASE, "dare", encodeToken(d.offer))
      : buildLink(origin, BASE, "accept", encodeToken({ v: 1, id: d.offer.id, roundId: d.offer.roundId, by: d.friend!, at: d.acceptedAt! }));

  if (!loaded) return <div className="boot">Loading Dare15…</div>;

  const delta = open ? price - open : 0;
  const nextRound = targetRound(now);
  const affordable = canAfford(s.balance);
  const incomingMine = incoming ? s.dares.find((d) => d.offer.id === incoming.id) : undefined;
  const incomingLate = incoming ? now >= acceptDeadline(incoming.roundId) : false;

  return (
    <div className="shell">
      <div className="demo-banner" role="status">
        <b>TEST VERSION</b> · test USDC only, no real money ·{" "}
        {feed.mode === "live" ? <span>btc price: <b>live Binance BTCUSDT</b></span> : <span>btc price: <b>simulated</b> (live feed unreachable; dares wait for Binance to settle)</span>}
      </div>

      <header className="top">
        <div className="brand">
          <Logo />
          <span className="tagline">dare a friend: btc up or down in 15 minutes.</span>
        </div>
        <span className="usdc">{usd(s.balance)} <small>test usdc</small></span>
      </header>

      <main className="main">
        <section className="board-card">
          <div className="board-head">
            <span>btc/usdt · round {roundLabel(round.id)}</span>
            <span className="lock-tag"><i className="live-dot" />next bell in {clock(round.end - now)}</span>
          </div>
          <div className="prices">
            <div><small>{openSource === "provisional" ? "open (provisional)" : "round open"}</small><b>{open ? `$${usd(open)}` : "…"}</b></div>
            <div><small>live btc</small><b className={delta >= 0 ? "t-up" : "t-down"}>${usd(price)}</b></div>
            <div><small>move</small><b className={delta >= 0 ? "t-up" : "t-down"}>{delta >= 0 ? "▲" : "▼"} {open ? pct(price, open).toFixed(3) : "0.000"}%</b></div>
          </div>
          <Chart points={feed.chart} open={open} start={round.start} end={round.end} now={now} />
        </section>

        {linkError && <div className="join-card warn" role="alert">{linkError}</div>}

        {incoming && !incomingMine && (
          <section className="join-card accept-card" data-testid="accept-card">
            <h3>{incoming.from} dares you</h3>
            <p>
              {incoming.from} says btc goes <b className={incoming.side === "UP" ? "t-up" : "t-down"}>{incoming.side.toLowerCase()}</b> in the{" "}
              <b>{roundLabel(incoming.roundId)}</b> round. you take <b className={incoming.side === "UP" ? "t-down" : "t-up"}>{opposite(incoming.side).toLowerCase()}</b>.
              {" "}{STAKE} test usdc each goes into escrow; the winner gets {usd(WIN_PAYOUT)} ({POT} pot minus the {PLATFORM_FEE * 100}% platform fee). a flat close refunds both in full.
            </p>
            {incomingLate ? (
              <p className="t-down">this round has already started, so the dare can&apos;t be accepted any more.</p>
            ) : (
              <>
                <input className="input" placeholder="your name" value={s.name} maxLength={18} onChange={(e) => setS((x) => ({ ...x, name: e.target.value }))} aria-label="your name" />
                <p className="muted">accept before {hhmm(acceptDeadline(incoming.roundId))} ({clock(acceptDeadline(incoming.roundId) - now)} left).</p>
                <div className="row">
                  <button className="btn-primary" disabled={!affordable || !s.name.trim()} onClick={() => accept(incoming)}>
                    accept · lock {STAKE} test usdc
                  </button>
                  <button className="btn-secondary" onClick={() => { setIncoming(null); history.replaceState(null, "", window.location.pathname); }}>not now</button>
                </div>
                {!affordable && <p className="t-down">you need at least {STAKE} test usdc. top up your test balance below.</p>}
              </>
            )}
          </section>
        )}
        {incoming && incomingMine && (
          <div className="join-card">{incomingMine.role === "challenger" ? "this is your own dare. send the link to a friend." : "you've already accepted this dare. see it under your dares."}</div>
        )}

        {fresh && (
          <section className="join-card linkbox" data-testid="share-box">
            <h3>{fresh.kind === "dare" ? "dare created. send this link to your friend" : `accepted. send this link back to ${fresh.to}`}</h3>
            <p>{fresh.kind === "dare"
              ? "they open it, accept, and send you a link back. open that link here so this device records their stake too."
              : `${fresh.to} opens it so their device records your stake. both devices then settle from the same Binance candle.`}</p>
            <LinkRow url={fresh.url} onCopied={() => flash("link copied")} />
            <button className="btn-secondary" onClick={() => setFresh(null)}>done</button>
          </section>
        )}

        <section className="board-card">
          <div className="board-head"><span>dare a friend</span><span className="tag-demo">{STAKE} test usdc each</span></div>
          <div className="form">
            <label>your name<input className="input" placeholder="e.g. bayo" value={s.name} maxLength={18} onChange={(e) => setS((x) => ({ ...x, name: e.target.value }))} /></label>
            <label>your call for the {roundLabel(nextRound)} round
              <div className="updown">
                <button className={`btn-up ${side === "UP" ? "picked" : ""}`} aria-pressed={side === "UP"} onClick={() => setSide("UP")}><span>up</span><small>closes above its open</small></button>
                <button className={`btn-down ${side === "DOWN" ? "picked" : ""}`} aria-pressed={side === "DOWN"} onClick={() => setSide("DOWN")}><span>down</span><small>closes below its open</small></button>
              </div>
            </label>
            <p className="muted">your friend takes the other side. they have until {hhmm(acceptDeadline(nextRound))} to accept; if they don&apos;t, your {STAKE} comes back when the round closes. win {usd(WIN_PAYOUT)} test usdc ({POT} pot minus {PLATFORM_FEE * 100}% fee).</p>
            <button className="btn-primary" disabled={!affordable || !s.name.trim()} onClick={create}>create dare link · lock {STAKE} test usdc</button>
            {!affordable && <p className="t-down">you need at least {STAKE} test usdc to dare a friend.</p>}
          </div>
        </section>

        <section className="feed">
          <h3>your dares</h3>
          {s.dares.length === 0 ? <p className="muted">no dares yet.</p> : (
            <ul>{s.dares.map((d) => <DareRow key={d.offer.id} d={d} now={now} link={linkFor(d)} onCopied={() => flash("link copied")} />)}</ul>
          )}
        </section>

        <section className="board-card">
          <div className="board-head"><span>test wallet</span><span className="tag-demo">not real money</span></div>
          <div className="big-bal">{usd(s.balance)} <small>test usdc</small></div>
          <div className="row">
            <button className="btn-secondary" onClick={() => setS((x) => ({ ...x, balance: +(x.balance + TOP_UP).toFixed(2), ledger: [{ at: Date.now(), text: "test top-up", amount: TOP_UP }, ...x.ledger] }))}>+{TOP_UP} test usdc</button>
            <button className="btn-secondary" onClick={() => { if (confirm("reset all Dare15 test data on this device?")) { reset(); setFresh(null); } }}>reset</button>
          </div>
          <ul className="ledger">
            {s.ledger.slice(0, 12).map((l, i) => (
              <li key={i}><span className="f-time">{hhmm(l.at)}</span>{l.text} {l.amount !== 0 && <b className={l.amount > 0 ? "t-up" : "t-down"}>{l.amount > 0 ? "+" : ""}{usd(l.amount)}</b>}{l.platform ? <span className="muted"> platform {l.platform > 0 ? "+" : ""}{usd(l.platform)}</span> : null}</li>
            ))}
          </ul>
        </section>

        <section className="maths">
          <h3>how a dare works</h3>
          <ol className="rules">
            <li>you pick up or down for the next 15-minute round (rounds start at :00, :15, :30 and :45). if that bell is under 5 minutes away, the dare uses the round after.</li>
            <li>creating the link locks your {STAKE} test usdc. your friend accepts before the bell and locks {STAKE}; the escrow holds {POT}.</li>
            <li>the round settles on Binance&apos;s BTCUSDT 15-minute candle: close above open means up wins, below means down wins. the winner gets {usd(WIN_PAYOUT)} test usdc: the {POT} pot minus an {PLATFORM_FEE * 100}% platform fee ({usd(FEE_AMOUNT)}).</li>
            <li>flat close: both get their full {STAKE} back, no fee. no acceptance by the bell: you get your full {STAKE} back when the round closes, no fee.</li>
          </ol>
          <p className="muted">test version: there&apos;s no server, so each device keeps its own escrow ledger and settles from the same candle. it isn&apos;t real escrow.</p>
        </section>
      </main>

      {toast && <div className="toast" role="status">{toast}</div>}
      <footer className="foot">Dare15 · a test version · test usdc only, no real money</footer>
    </div>
  );
}

function LinkRow({ url, onCopied }: { url: string; onCopied: () => void }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); onCopied(); } catch { window.prompt("copy this link", url); }
  };
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  return (
    <div className="linkrow">
      <input className="input mono" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="share link" data-testid="share-link" />
      <div className="row">
        <button className="btn-small btn-primary" onClick={copy}>copy</button>
        {canShare && <button className="btn-small btn-secondary" onClick={() => navigator.share({ title: "Dare15", url }).catch(() => {})}>share</button>}
      </div>
    </div>
  );
}

const STATUS_TEXT: Record<DareStatus, string> = {
  waiting: "waiting for your friend",
  unanswered: "no acceptance received yet",
  matched: "matched · starts at the bell",
  live: "live",
  settling: "settling (waiting for Binance's 15m candle)",
  won: "won",
  lost: "lost",
  tie: "flat close · refunded",
  expired: "expired · refunded",
};

function DareRow({ d, now, link, onCopied }: { d: DareRecord; now: number; link: string; onCopied: () => void }) {
  const st = statusOf(d, now);
  const esc = escrowView(d);
  const me = mySide(d);
  const other = d.role === "challenger" ? d.friend ?? "your friend" : d.offer.from;
  const showLink = (d.role === "challenger" && st === "waiting") || (d.role === "friend" && (st === "matched" || st === "live"));
  return (
    <li className="dare" data-testid={`dare-${d.offer.id}`} data-status={st}>
      <div><b>{d.role === "challenger" ? `you → ${other}` : `${other} → you`}</b> · round {roundLabel(d.offer.roundId)}</div>
      <div className="muted">
        you: <b className={me === "UP" ? "t-up" : "t-down"}>{me.toLowerCase()}</b> · {other}: {opposite(me).toLowerCase()} ·
        escrow {usd(esc.total)} ({d.offer.from} {usd(esc.challenger)}{d.friend ? `, ${d.friend} ${usd(esc.friend)}` : ""})
      </div>
      {d.result && <div className="muted">open ${usd(d.result.open)} → close ${usd(d.result.close)}</div>}
      <div>
        <span className={`status s-${st}`}>{STATUS_TEXT[st]}</span>
        {st === "waiting" && <span className="muted"> · accept by {hhmm(acceptDeadline(d.offer.roundId))}</span>}
        {st === "unanswered" && <span className="muted"> · if they accepted, open their return link; otherwise refunded at {hhmm(roundEnd(d.offer.roundId))}</span>}
        {st === "won" && <b className="t-up"> +{usd(WIN_PAYOUT)}</b>}
        {(st === "won" || st === "lost") && <span className="muted"> · pot {usd(POT)} → winner {usd(WIN_PAYOUT)} + platform fee {usd(FEE_AMOUNT)}</span>}
      </div>
      {showLink && (
        <details>
          <summary className="muted">{d.role === "challenger" ? "dare link" : "return link for " + d.offer.from}</summary>
          <LinkRow url={link} onCopied={onCopied} />
        </details>
      )}
    </li>
  );
}
