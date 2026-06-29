# WorldCup Bingo — Cloudflare Deployment (as built)

**Track:** Consumer & Fan Experiences · **Subdomain:** `bingo.<domain>`
**Live:** https://worldcup-bingo.catchspider2002.workers.dev
**Build spec:** see `SPEC.md`. Implementation notes: see `README.md`.

## Architecture decision: Durable Object polling, NOT a Container

The original plan used a Container running an always-on TxLINE SSE consumer. **The shipped build does not use a Container.** Instead, real-time is handled entirely by a **Durable Object** that polls TxLINE's REST scores endpoint on an alarm and fans out to browsers over WebSocket. This keeps the deploy to a single `wrangler deploy` (no Dockerfile, no D1) and reuses the same Workers + TxLINE-client stack as the other cron-style projects.

Trade-off: ~20s detection latency (alarm poll) vs. instant SSE. For a fan bingo card that's imperceptible, and the free World Cup tier data is itself sampled (60s delayed on SL1, real-time on SL12).

## Component mapping (as built)

| Spec component | Cloudflare (shipped) |
|---|---|
| TxLINE consumer | **`src/txline.ts`** — guest-JWT auth (cached in DO storage) + `GET /api/fixtures/snapshot` + `GET /api/scores/snapshot/{fixtureId}`. No SSE, no Container. |
| Event → bingo categories | **`src/squares.ts`** `categoriesFor()` — maps documented soccer stat keys (1/2 goals, 3/4 yellows, 5/6 reds, 7/8 corners) + phase to category keys |
| Per-match clients + triggered-category cache | **`src/matchRoom.ts`** `MatchRoom` Durable Object — accepts WebSockets (hibernation), stores triggered set, ~20s alarm poll, broadcasts new squares, flushes state to late joiners, stops when idle/finished |
| `GET /matches` | Worker `GET /api/matches` → `listFixtures()` |
| `GET /card/:id` (seeded) | Worker `GET /api/card/:fixtureId?u=userId` → `generateCard()` (mulberry32, seeded by `fixtureId+userId`) |
| `GET /events/:id` | Worker `GET /api/events/:fixtureId` → WebSocket upgrade forwarded to the fixture's Durable Object |
| demo driver | Worker `POST /api/mock-event/:fixtureId { category, detail }` → DO `trigger()` |
| frontend | served from `./public` via Workers **[assets]** (no separate Pages project) |
| client `userId` | browser `localStorage` UUID |

**Flow:** browser opens WS → Worker routes to `MatchRoom` (by fixtureId) → DO alarm polls TxLINE scores every ~20s → maps to satisfied categories → broadcasts newly-checked squares to all connected browsers.

## Bindings (`wrangler.toml`, as shipped)

```toml
name = "worldcup-bingo"
main = "src/worker.ts"
compatibility_date = "2026-01-01"

[assets]
directory = "./public"
binding = "ASSETS"

[[durable_objects.bindings]]
name = "MATCH_ROOM"
class_name = "MatchRoom"

[[migrations]]
tag = "v1"
new_classes = ["MatchRoom"]
```

Secret: `TXLINE_API_KEY` only (no `ANTHROPIC_API_KEY` — no Claude; no Container; no D1).

## Deploy

```bash
npm install
wrangler login
wrangler secret put TXLINE_API_KEY
npm run deploy            # creates the Worker + MatchRoom DO; serves /public
```

Optional: attach `bingo.<domain>` to the Worker in the dashboard.

## Verify

- `GET /api/matches` returns live World Cup fixtures (confirms JWT + token + both headers). ✅ verified live.
- Open `/bingo.html?match=<fixtureId>`, then `POST /api/mock-event/<fixtureId>` with `{"category":"goal"}` and watch the square check across any open card. Complete a line → confetti.

## Notes

- Auto-detected squares are count/phase-based (goals 1/2/3/5+, yellow/red incl. two reds, corners incl. 5+, half time, full time, 0–0, extra time, penalties). Minute-specific/rare squares are demo/mock-driven.
- DO stops polling when no clients are connected and on full time (cost-safe).
- Same card per `fixtureId + userId`; different per user; stable on refresh.
- A Solflare/Phantom/Backpack connect can be added on the home page for the (softer, Fan-track) Solana sign-up requirement.
