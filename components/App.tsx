"use client";
import { useMemo, useState } from "react";
import {
  type Arena, type Player, type Side, type Standing,
  arenaEnded, arenaStartRound, isLocked, makeCode, prizeSplit, roundById, stakeOptions, standings,
  STAKE_PCTS, virtualBankroll, hashStr,
} from "@/lib/game";
import { useBtcFeed } from "@/lib/feed";
import { useSaved, type Saved } from "@/lib/store";
import {
  BOTS, ME_ID, PUBLIC_FEE, publicArena, incomingDareFor, effectiveStatus, dareResult, botFeed,
  DARE_START_CHIPS, type Dare, type FeedItem,
} from "@/lib/world";
import { usd, chips, hhmm, hms, clock, pct, ngn } from "@/lib/fmt";
import Chart from "./Chart";

type Tab = "arena" | "board" | "dares" | "wallet";
const EXAMPLE_RATE = 1500; // illustrative only, NOT a quote

export default function App() {
  const { s, setS, loaded, reset } = useSaved();
  const feed = useBtcFeed(s.forceSim);
  const { now, round, price, open } = feed;
  const [tab, setTab] = useState<Tab>("arena");
  const [stakeIdx, setStakeIdx] = useState(1);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2600); };
  const update = (fn: (x: Saved) => Saved) => setS((x) => fn(x));

  const me: Player = { id: ME_ID, name: s.name || "You" };
  const watching = s.mode !== "play";

  // ----- arenas -----
  const pubBase = publicArena(now);
  const joinedPub = s.joinedPublic.includes(pubBase.code) && !watching;
  const pub = publicArena(now, joinedPub ? me : undefined, s.publicCalls[pubBase.code]);
  const privates = s.arenas;
  const active: Arena =
    (!watching && s.activeCode !== "public" && privates.find((a) => a.code === s.activeCode)) || pub;
  const inActive = active.players.some((p) => p.id === ME_ID);

  const board: Standing[] = useMemo(
    () => standings(active, feed.prices, now),
    // recompute on round change or when prices/calls change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, feed.prices, round.id],
  );
  const myStanding = board.find((b) => b.player.id === ME_ID);
  const bankroll = myStanding?.bankroll ?? active.bankroll;
  const myCall = active.calls[round.id]?.[ME_ID];
  const locked = isLocked(now);
  const arenaLive = round.id >= active.startRound && !arenaEnded(active, now);
  const ended = arenaEnded(active, now);
  const pot = prizeSplit(active.entryFee, active.players.length);

  // ----- previous round -----
  const prevPx = feed.prices(round.id - 1);
  const prevMine = active.calls[round.id - 1]?.[ME_ID];
  const sinceBell = now - round.start;

  // ----- dares -----
  const incoming = incomingDareFor(round.id, s.friends);
  const allDares: Dare[] = useMemo(() => {
    const list = [...s.dares];
    if (incoming && incoming.createdAt <= now && !list.some((d) => d.id === incoming.id)) list.push(incoming);
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }, [s.dares, incoming, now]);
  const dareChips = DARE_START_CHIPS + allDares.reduce((acc, d) => acc + (dareResult(d, now, feed.prices) ?? 0), 0);
  const nameOf = (id: string) => (id === ME_ID ? "You" : [...s.friends, ...BOTS].find((p) => p.id === id)?.name ?? id);

  // ----- live feed -----
  const items: FeedItem[] = [...botFeed(round.id, active.players, now)];
  if (myCall) items.push({ at: myCall.at, text: `You called ${myCall.side} for ${chips(myCall.stake)} chips`, tone: "me" });
  for (const d of allDares) {
    if (d.roundId !== round.id) continue;
    const st = effectiveStatus(d, now);
    items.push({ at: d.createdAt, text: `${nameOf(d.fromId)} dared ${nameOf(d.toId)}: ${d.fromSide} for ${d.stake}`, tone: "dare" });
    if (st !== "pending" && d.fromId === ME_ID) items.push({ at: d.createdAt + 6000, text: `${nameOf(d.toId)} ${st} your dare`, tone: "dare" });
  }
  items.sort((a, b) => b.at - a.at);

  // ----- actions -----
  function call(side: Side) {
    if (watching) return flash("Spectating. Tap Play to make a call.");
    if (!inActive) return flash("Join this arena first.");
    if (locked) return flash("Round is locked. Next one opens at the bell.");
    if (!arenaLive) return flash("This arena hasn't started yet.");
    const stake = Math.min(stakeOptions(bankroll)[stakeIdx], bankroll);
    if (stake <= 0) return flash("No chips left in this arena.");
    update((x) => {
      const setCalls = (calls: Arena["calls"]) => ({ ...calls, [round.id]: { ...(calls[round.id] ?? {}), [ME_ID]: { side, stake, at: Date.now() } } });
      if (active.isPublic) return { ...x, publicCalls: { ...x.publicCalls, [active.code]: setCalls(x.publicCalls[active.code] ?? {}) } };
      return { ...x, arenas: x.arenas.map((a) => (a.code === active.code ? { ...a, calls: setCalls(a.calls) } : a)) };
    });
    flash(`Oya! ${side} for ${chips(stake)} chips. Locks at ${hhmm(round.lockAt)}.`);
  }

  function pay(amount: number, text: string): boolean {
    if (s.usdc < amount) { flash("Not enough mock USDC. Fund your demo wallet first."); setTab("wallet"); return false; }
    update((x) => ({ ...x, usdc: +(x.usdc - amount).toFixed(2), ledger: [{ at: Date.now(), text, amount: -amount }, ...x.ledger] }));
    return true;
  }

  function joinPublic() {
    if (!pay(PUBLIC_FEE, `Entry: ${pub.name}`)) return;
    update((x) => ({ ...x, mode: "play", joinedPublic: [...x.joinedPublic, pubBase.code], activeCode: "public" }));
    flash("You're in the Lagos Open. Oya, make your call!");
  }

  function createArena(name: string, fee: number, rounds: number, friendIds: string[]) {
    if (!pay(fee, `Entry: ${name}`)) return;
    const code = makeCode(hashStr(name + Date.now()));
    const friends = s.friends.filter((f) => friendIds.includes(f.id));
    const fillers = BOTS.filter((_, i) => (hashStr(code) >> i) & 1).slice(0, Math.max(0, 3 - friends.length));
    const arena: Arena = {
      code, name: name || `Arena ${code}`, entryFee: fee, startRound: arenaStartRound(Date.now()), rounds,
      bankroll: virtualBankroll(fee), players: [me, ...friends, ...fillers], calls: {},
    };
    update((x) => ({ ...x, mode: "play", arenas: [arena, ...x.arenas], activeCode: code }));
    setTab("arena");
    flash(`Arena ${code} created. Starts ${hhmm(roundById(arena.startRound).start)}.`);
  }

  function claim() {
    const rank = board.findIndex((b) => b.player.id === ME_ID);
    const line = pot.lines[rank];
    update((x) => ({
      ...x, claimed: [...x.claimed, active.code],
      usdc: +(x.usdc + (line?.amount ?? 0)).toFixed(2),
      ledger: line ? [{ at: Date.now(), text: `Prize: #${rank + 1} in ${active.name}`, amount: line.amount }, ...x.ledger] : x.ledger,
    }));
    flash(line ? `Demo prize ${usd(line.amount)} USDC added.` : "Arena closed. No prize this time.");
  }

  function sendDare(toId: string, side: Side, stake: number) {
    const roundId = locked ? round.id + 1 : round.id;
    const d: Dare = { id: `out-${Date.now()}`, roundId, fromId: ME_ID, toId, fromSide: side, stake, createdAt: Date.now(), status: "pending" };
    update((x) => ({ ...x, dares: [d, ...x.dares] }));
    flash(`Dare sent to ${nameOf(toId)} for round ${hhmm(roundById(roundId).start)}.`);
  }
  function answerDare(d: Dare, accept: boolean) {
    update((x) => ({ ...x, dares: [{ ...d, status: accept ? "accepted" : "declined" }, ...x.dares.filter((y) => y.id !== d.id)] }));
    flash(accept ? `Dare accepted. You're ${d.fromSide === "UP" ? "DOWN" : "UP"}.` : "Dare declined.");
  }

  if (!loaded) return <div className="boot">Loading arena…</div>;

  const delta = open ? price - open : 0;
  const winning = myCall && open ? (price === open ? null : (price > open) === (myCall.side === "UP")) : null;

  return (
    <div className="shell">
      <div className="demo-banner" role="status">
        <b>DEMO MODE</b> · demo chips &amp; mock USDC · no real money moves ·{" "}
        {feed.mode === "live" ? <span>BTC price: <b>LIVE public data</b> (Coinbase)</span> : <span>BTC price: <b>SIMULATED</b> feed</span>}
      </div>

      <header className="top">
        <div className="brand">
          <span className="brand-main">HEADLINEODDS</span>
          <span className="brand-sub">ARENA · web edition</span>
        </div>
        <div className="top-right">
          <button className={`pill ${watching ? "pill-watch" : "pill-play"}`} onClick={() => update((x) => ({ ...x, mode: watching ? "play" : "watch" }))}>
            {watching ? "👀 Watching" : "🎮 Playing"}
          </button>
          {!watching && <span className="usdc">{usd(s.usdc)} <small>mock USDC</small></span>}
        </div>
      </header>

      {s.mode === null && <Welcome onPick={(name, mode) => update((x) => ({ ...x, name: name || x.name, mode }))} />}

      <main className="main">
        {tab === "arena" && (
          <>
            <ArenaPicker s={s} active={active} watching={watching} onPick={(code) => update((x) => ({ ...x, activeCode: code }))} />

            {prevPx && (
              <div className={`bell ${sinceBell < 60_000 ? "bell-fresh" : ""}`}>
                <span className="bell-tag">{sinceBell < 60_000 ? "🔔 BELL DON RING" : "LAST ROUND"}</span>
                <span>
                  {hhmm(roundById(round.id - 1).start)} closed{" "}
                  <b className={prevPx.close >= prevPx.open ? "t-up" : "t-down"}>
                    {prevPx.close > prevPx.open ? "UP ▲" : prevPx.close < prevPx.open ? "DOWN ▼" : "FLAT"} {pct(prevPx.close, prevPx.open).toFixed(3)}%
                  </b>
                  {prevMine && (
                    <> · you called {prevMine.side}:{" "}
                      <b className={(prevPx.close > prevPx.open) === (prevMine.side === "UP") ? "t-up" : "t-down"}>
                        {prevPx.close === prevPx.open ? "push" : (prevPx.close > prevPx.open) === (prevMine.side === "UP") ? `won +${chips(prevMine.stake)}` : `lost -${chips(prevMine.stake)}`}
                      </b>
                    </>
                  )}
                </span>
              </div>
            )}

            <section className="board-card">
              <div className="board-head">
                <span>ROUND {hhmm(round.start)} – {hhmm(round.end)}</span>
                <span className={locked ? "lock-tag locked" : "lock-tag"}>{locked ? "LOCKED" : "OPEN FOR CALLS"}</span>
              </div>
              <div className="countdown">
                <div className="cd-main">{locked ? clock(round.end - now) : clock(round.lockAt - now)}</div>
                <div className="cd-sub">{locked ? `Bell rings ${hhmm(round.end)} · next round opens then` : `until calls lock (${hhmm(round.lockAt)}) · bell at ${hhmm(round.end)}`}</div>
                <div className="progress">
                  <div className="progress-fill" style={{ width: `${((now - round.start) / (round.end - round.start)) * 100}%` }} />
                  <div className="progress-lock" style={{ left: `${((round.lockAt - round.start) / (round.end - round.start)) * 100}%` }} />
                </div>
              </div>
              <div className="prices">
                <div><small>OPEN</small><b>{open ? `$${usd(open)}` : "…"}</b></div>
                <div><small>LIVE BTC</small><b className={delta >= 0 ? "t-up" : "t-down"}>${usd(price)}</b></div>
                <div><small>MOVE</small><b className={delta >= 0 ? "t-up" : "t-down"}>{delta >= 0 ? "▲" : "▼"} {open ? pct(price, open).toFixed(3) : "0.000"}%</b></div>
              </div>
              <Chart points={feed.chart} open={open} start={round.start} end={round.end} lockAt={round.lockAt} now={now} />
            </section>

            {myCall && (
              <div className={`position ${winning === null ? "" : winning ? "pos-up" : "pos-down"}`}>
                You called <b>{myCall.side}</b> for {chips(myCall.stake)} chips ·{" "}
                {winning === null ? "dead level right now" : winning ? `you're UP right now (+${chips(myCall.stake)} if it holds)` : `you're DOWN right now (-${chips(myCall.stake)} if it holds)`}
              </div>
            )}

            {watching ? (
              <div className="spectate">
                <b>Spectating for free.</b> You see everything live. Oya, tap <i>Play</i> up top when you&apos;re ready to make your own call.
              </div>
            ) : !inActive ? (
              <div className="join-card">
                <h3>Join {active.name}</h3>
                <p>Entry {usd(active.entryFee)} mock USDC → {chips(active.bankroll)} demo chips. Top 3 split the pot 50/30/20.</p>
                <button className="btn-yellow" onClick={joinPublic}>Join for {usd(PUBLIC_FEE)} mock USDC</button>
              </div>
            ) : ended ? (
              <div className="join-card">
                <h3>Arena closed</h3>
                <p>You finished #{board.findIndex((b) => b.player.id === ME_ID) + 1} with {chips(bankroll)} chips.</p>
                {s.claimed.includes(active.code) ? <p>Settled ✔</p> : <button className="btn-yellow" onClick={claim}>Settle demo prize</button>}
              </div>
            ) : !arenaLive ? (
              <div className="join-card"><h3>Starts at {hhmm(roundById(active.startRound).start)}</h3><p>Arenas begin on the round bell. Warm up by watching this one.</p></div>
            ) : (
              <section className="call-box">
                <div className="call-title">{myCall ? "Change your call before lock" : "Oya, make your call"}</div>
                <div className="stakes">
                  {stakeOptions(bankroll).map((v, i) => (
                    <button key={i} className={`chip ${i === stakeIdx ? "chip-on" : ""}`} onClick={() => setStakeIdx(i)}>
                      <small>{(STAKE_PCTS[i] * 100).toString()}%</small>{chips(v)}
                    </button>
                  ))}
                </div>
                <div className="updown">
                  <button className="btn-up" disabled={locked} onClick={() => call("UP")}>▲ UP</button>
                  <button className="btn-down" disabled={locked} onClick={() => call("DOWN")}>▼ DOWN</button>
                </div>
                <div className="bankroll">Bankroll: <b>{chips(bankroll)}</b> chips {myStanding && <>· W{myStanding.wins} L{myStanding.losses}</>}</div>
              </section>
            )}

            <section className="feed">
              <h3>Live on the street</h3>
              {items.length === 0 && <p className="muted">Quiet for now. Calls land here as players make them.</p>}
              <ul>
                {items.slice(0, 14).map((it, i) => (
                  <li key={i} className={`f-${it.tone}`}><span className="f-time">{hms(it.at)}</span>{it.text}</li>
                ))}
              </ul>
            </section>
          </>
        )}

        {tab === "board" && (
          <>
            <ArenaPicker s={s} active={active} watching={watching} onPick={(code) => update((x) => ({ ...x, activeCode: code }))} />
            <section className="board-card">
              <div className="board-head"><span>LEADERBOARD · {active.name}</span><span className="lock-tag">{ended ? "FINAL" : `${Math.max(0, Math.min(round.id - active.startRound, active.rounds))}/${active.rounds} rounds`}</span></div>
              <ol className="lb">
                {board.map((b, i) => (
                  <li key={b.player.id} className={b.player.id === ME_ID ? "lb-me" : ""}>
                    <span className="lb-rank">{i + 1}</span>
                    <span className="lb-name">{b.player.id === ME_ID ? `${me.name} (you)` : b.player.name}</span>
                    <span className="lb-wl">W{b.wins}·L{b.losses}</span>
                    <span className={`lb-chips ${b.lastDelta > 0 ? "t-up" : b.lastDelta < 0 ? "t-down" : ""}`}>{chips(b.bankroll)}</span>
                    {i < 3 && <span className="lb-prize">{usd(pot.lines[i]?.amount ?? 0)}</span>}
                  </li>
                ))}
              </ol>
              <p className="muted">Updates at every bell. Bots play too, so the board stays alive.</p>
            </section>
            <section className="maths">
              <h3>Prize maths (mock USDC)</h3>
              <div className="eq">{pot.players} players × {usd(pot.entryFee)} entry = <b>{usd(pot.gross)}</b> pot</div>
              <div className="eq">− example 8% house fee {usd(pot.fee)} = <b>{usd(pot.net)}</b> to share</div>
              {pot.lines.map((l) => (
                <div className="eq" key={l.place}>#{l.place}: {usd(pot.net)} × {Math.round(l.pct * 100)}% = <b>{usd(l.amount)}</b></div>
              ))}
              <p className="muted">50/30/20 for the top 3 by bankroll when the arena closes. Ties go to whoever got there first in this demo.</p>
            </section>
          </>
        )}

        {tab === "dares" && (
          <Dares s={s} watching={watching} dares={allDares} now={now} dareChips={dareChips} locked={locked} round={round.id}
            nameOf={nameOf} prices={feed.prices} onSend={sendDare} onAnswer={answerDare}
            onAddFriend={(name) => update((x) => ({ ...x, friends: [...x.friends, { id: `fr-${Date.now()}`, name, bot: true, style: (hashStr(name) % 100) / 100 }] }))}
            onCreateArena={createArena} />
        )}

        {tab === "wallet" && (
          <Wallet s={s} onFund={(usdc, naira) => update((x) => ({ ...x, usdc: +(x.usdc + usdc).toFixed(2), ledger: [{ at: Date.now(), text: `Fund demo: ${ngn(naira)} → USDC`, amount: usdc }, ...x.ledger] }))}
            onCashout={(usdc, naira) => update((x) => ({ ...x, usdc: +(x.usdc - usdc).toFixed(2), ledger: [{ at: Date.now(), text: `Cash out demo: USDC → ${ngn(naira)}`, amount: -usdc }, ...x.ledger] }))}
            onToggleSim={() => update((x) => ({ ...x, forceSim: !x.forceSim }))} onReset={reset} feedMode={feed.mode} />
        )}
      </main>

      {toast && <div className="toast">{toast}</div>}

      <nav className="tabs">
        {([["arena", "Arena"], ["board", "Board"], ["dares", "Friends & Dares"], ["wallet", "Wallet"]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} className={tab === k ? "tab tab-on" : "tab"} onClick={() => setTab(k)}>{l}</button>
        ))}
      </nav>
      <footer className="foot">Demo build of HeadlineOdds Arena, web edition · demo chips and mock USDC only · prices for illustration</footer>
    </div>
  );
}

