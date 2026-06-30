# World Cup Bingo - Live Auto-Checking Bingo Card

Pick a match, get a random 5×5 bingo card, and watch squares tick off **live** as TxLINE match data comes in - no manual input, no refreshing. Submitted to the Superteam × TxODDS World Cup Hackathon - Consumer & Fan Experiences track.

**Stack:** Cloudflare Workers + **Durable Objects** (WebSocket fan-out + alarm polling) + static assets. **No Container, no Claude API.**

- **Live:** https://worldcup-bingo.catchspider2002.workers.dev
- **GitHub:** https://github.com/catchspider2002/worldcup-bingo
- **Demo video:** _add link_
- **TxLINE endpoints used:** `POST /auth/guest/start`, `GET /api/fixtures/snapshot`, `GET /api/scores/snapshot/{fixtureId}`

---

## How it works

- **Frontend** (`public/`): home lists TxLINE fixtures; the card page renders a seeded 5×5, opens a WebSocket, and auto-checks squares with animation + toast, bingo detection, and confetti.
- **Worker** (`src/worker.ts`): `/api/matches`, `/api/card/:fixtureId`, the `/api/events/:fixtureId` WebSocket (forwarded to the DO), and `/api/mock-event/:fixtureId` for the demo.
- **MatchRoom Durable Object** (`src/matchRoom.ts`): one per fixture. Holds the connected browsers and the set of already-triggered categories; an alarm polls `getScoreState()` every ~20s and broadcasts newly-satisfied squares. Polling stops when no one is connected and on full time.
- **Squares + detection** (`src/squares.ts`): seeded card generation (`fixtureId + userId`, so refresh gives the same card) and a count/phase → category mapper using the documented soccer stat keys (1/2 goals, 3/4 yellows, 5/6 reds, 7/8 corners).

Auto-detected squares: goals (1/2/3/5+), yellow/red cards (incl. two reds), corners (incl. 5+), half time, full time, 0-0, extra time, penalty shootout. Other squares (penalty, VAR, own goal, minute-specific, etc.) appear on cards and can be fired with `mock-event` for the demo.

---

## Setup & deploy

```bash
npm install
wrangler login
wrangler secret put TXLINE_API_KEY      # your txoracle_api_... token
npm run deploy
```

Attach `bingo.<your-domain>` to the Worker in the dashboard (optional).

Local secrets: copy `.dev.vars.example` → `.dev.vars` (gitignored) and add `TXLINE_API_KEY` for `wrangler dev`.

---

## Demo (no live match needed)

1. Open the site, pick a match (or go straight to `/bingo.html?match=<fixtureId>`).
2. In another terminal, fire events at your card:
   ```bash
   BASE=https://worldcup-bingo.<sub>.workers.dev
   curl -X POST "$BASE/api/mock-event/<fixtureId>" -H 'content-type: application/json' -d '{"category":"goal","detail":"Mbappé 12’"}'
   curl -X POST "$BASE/api/mock-event/<fixtureId>" -H 'content-type: application/json' -d '{"category":"yellow_card"}'
   ```
   Watch the squares check off in real time across any open card on that fixture. Complete a line → confetti.

For a real match, the Durable Object polls TxLINE automatically while someone is watching - goals/cards/corners check off within ~20s.

## Notes / limitations (hackathon scope)

- Real auto-detection covers count- and phase-based squares (documented stat keys); minute-specific and rare-event squares are demo/mock-driven.
- Cards are seeded per `fixtureId + userId` (localStorage UUID) - same card on refresh, different per user.
- Free World Cup tier data may be ~60s delayed (Service Level 1) or real-time (Level 12).
- A light Solflare/Phantom/Backpack connect can be added to satisfy the Solana sign-up requirement (softer for the Fan track).
