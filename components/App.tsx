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
import Logo from "./Logo";

type Tab = "arena" | "board" | "dares" | "wallet";
const EXAMPLE_RATE = 1500; // illustrative only, NOT a quote

export default function App() {
  const { s, setS, loaded, reset } = useSaved();
  const feed = useBtcFeed(s.forceSim);
  const { now, round, price, open, openSource } = feed;
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
  const pub = publicArena(now, joinedPub ? { ...me, joinedAt: s.publicJoinedAt?.[pubBase.code] ?? Date.now() } : undefined, s.publicCalls[pubBase.code]);
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
  const nameOf = (id: string) => (id === ME_ID ? "you" : [...s.friends, ...BOTS].find((p) => p.id === id)?.name ?? id);

  // ----- live feed -----
  const items: FeedItem[] = [...botFeed(round.id, active.players, now)];
  if (myCall) items.push({ at: myCall.at, text: `you called ${myCall.side.toLowerCase()} · ${chips(myCall.stake)} chips`, tone: "me" });
  for (const d of allDares) {
    if (d.roundId !== round.id) continue;
    const st = effectiveStatus(d, now);
    items.push({ at: d.createdAt, text: `${nameOf(d.fromId)} dared ${nameOf(d.toId)}: ${d.fromSide.toLowerCase()} for ${d.stake}`, tone: "dare" });
    if (st !== "pending" && d.fromId === ME_ID) items.push({ at: d.createdAt + 6000, text: `${nameOf(d.toId)} ${st} your dare`, tone: "dare" });
  }
  items.sort((a, b) => b.at - a.at);

  // ----- actions -----
  function call(side: Side) {
    if (watching) return flash("you're watching. switch to play to make a call.");
    if (!inActive) return flash("join this arena first.");
    if (locked) return flash("round is locked. next one opens at the bell.");
    if (!arenaLive) return flash("this arena hasn't started yet.");
    const stake = Math.min(stakeOptions(bankroll)[stakeIdx], bankroll);
    if (stake <= 0) return flash("no chips left in this arena.");
    update((x) => {
      const setCalls = (calls: Arena["calls"]) => ({ ...calls, [round.id]: { ...(calls[round.id] ?? {}), [ME_ID]: { side, stake, at: Date.now() } } });
      if (active.isPublic) return { ...x, publicCalls: { ...x.publicCalls, [active.code]: setCalls(x.publicCalls[active.code] ?? {}) } };
      return { ...x, arenas: x.arenas.map((a) => (a.code === active.code ? { ...a, calls: setCalls(a.calls) } : a)) };
    });
    flash(`called ${side.toLowerCase()} · ${chips(stake)} chips. locks at ${hhmm(round.lockAt)}.`);
  }

  function pay(amount: number, text: string): boolean {
    if (s.usdc < amount) { flash("not enough mock usdc. fund your demo wallet first."); setTab("wallet"); return false; }
    update((x) => ({ ...x, usdc: +(x.usdc - amount).toFixed(2), ledger: [{ at: Date.now(), text, amount: -amount }, ...x.ledger] }));
    return true;
  }

  function joinPublic() {
    if (!pay(PUBLIC_FEE, `entry (demo): ${pub.name}`)) return;
    update((x) => ({ ...x, mode: "play", joinedPublic: [...x.joinedPublic, pubBase.code], publicJoinedAt: { ...(x.publicJoinedAt ?? {}), [pubBase.code]: Date.now() }, activeCode: "public" }));
    flash("you're in. may the odds be in your favour.");
  }

  function createArena(name: string, fee: number, rounds: number, friendIds: string[]) {
    if (!pay(fee, `entry (demo): ${name}`)) return;
    const createdAt = Date.now();
    const code = makeCode(hashStr(name + createdAt));
    const friends = s.friends.filter((f) => friendIds.includes(f.id));
    const fillers = BOTS.filter((_, i) => (hashStr(code) >> i) & 1).slice(0, Math.max(0, 3 - friends.length));
    const arena: Arena = {
      code, name: name || `Arena ${code}`, entryFee: fee, startRound: arenaStartRound(Date.now()), rounds,
      bankroll: virtualBankroll(fee), players: [me, ...friends, ...fillers].map((p, i) => ({ ...p, joinedAt: createdAt + i })), calls: {},
    };
    update((x) => ({ ...x, mode: "play", arenas: [arena, ...x.arenas], activeCode: code }));
    setTab("arena");
    flash(`arena ${code} created. starts ${hhmm(roundById(arena.startRound).start)}.`);
  }

  function claim() {
    const rank = board.findIndex((b) => b.player.id === ME_ID);
    const line = pot.lines[rank];
    update((x) => ({
      ...x, claimed: [...x.claimed, active.code],
      usdc: +(x.usdc + (line?.amount ?? 0)).toFixed(2),
      ledger: line ? [{ at: Date.now(), text: `prize (demo): #${rank + 1} in ${active.name}`, amount: line.amount }, ...x.ledger] : x.ledger,
    }));
    flash(line ? `demo prize ${usd(line.amount)} mock usdc added.` : "arena closed. no prize this time.");
  }

  function sendDare(toId: string, side: Side, stake: number) {
    const roundId = locked ? round.id + 1 : round.id;
    const d: Dare = { id: `out-${Date.now()}`, roundId, fromId: ME_ID, toId, fromSide: side, stake, createdAt: Date.now(), status: "pending" };
    update((x) => ({ ...x, dares: [d, ...x.dares] }));
    flash(`dare sent to ${nameOf(toId)} for the ${hhmm(roundById(roundId).start)} round.`);
  }
  function answerDare(d: Dare, accept: boolean) {
    update((x) => ({ ...x, dares: [{ ...d, status: accept ? "accepted" : "declined" }, ...x.dares.filter((y) => y.id !== d.id)] }));
    flash(accept ? `dare accepted. you're ${d.fromSide === "UP" ? "down" : "up"}.` : "dare declined.");
  }

  if (!loaded) return <div className="boot">Loading arena…</div>;

  const delta = open ? price - open : 0;
  const winning = myCall && open ? (price === open ? null : (price > open) === (myCall.side === "UP")) : null;

  return (
    <div className="shell">
      <div className="demo-banner" role="status">
        <b>DEMO MODE</b> · demo chips &amp; mock usdc · no real money moves ·{" "}
        {feed.mode === "live" ? <span>btc price: <b>LIVE public data</b> (coinbase)</span> : <span>btc price: <b>SIMULATED</b> feed</span>}
      </div>

      <header className="top">
        <div className="brand">
          <Logo />
          <span className="tagline">trade the news.</span>
        </div>
        <div className="top-right">
          <div className="seg" role="group" aria-label="mode">
            <button className={watching ? "seg-on" : ""} aria-pressed={watching} onClick={() => update((x) => ({ ...x, mode: "watch" }))}>watch</button>
            <button className={!watching ? "seg-on" : ""} aria-pressed={!watching} onClick={() => update((x) => ({ ...x, mode: "play" }))}>play</button>
          </div>
          {!watching && <span className="usdc">{usd(s.usdc)} <small>mock usdc · demo</small></span>}
        </div>
      </header>

      {s.mode === null && <Welcome onPick={(name, mode) => update((x) => ({ ...x, name: name || x.name, mode }))} />}

      <main className="main">
        {tab === "arena" && (
          <>
            <ArenaPicker s={s} active={active} watching={watching} onPick={(code) => update((x) => ({ ...x, activeCode: code }))} />

            {prevPx && (
              <div className={`bell ${sinceBell < 60_000 ? "bell-fresh" : ""}`}>
                <span className="bell-tag">{sinceBell < 60_000 ? "round settled" : "last round"}</span>
                <span>
                  {hhmm(roundById(round.id - 1).start)} closed{" "}
                  <b className={prevPx.close >= prevPx.open ? "t-up" : "t-down"}>
                    {prevPx.close > prevPx.open ? "up ↑" : prevPx.close < prevPx.open ? "down ↓" : "flat"} {pct(prevPx.close, prevPx.open).toFixed(3)}%
                  </b>
                  {prevMine && (
                    <> · you called {prevMine.side.toLowerCase()}:{" "}
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
                <span>btc · 15m round · {hhmm(round.start)} – {hhmm(round.end)}</span>
                <span className={locked ? "lock-tag locked" : "lock-tag"}>{locked ? "locked" : <><i className="live-dot" />live</>}</span>
              </div>
              <div className="countdown">
                <div className="cd-main">{locked ? clock(round.end - now) : clock(round.lockAt - now)}</div>
                <div className="cd-sub">{locked ? `calls locked · settles ${hhmm(round.end)}, next round opens then` : `until calls lock (${hhmm(round.lockAt)}) · settles ${hhmm(round.end)}`}</div>
                <div className="progress">
                  <div className="progress-fill" style={{ width: `${((now - round.start) / (round.end - round.start)) * 100}%` }} />
                  <div className="progress-lock" style={{ left: `${((round.lockAt - round.start) / (round.end - round.start)) * 100}%` }} />
                </div>
              </div>
              <div className="prices">
                <div><small>{openSource === "tick" ? "open (live tick)" : "open"}</small><b>{open ? `$${usd(open)}` : "…"}</b></div>
                <div><small>live btc</small><b className={delta >= 0 ? "t-up" : "t-down"}>${usd(price)}</b></div>
                <div><small>move</small><b className={delta >= 0 ? "t-up" : "t-down"}>{delta >= 0 ? "▲" : "▼"} {open ? pct(price, open).toFixed(3) : "0.000"}%</b></div>
              </div>
              <Chart points={feed.chart} open={open} start={round.start} end={round.end} lockAt={round.lockAt} now={now} />
            </section>


            {watching ? (
              <div className="spectate">
                <b>watching for free.</b> everything updates live. switch to <i>play</i> up top when you&apos;re ready to make a call.
              </div>
            ) : !inActive ? (
              <div className="join-card dock">
                <h3>join {active.name}</h3>
                <p>demo entry {usd(active.entryFee)} mock usdc → {chips(active.bankroll)} chips. top 3 split the pot 50/30/20.</p>
                <button className="btn-primary" onClick={joinPublic}>join for {usd(PUBLIC_FEE)} mock usdc</button>
              </div>
            ) : ended ? (
              <div className="join-card">
                <h3>arena closed</h3>
                <p>you finished #{board.findIndex((b) => b.player.id === ME_ID) + 1} with {chips(bankroll)} chips.</p>
                {s.claimed.includes(active.code) ? <p>settled ✓</p> : <button className="btn-primary" onClick={claim}>settle demo prize</button>}
              </div>
            ) : !arenaLive ? (
              <div className="join-card"><h3>starts at {hhmm(roundById(active.startRound).start)}</h3><p>arenas begin on a round boundary. watch this one to warm up.</p></div>
            ) : (
              <section className="call-box dock">
                <div className={`call-title ${locked ? "call-title-locked" : ""}`}>
                  {locked
                    ? myCall ? `call locked: ${myCall.side.toLowerCase()} · ${chips(myCall.stake)} chips` : `calls locked · next round opens ${hhmm(round.end)}`
                    : myCall ? "change your call before lock" : "make your call."}
                </div>
                <div className="stakes">
                  {stakeOptions(bankroll).map((v, i) => (
                    <button key={i} className={`chip ${i === stakeIdx ? "chip-on" : ""}`} onClick={() => setStakeIdx(i)}>
                      <small>{(STAKE_PCTS[i] * 100).toString()}%</small>{chips(v)}
                    </button>
                  ))}
                </div>
                <div className="updown">
                  <button className="btn-up" disabled={locked} onClick={() => call("UP")}><span>up</span><small>price closes above open</small></button>
                  <button className="btn-down" disabled={locked} onClick={() => call("DOWN")}><span>down</span><small>price closes below open</small></button>
                </div>
                {myCall && (
              <div className={`position in-dock ${winning === null ? "" : winning ? "pos-up" : "pos-down"}`}>
                you called <b>{myCall.side.toLowerCase()}</b> · {chips(myCall.stake)} chips ·{" "}
                {winning === null ? "dead level right now" : winning ? `you're up right now (+${chips(myCall.stake)} if it holds)` : `you're down right now (-${chips(myCall.stake)} if it holds)`}
              </div>
            )}
                <div className="bankroll">bankroll <b>{chips(bankroll)}</b> chips {myStanding && <>· W{myStanding.wins} L{myStanding.losses}</>}</div>
              </section>
            )}

            <section className="feed">
              <h3><i className="live-dot" />live calls</h3>
              {items.length === 0 && <p className="muted">quiet for now. calls show up here as players make them.</p>}
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
              <div className="board-head"><span>leaderboard · {active.name}</span><span className="lock-tag">{ended ? "final" : `${Math.max(0, Math.min(round.id - active.startRound, active.rounds))}/${active.rounds} rounds`}</span></div>
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
              <p className="muted">updates when each round settles. demo bots play too.</p>
            </section>
            <section className="maths">
              <h3>prize maths <span className="tag-demo">demo · mock usdc</span></h3>
              <div className="eq">{pot.players} players × {usd(pot.entryFee)} entry = <b>{usd(pot.gross)}</b> pot</div>
              <div className="eq">− example 8% fee {usd(pot.fee)} = <b>{usd(pot.net)}</b> to share</div>
              {pot.lines.map((l) => (
                <div className="eq" key={l.place}>#{l.place}: {usd(pot.net)} × {Math.round(l.pct * 100)}% = <b>{usd(l.amount)}</b></div>
              ))}
              <p className="muted">50/30/20 for the top 3 by bankroll when the arena closes. ties: whoever reached that bankroll first ranks higher (earlier round, then earlier call); if still level, whoever joined the arena first. the board order above is the payout order.</p>
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
          <Wallet s={s} onFund={(usdc, naira) => update((x) => ({ ...x, usdc: +(x.usdc + usdc).toFixed(2), ledger: [{ at: Date.now(), text: `fund (demo): ${ngn(naira)} → usdc`, amount: usdc }, ...x.ledger] }))}
            onCashout={(usdc, naira) => update((x) => ({ ...x, usdc: +(x.usdc - usdc).toFixed(2), ledger: [{ at: Date.now(), text: `cash out (demo): usdc → ${ngn(naira)}`, amount: -usdc }, ...x.ledger] }))}
            onToggleSim={() => update((x) => ({ ...x, forceSim: !x.forceSim }))} onReset={reset} feedMode={feed.mode} />
        )}
      </main>

      {toast && <div className="toast">{toast}</div>}

      <nav className="tabs">
        {([["arena", "arena"], ["board", "board"], ["dares", "friends & dares"], ["wallet", "wallet"]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} className={tab === k ? "tab tab-on" : "tab"} onClick={() => setTab(k)}>{l}</button>
        ))}
      </nav>
      <footer className="foot">Demo build of HeadlineOdds Arena, web edition · demo chips and mock usdc only · may the odds be in your favour</footer>
    </div>
  );
}

function Welcome({ onPick }: { onPick: (name: string, mode: "play" | "watch") => void }) {
  const [name, setName] = useState("");
  return (
    <div className="modal">
      <div className="modal-card">
        <Logo size={44} />
        <h2 className="welcome-h">trade the news.</h2>
        <p>every 15 minutes, call btc <b className="t-up">up</b> or <b className="t-down">down</b>. calls lock 1 minute before the round settles. outlast your friends on the board.</p>
        <p className="muted">demo build: chips and mock usdc only, no real money.</p>
        <input className="input" placeholder="your handle (e.g. bayo)" value={name} maxLength={18} onChange={(e) => setName(e.target.value)} />
        <div className="row">
          <button className="btn-primary" onClick={() => onPick(name.trim(), "play")}>play the demo</button>
          <button className="btn-secondary" onClick={() => onPick(name.trim(), "watch")}>just watch</button>
        </div>
      </div>
    </div>
  );
}

function ArenaPicker({ s, active, watching, onPick }: { s: Saved; active: Arena; watching: boolean; onPick: (c: string) => void }) {
  if (watching || s.arenas.length === 0) return <div className="arena-name"><span>{active.name}</span><span className="muted">{active.players.length} players</span></div>;
  return (
    <select className="select" value={active.isPublic ? "public" : active.code} onChange={(e) => onPick(e.target.value)}>
      <option value="public">the open arena (public)</option>
      {s.arenas.map((a) => <option key={a.code} value={a.code}>{a.name} · {a.code}</option>)}
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
  const [arenaName, setArenaName] = useState("friday face-off");
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
        <div className="muted">{d.fromId === ME_ID ? `you called ${d.fromSide.toLowerCase()}, ${nameOf(d.toId)} takes the other side.` : `${nameOf(d.fromId)} says ${d.fromSide.toLowerCase()}.`} {d.toId === ME_ID ? ` you'd be ${mine.toLowerCase()}.` : ""}</div>
        <div>
          {res !== null ? <b className={res > 0 ? "t-up" : res < 0 ? "t-down" : ""}>{res > 0 ? `won +${res}` : res < 0 ? `lost ${res}` : "push"}</b>
            : st === "pending" && d.toId === ME_ID && !props.watching ? (
              <span className="row"><button className="btn-small btn-up" onClick={() => props.onAnswer(d, true)}>accept ({mine.toLowerCase()})</button><button className="btn-small btn-secondary" onClick={() => props.onAnswer(d, false)}>decline</button></span>
            ) : <span className={`status s-${st}`}>{st === "pending" ? "waiting…" : st}</span>}
        </div>
      </li>
    );
  };

  return (
    <>
      <section className="board-card">
        <div className="board-head"><span>dare chips <span className="tag-demo">demo</span></span><span className="lock-tag">{props.dareChips} chips · W{record.w} L{record.l}</span></div>
        <p className="muted">a dare is a head-to-head on one round: you pick a side, your friend takes the other. winner takes the stake in demo dare chips.</p>
        {props.watching ? <p className="spectate">watchers can&apos;t send dares. switch to play up top.</p> : (
          <div className="form">
            <label>friend<select className="select" value={friend} onChange={(e) => setFriend(e.target.value)}>{s.friends.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
            <label>your call<div className="row"><button className={`btn-small ${side === "UP" ? "btn-up" : "btn-secondary"}`} onClick={() => setSide("UP")}>up ↑</button><button className={`btn-small ${side === "DOWN" ? "btn-down" : "btn-secondary"}`} onClick={() => setSide("DOWN")}>down ↓</button></div></label>
            <label>stake<div className="row">{[25, 50, 100].map((v) => <button key={v} className={`chip ${stake === v ? "chip-on" : ""}`} onClick={() => setStake(v)}>{v}</button>)}</div></label>
            <button className="btn-primary" disabled={!friend} onClick={() => props.onSend(friend, side, stake)}>send dare for {props.locked ? "next round" : "this round"}</button>
          </div>
        )}
      </section>
      <section className="feed"><h3>incoming dares</h3>{incoming.length ? <ul>{incoming.map(row)}</ul> : <p className="muted">none yet. friends send them a few minutes into each round.</p>}</section>
      <section className="feed"><h3>outgoing dares</h3>{outgoing.length ? <ul>{outgoing.map(row)}</ul> : <p className="muted">no dares sent yet.</p>}</section>
      <section className="board-card">
        <div className="board-head"><span>friends</span><span className="lock-tag">{s.friends.length}</span></div>
        <ul className="friends">{s.friends.map((f) => <li key={f.id}><span className="avatar">{f.name[0]}</span>{f.name} <small className="muted">demo</small></li>)}</ul>
        {!props.watching && (
          <div className="row">
            <input className="input" placeholder="add a friend by name" value={newFriend} maxLength={18} onChange={(e) => setNewFriend(e.target.value)} />
            <button className="btn-small btn-primary" onClick={() => { if (newFriend.trim()) { props.onAddFriend(newFriend.trim()); setNewFriend(""); } }}>add</button>
          </div>
        )}
        <p className="muted">demo friends are simulated players on this device. there&apos;s no backend yet, so friend arenas stay on this device.</p>
      </section>
      {!props.watching && (
        <section className="board-card">
          <div className="board-head"><span>create a friends arena <span className="tag-demo">demo</span></span></div>
          <div className="form">
            <label>name<input className="input" value={arenaName} maxLength={24} onChange={(e) => setArenaName(e.target.value)} /></label>
            <label>entry (mock usdc)<div className="row">{[0.5, 1, 5, 10].map((v) => <button key={v} className={`chip ${fee === v ? "chip-on" : ""}`} onClick={() => setFee(v)}>{usd(v)}</button>)}</div></label>
            <label>length<div className="row">{[[4, "1 hour"], [16, "4 hours"]].map(([v, l]) => <button key={v} className={`chip ${rounds === v ? "chip-on" : ""}`} onClick={() => setRounds(v as number)}>{l}</button>)}</div></label>
            <label>invite<div className="row wrap">{s.friends.map((f) => <button key={f.id} className={`chip ${picked.includes(f.id) ? "chip-on" : ""}`} onClick={() => setPicked((p) => (p.includes(f.id) ? p.filter((x) => x !== f.id) : [...p, f.id]))}>{f.name}</button>)}</div></label>
            <p className="muted">bankroll {chips(virtualBankroll(fee))} chips each. starts on the next round boundary (or this round if it just opened).</p>
            <button className="btn-primary" onClick={() => props.onCreateArena(arenaName.trim(), fee, rounds, picked)}>create for {usd(fee)} mock usdc</button>
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
        <div className="board-head"><span>wallet</span><span className="tag-demo">demo · no real money moves</span></div>
        <div className="big-bal">{usd(s.usdc)} <small>mock usdc</small></div>
        <div className="row"><button className="btn-primary" onClick={() => start("fund")}>fund (₦ → usdc)</button><button className="btn-secondary" onClick={() => start("cash")}>cash out (usdc → ₦)</button></div>
        <p className="muted">example rate used here: ₦{EXAMPLE_RATE.toLocaleString()} = 1 usdc. illustration only, not a quote.</p>
      </section>

      {flow === "fund" && (
        <section className="board-card flow">
          <div className="board-head"><span>fund · step {step + 1}/3</span><span className="tag-demo">demo</span></div>
          {step === 0 && (<>
            <label>amount in naira<input className="input" type="number" min={1000} step={500} value={naira} onChange={(e) => setNaira(Math.max(0, Number(e.target.value)))} /></label>
            <div className="eq">{ngn(naira)} ÷ ₦{EXAMPLE_RATE.toLocaleString()} (example) = <b>{usd(fundUsdc)} mock usdc</b></div>
            <button className="btn-primary" disabled={naira < 1000} onClick={() => setStep(1)}>continue</button>
          </>)}
          {step === 1 && (<>
            <p>in the real app you&apos;d transfer naira to a one-time bank account from the on-ramp partner. here it&apos;s pretend:</p>
            <div className="fake-acct"><div>bank <b>DEMO BANK</b></div><div>account <b>000 000 0000</b></div><div>amount <b>{ngn(naira)}</b></div></div>
            <button className="btn-primary" onClick={() => setStep(2)}>i&apos;ve &quot;sent&quot; it (demo)</button>
          </>)}
          {step === 2 && (<>
            <p>✓ demo transfer confirmed. {usd(fundUsdc)} mock usdc is ready.</p>
            <button className="btn-primary" onClick={() => { onFund(fundUsdc, naira); setFlow(null); }}>add to demo wallet</button>
          </>)}
        </section>
      )}

      {flow === "cash" && (
        <section className="board-card flow">
          <div className="board-head"><span>cash out · step {step + 1}/3</span><span className="tag-demo">demo</span></div>
          {step === 0 && (<>
            <label>amount in mock usdc<input className="input" type="number" min={1} step={1} value={usdcOut} onChange={(e) => setUsdcOut(Math.max(0, Number(e.target.value)))} /></label>
            <div className="eq">{usd(usdcOut)} × ₦{EXAMPLE_RATE.toLocaleString()} (example) = <b>{ngn(cashNaira)}</b></div>
            <button className="btn-primary" disabled={usdcOut <= 0 || usdcOut > s.usdc} onClick={() => setStep(1)}>{usdcOut > s.usdc ? "not enough mock usdc" : "continue"}</button>
          </>)}
          {step === 1 && (<>
            <p>pick where the naira lands. demo only, nothing is sent:</p>
            <div className="fake-acct"><div>bank <b>DEMO BANK</b></div><div>account <b>•••• 0000</b></div><div>you receive <b>{ngn(cashNaira)}</b> (example)</div></div>
            <button className="btn-primary" onClick={() => setStep(2)}>confirm demo cash out</button>
          </>)}
          {step === 2 && (<>
            <p>✓ demo payout queued. no real money moves in this build.</p>
            <button className="btn-primary" onClick={() => { onCashout(usdcOut, cashNaira); setFlow(null); }}>done</button>
          </>)}
        </section>
      )}

      <section className="feed">
        <h3>ledger <span className="tag-demo">demo</span></h3>
        <ul>{s.ledger.slice(0, 12).map((l, i) => <li key={i}><span className="f-time">{l.at ? hhmm(l.at) : "--:--"}</span>{l.text} <b className={l.amount >= 0 ? "t-up" : "t-down"}>{l.amount >= 0 ? "+" : ""}{usd(l.amount)}</b></li>)}</ul>
      </section>

      <section className="board-card">
        <div className="board-head"><span>settings</span></div>
        <p>price feed now: <b>{feedMode === "live" ? "live public btc (coinbase)" : "simulated"}</b></p>
        <div className="row"><button className="btn-secondary" onClick={onToggleSim}>{s.forceSim ? "try live public feed" : "use simulated feed"}</button><button className="btn-secondary" onClick={() => { if (confirm("reset all demo data on this device?")) onReset(); }}>reset demo</button></div>
      </section>
    </>
  );
}