function Welcome({ onPick }: { onPick: (name: string, mode: "play" | "watch") => void }) {
  const [name, setName] = useState("");
  return (
    <div className="modal">
      <div className="modal-card">
        <div className="sign">WELCOME TO THE ARENA</div>
        <p>Every 15 minutes, call BTC <b className="t-up">UP</b> or <b className="t-down">DOWN</b>. Calls lock 1 minute before the bell. Beat your friends on the board.</p>
        <p className="muted">Everything here is demo: chips and mock USDC, no real money.</p>
        <input className="input" placeholder="Your street name (e.g. Bayo)" value={name} maxLength={18} onChange={(e) => setName(e.target.value)} />
        <div className="row">
          <button className="btn-yellow" onClick={() => onPick(name.trim(), "play")}>🎮 Play demo</button>
          <button className="btn-ghost" onClick={() => onPick(name.trim(), "watch")}>👀 Just watch</button>
        </div>
      </div>
    </div>
  );
}

function ArenaPicker({ s, active, watching, onPick }: { s: Saved; active: Arena; watching: boolean; onPick: (c: string) => void }) {
  if (watching || s.arenas.length === 0) return <div className="arena-name">🏟️ {active.name} · {active.players.length} players</div>;
  return (
    <select className="select" value={active.isPublic ? "public" : active.code} onChange={(e) => onPick(e.target.value)}>
      <option value="public">🏟️ Lagos Open (public)</option>
      {s.arenas.map((a) => <option key={a.code} value={a.code}>👥 {a.name} · {a.code}</option>)}
    </select>
  );
}

