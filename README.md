# Dare15 (test version)

*Dare a friend: BTC up or down over one 15-minute round.*

Dare15 is a stripped-down experiment built from the HeadlineOdds Arena web code. It has one market, BTC over 15 minutes, and one flow: two friends, one dare and one escrow.

> **TEST VERSION.** Balances are **test USDC**, not real money. There are no accounts and no backend. All state lives in your browser's localStorage. This is not real escrow (see [Limitations](#limitations)).

## The flow

1. **Dare.** You need at least **2 test USDC** (a new device starts with 5, and there's a test top-up button). Enter your name, pick **UP** or **DOWN** and tap *create dare link*. Your 2 test USDC is locked in escrow, and you get a share link.
2. **Accept.** Your friend opens the link, sees your call and the round, enters their name and accepts (they also need 2 test USDC). They take the opposite side, and their 2 is locked. Their device logs both stakes (4 total) and gives them a **return link**.
3. **Record.** Your friend sends the return link back to you. When you open it, your device records their stake too. Both devices now show 4 test USDC in escrow.
4. **Resolve.** When the round closes, each device fetches the round's Binance **BTCUSDT 15-minute candle** and settles on its own. Both read the same candle, so they agree. Close above open means UP wins, and close below open means DOWN wins. The winner's side gets **4 test USDC**.

### Rules

- **Which round:** a dare always locks to the **next** 15-minute round (rounds start at :00, :15, :30 and :45). If that bell is under 5 minutes away, it uses the round after. It never uses the round already running, because that round's open is known and the challenger could pick a side that is already ahead. The friend therefore has 5 to 20 minutes to accept.
- **Accept deadline:** the round's opening bell. After that the link can't be accepted, and a return link stamped after the bell is rejected.
- **Tie:** if the close equals the open, both stakes are refunded (2 each).
- **Expiry:** if the challenger's device has no acceptance when the round closes, the challenger's 2 is refunded. If a valid return link (accepted before the bell) arrives later, the dare is reinstated and re-settled from the candle. In that edge case the refund can be clawed back.
- **Settlement source:** only Binance's 15m candle for that round, and only once the next 15m candle exists, so the close is final. If Binance can't be reached, the dare shows "settling" and keeps retrying. It never settles on simulated prices.

## Share links

- Dare: `<origin><basePath>/#dare=<token>`
- Return: `<origin><basePath>/#accept=<token>`

The token is base64url JSON. A dare token holds the dare id, round id, challenger side, stake and challenger name. A return token holds the dare id, round id, friend name and acceptance time. Tokens are validated on decode, and the stake must be exactly 2. Links are built from `NEXT_PUBLIC_BASE_PATH`, so they work on GitHub Pages (`/headlineodds-arena-web/`) and at `/`. Data stays in the URL hash and is never sent to a server.

## Price feed

The live BTC price, the round open and the chart come from Binance's public, no-key BTCUSDT market data through the `data-api.binance.vision` mirror. The ticker updates every 5s, 15m and 1m klines every 30s, and the new round's open is checked every 1.5s after each bell (`lib/feed.ts`, `lib/open.ts`). If Binance fails three times in a row, the display falls back to a simulated feed and the banner says so. Dares never settle on the simulated feed.

## Limitations

- **Not real escrow.** Each device keeps its own escrow ledger in localStorage. Nothing stops someone editing their own storage, and nothing enforces payment across devices. Real cross-device escrow needs a backend or an onchain program holding the stakes.
- The challenger's device only learns of the acceptance from the return link. If that link is never opened, the two devices disagree (the friend sees a matched dare, and the challenger sees it expire and refunds).
- Clearing browser data loses the dares and the balance.
- Prices are BTC/USDT, not BTC/USD.

## Run locally

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # vitest: links, balance check, escrow, resolution, open price, settlement candle
npm run build    # static export to ./out
```

## Code map

- `lib/dare.ts`: pure dare rules (round choice, links, balance check, escrow, resolution, refunds)
- `lib/feed.ts`: Binance BTCUSDT feed hook plus `fetchRoundResult` for settlement
- `lib/open.ts`: kline parsing, round open, settlement from 15m candles
- `lib/game.ts`: round timing, outcome, simulated display feed
- `lib/store.ts`: localStorage state
- `components/App.tsx`: the single-page UI

Test version only. No earnings are implied.
