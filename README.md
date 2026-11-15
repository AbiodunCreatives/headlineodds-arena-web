# HeadlineOdds Arena · web edition (demo)

A standalone web version of the core HeadlineOdds Arena game loop: **15-minute BTC UP/DOWN rounds** played against friends on a shared leaderboard, with a bold Lagos street-market look.

> **DEMO MODE.** Chips and USDC here are pretend. No real money, no wallets, no accounts, no backend. Everything lives in your browser's localStorage.

## What's in it

- **Live arena**: rounds aligned to the clock (:00, :15, :30, :45). Big countdown to the call lock (1 minute before close) and the bell, the round's open price vs the live price, and a mini chart with the open line.
- **One-tap UP / DOWN** with stake chips scaled to your bankroll (1%, 2.5%, 5%, 10%). You can change your call until lock. Settlement is even money on close vs open (a flat close is a push).
- **Filling the wait**: a "you're up/down right now" indicator, a live feed of other players' calls and dares, and the last round's result shown at the bell.
- **Arenas**: the always-on public *Lagos Open* (one Lagos day, 96 rounds, demo bots play every round) plus private friends arenas (mock entry 0.50–10 USDC, 1 h or 4 h, start on a round boundary, bankroll = entry × 100, min 1,000 chips).
- **Leaderboard & prize maths**: ranked by bankroll and updated at every bell. The pot (players × entry, minus an example 8% fee) is split **50/30/20** for the top 3, with the sums shown.
- **Friends & dares**: seeded demo friends, add more, dare a friend on a round (they take the other side), accept or decline incoming dares, with a separate dare-chip record.
- **Spectator mode**: watch the arena, countdown, feed and leaderboard for free without joining.
- **Naira on/off-ramp (mocked)**: Fund (₦ → USDC) and Cash out (USDC → ₦) step-by-step flows using a clearly labelled **example** rate (₦1,500 = 1 USDC, not a quote).

## Price feed

The app tries Coinbase's public, no-key BTC-USD endpoints from the browser (ticker plus 15-minute and 1-minute candles). If they fail, it falls back to a deterministic **simulated** random-walk feed. The banner always says which one is active, and you can force simulated mode under Wallet → Settings.

## Run locally

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # vitest: round timing, settlement, 50/30/20 split
npm run build    # static export to ./out
```

## Deploy

- **GitHub Pages** (current): `.github/workflows/deploy.yml` builds with `NEXT_PUBLIC_BASE_PATH=/<repo-name>` and publishes `./out`.
- **Vercel (later)**: import the repo in Vercel and keep the Next.js preset. Leave `NEXT_PUBLIC_BASE_PATH` unset so the app serves from `/`. No env vars or secrets are needed.

## Code map

- `lib/game.ts`: pure rules (round timing, lock, settlement, stake sizes, prize split, arena replay, demo bots, simulated feed)
- `lib/world.ts`: demo players, public arena, dares and feed
- `lib/feed.ts`: price feed hook (live public → simulated fallback)
- `lib/store.ts`: localStorage state
- `components/App.tsx`: the UI

Demo build of HeadlineOdds Arena, web edition. For demonstration only, with no earnings implied.