function Dares(props: {
  s: Saved; watching: boolean; dares: Dare[]; now: number; dareChips: number; locked: boolean; round: number;
  nameOf: (id: string) => string; prices: (id: number) => { open: number; close: number } | null;
  onSend: (to: string, side: Side, stake: number) => void; onAnswer: (d: Dare, a: boolean) => void;
  onAddFriend: (n: string) => void; onCreateArena: (name: string, fee: number, rounds: number, friends: string[]) => void;
}) {
  const { s, dares, now, nameOf } = props;
  const [friend, setFriend] = useState(s.friends[0]?.id ?? "");
  const [side, setSide] = useState<Side>("UP");
  const [stake, setStake] = useState(50);
  const [newFriend, setNewFriend] = useState("");
  const [arenaName, setArenaName] = useState("Friday Face-off");
  const [fee, setFee] = useState(1);
  const [rounds, setRounds] = useState(4);
  const [picked, setPicked] = useState<string[]>(s.friends.slice(0, 2).map((f) => f.id));
  const incoming = dares.filter((d) => d.toId === ME_ID);
  const outgoing = dares.filter((d) => d.fromId === ME_ID);
  const record = dares.reduce((r, d) => { const x = dareResult(d, now, props.prices); if (x === null) return r; return x > 0 ? { ...r, w: r.w + 1 } : x < 0 ? { ...r, l: r.l + 1 } : r; }, { w: 0, l: 0 });

  const row = (d: Dare) => {
    const st = effectiveStatus(d, now);
    const res = dareResult(d, now, props.prices);
    const mine = d.fromId === ME_ID ? d.fromSide : d.fromSide === "UP" ? "DOWN" : "UP";
    return (
      <li key={d.id} className="dare">
        <div><b>{d.fromId === ME_ID ? `You → ${nameOf(d.toId)}` : `${nameOf(d.fromId)} → you`}</b> · round {hhmm(roundById(d.roundId).start)} · {d.stake} chips</div>
        <div className="muted">{d.fromId === ME_ID ? `You called ${d.fromSide}, ${nameOf(d.toId)} takes the other side.` : `${nameOf(d.fromId)} says ${d.fromSide}.`} {d.toId === ME_ID ? ` You'd be ${mine}.` : ""}</div>
        <div>
          {res !== null ? <b className={res > 0 ? "t-up" : res < 0 ? "t-down" : ""}>{res > 0 ? `Won +${res}` : res < 0 ? `Lost ${res}` : "Push"}</b>
            : st === "pending" && d.toId === ME_ID && !props.watching ? (
              <span className="row"><button className="btn-small btn-up" onClick={() => props.onAnswer(d, true)}>Accept ({mine})</button><button className="btn-small btn-ghost" onClick={() => props.onAnswer(d, false)}>Decline</button></span>
            ) : <span className={`status s-${st}`}>{st === "pending" ? "waiting…" : st}</span>}
        </div>
      </li>
    );
  };

  return (
    <>
      <section className="board-card">
        <div className="board-head"><span>DARE CHIPS</span><span className="lock-tag">{props.dareChips} chips · W{record.w} L{record.l}</span></div>
        <p className="muted">A dare is a head-to-head on one round: you pick a side, your friend takes the other. Winner takes the stake in demo dare chips.</p>
        {props.watching ? <p className="spectate">Spectators can&apos;t send dares. Tap Play up top.</p> : (
          <div className="form">
            <label>Friend<select className="select" value={friend} onChange={(e) => setFriend(e.target.value)}>{s.friends.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
            <label>Your call<div className="row"><button className={`btn-small ${side === "UP" ? "btn-up" : "btn-ghost"}`} onClick={() => setSide("UP")}>▲ UP</button><button className={`btn-small ${side === "DOWN" ? "btn-down" : "btn-ghost"}`} onClick={() => setSide("DOWN")}>▼ DOWN</button></div></label>
            <label>Stake<div className="row">{[25, 50, 100].map((v) => <button key={v} className={`chip ${stake === v ? "chip-on" : ""}`} onClick={() => setStake(v)}>{v}</button>)}</div></label>
            <button className="btn-yellow" disabled={!friend} onClick={() => props.onSend(friend, side, stake)}>Send dare for {props.locked ? "next round" : "this round"}</button>
          </div>
        )}
      </section>
      <section className="feed"><h3>Incoming dares</h3>{incoming.length ? <ul>{incoming.map(row)}</ul> : <p className="muted">None yet. Friends send them a few minutes into each round.</p>}</section>
      <section className="feed"><h3>Outgoing dares</h3>{outgoing.length ? <ul>{outgoing.map(row)}</ul> : <p className="muted">You never dare anybody yet.</p>}</section>
      <section className="board-card">
        <div className="board-head"><span>FRIENDS</span><span className="lock-tag">{s.friends.length}</span></div>
        <ul className="friends">{s.friends.map((f) => <li key={f.id}>👤 {f.name} <small className="muted">demo friend</small></li>)}</ul>
        {!props.watching && (
          <div className="row">
            <input className="input" placeholder="Add friend by name" value={newFriend} maxLength={18} onChange={(e) => setNewFriend(e.target.value)} />
            <button className="btn-small btn-yellow" onClick={() => { if (newFriend.trim()) { props.onAddFriend(newFriend.trim()); setNewFriend(""); } }}>Add</button>
          </div>
        )}
        <p className="muted">Demo friends are simulated players on this device.</p>
      </section>
      {!props.watching && (
        <section className="board-card">
          <div className="board-head"><span>CREATE A FRIENDS ARENA</span></div>
          <div className="form">
            <label>Name<input className="input" value={arenaName} maxLength={24} onChange={(e) => setArenaName(e.target.value)} /></label>
            <label>Entry (mock USDC)<div className="row">{[0.5, 1, 5, 10].map((v) => <button key={v} className={`chip ${fee === v ? "chip-on" : ""}`} onClick={() => setFee(v)}>{usd(v)}</button>)}</div></label>
            <label>Length<div className="row">{[[4, "1 hour"], [16, "4 hours"]].map(([v, l]) => <button key={v} className={`chip ${rounds === v ? "chip-on" : ""}`} onClick={() => setRounds(v as number)}>{l}</button>)}</div></label>
            <label>Invite<div className="row wrap">{s.friends.map((f) => <button key={f.id} className={`chip ${picked.includes(f.id) ? "chip-on" : ""}`} onClick={() => setPicked((p) => (p.includes(f.id) ? p.filter((x) => x !== f.id) : [...p, f.id]))}>{f.name}</button>)}</div></label>
            <p className="muted">Bankroll {chips(virtualBankroll(fee))} chips each. Starts on the next round bell (or this one if it&apos;s fresh).</p>
            <button className="btn-yellow" onClick={() => props.onCreateArena(arenaName.trim(), fee, rounds, picked)}>Create for {usd(fee)} mock USDC</button>
          </div>
        </section>
      )}
    </>
  );
}

function Wallet({ s, onFund, onCashout, onToggleSim, onReset, feedMode }: {
  s: Saved; onFund: (u: number, n: number) => void; onCashout: (u: number, n: number) => void; onToggleSim: () => void; onReset: () => void; feedMode: string;
}) {
  const [flow, setFlow] = useState<null | "fund" | "cash">(null);
  const [step, setStep] = useState(0);
  const [naira, setNaira] = useState(15000);
  const [usdcOut, setUsdcOut] = useState(5);
  const fundUsdc = +(naira / EXAMPLE_RATE).toFixed(2);
  const cashNaira = usdcOut * EXAMPLE_RATE;
  const start = (f: "fund" | "cash") => { setFlow(f); setStep(0); };

  return (
    <>
      <section className="board-card">
        <div className="board-head"><span>DEMO WALLET</span><span className="lock-tag">NO REAL MONEY MOVES</span></div>
        <div className="big-bal">{usd(s.usdc)} <small>mock USDC</small></div>
        <div className="row"><button className="btn-yellow" onClick={() => start("fund")}>＋ Fund (₦ → USDC)</button><button className="btn-ghost" onClick={() => start("cash")}>Cash out (USDC → ₦)</button></div>
        <p className="muted">Example rate used here: ₦{EXAMPLE_RATE.toLocaleString()} = 1 USDC. Illustration only, not a quote.</p>
      </section>

      {flow === "fund" && (
        <section className="board-card flow">
          <div className="board-head"><span>FUND · step {step + 1}/3</span><span className="lock-tag">DEMO</span></div>
          {step === 0 && (<>
            <label>Amount in naira<input className="input" type="number" min={1000} step={500} value={naira} onChange={(e) => setNaira(Math.max(0, Number(e.target.value)))} /></label>
            <div className="eq">{ngn(naira)} ÷ ₦{EXAMPLE_RATE.toLocaleString()} (example) = <b>{usd(fundUsdc)} mock USDC</b></div>
            <button className="btn-yellow" disabled={naira < 1000} onClick={() => setStep(1)}>Continue</button>
          </>)}
          {step === 1 && (<>
            <p>In the real app you&apos;d transfer naira to a one-time bank account from the on-ramp partner. Here it&apos;s pretend:</p>
            <div className="fake-acct"><div>Bank: <b>DEMO BANK</b></div><div>Account: <b>000 000 0000</b></div><div>Amount: <b>{ngn(naira)}</b></div></div>
            <button className="btn-yellow" onClick={() => setStep(2)}>I&apos;ve &quot;sent&quot; it (demo)</button>
          </>)}
          {step === 2 && (<>
            <p>✔ Demo transfer confirmed. {usd(fundUsdc)} mock USDC is ready.</p>
            <button className="btn-yellow" onClick={() => { onFund(fundUsdc, naira); setFlow(null); }}>Add to demo wallet</button>
          </>)}
        </section>
      )}

      {flow === "cash" && (
        <section className="board-card flow">
          <div className="board-head"><span>CASH OUT · step {step + 1}/3</span><span className="lock-tag">DEMO</span></div>
          {step === 0 && (<>
            <label>Amount in mock USDC<input className="input" type="number" min={1} step={1} value={usdcOut} onChange={(e) => setUsdcOut(Math.max(0, Number(e.target.value)))} /></label>
            <div className="eq">{usd(usdcOut)} × ₦{EXAMPLE_RATE.toLocaleString()} (example) = <b>{ngn(cashNaira)}</b></div>
            <button className="btn-yellow" disabled={usdcOut <= 0 || usdcOut > s.usdc} onClick={() => setStep(1)}>{usdcOut > s.usdc ? "Not enough mock USDC" : "Continue"}</button>
          </>)}
          {step === 1 && (<>
            <p>Pick where the naira lands. Demo only, nothing is sent:</p>
            <div className="fake-acct"><div>Bank: <b>DEMO BANK</b></div><div>Account: <b>•••• 0000</b></div><div>You receive: <b>{ngn(cashNaira)}</b> (example)</div></div>
            <button className="btn-yellow" onClick={() => setStep(2)}>Confirm demo cash out</button>
          </>)}
          {step === 2 && (<>
            <p>✔ Demo payout queued. No real money moves in this build.</p>
            <button className="btn-yellow" onClick={() => { onCashout(usdcOut, cashNaira); setFlow(null); }}>Done</button>
          </>)}
        </section>
      )}

      <section className="feed">
        <h3>Demo ledger</h3>
        <ul>{s.ledger.slice(0, 12).map((l, i) => <li key={i}><span className="f-time">{l.at ? hhmm(l.at) : "--:--"}</span>{l.text} <b className={l.amount >= 0 ? "t-up" : "t-down"}>{l.amount >= 0 ? "+" : ""}{usd(l.amount)}</b></li>)}</ul>
      </section>

      <section className="board-card">
        <div className="board-head"><span>SETTINGS</span></div>
        <p>Price feed now: <b>{feedMode === "live" ? "LIVE public BTC (Coinbase)" : "SIMULATED"}</b></p>
        <div className="row"><button className="btn-ghost" onClick={onToggleSim}>{s.forceSim ? "Try live public feed" : "Use simulated feed"}</button><button className="btn-ghost" onClick={() => { if (confirm("Reset all demo data on this device?")) onReset(); }}>Reset demo</button></div>
      </section>
    </>
  );
}
