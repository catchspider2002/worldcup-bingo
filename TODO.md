# WorldCup Bingo — Submission Checklist

Track: **Consumer & Fan Experiences** (Superteam × TxODDS World Cup Hackathon)
Live: https://worldcup-bingo.catchspider2002.workers.dev · Repo: https://github.com/catchspider2002/worldcup-bingo

## ✅ Done

- [x] Worker + static assets (home, card page)
- [x] MatchRoom Durable Object: WebSocket fan-out + ~20s alarm polling (no Container)
- [x] TxLINE client: guest-JWT auth (cached) + fixtures + scores
- [x] Event mapping from documented stat keys (goals/yellows/reds/corners) + phases
- [x] Seeded 5×5 card generation (same card per fixtureId + userId)
- [x] Live auto-check with animation + toast, bingo detection + confetti, tweet share
- [x] Demo driver: `POST /api/mock-event/:fixtureId`
- [x] Deployed to Cloudflare; `TXLINE_API_KEY` set as a secret
- [x] Verified live: `/api/matches` returns real World Cup fixtures
- [x] README + CLOUDFLARE.md (as-built) docs

## ⏳ Before submitting

- [ ] **Record demo video** (≤5 min) — open a card, fire `mock-event` calls, show squares checking + a bingo line + confetti; mention real auto-detection polls TxLINE every ~20s
- [ ] **Add the demo video link** to README + submission form
- [ ] **Push final code to GitHub** — confirm latest commit; verify `.dev.vars` is NOT committed
- [ ] **Fill submission form**: live URL, GitHub URL, video URL, TxLINE endpoints used, API feedback
- [ ] Attach custom domain `bingo.<domain>` (optional)

## 💡 Optional polish

- [ ] Solflare/Phantom/Backpack connect on the home page (Solana sign-up requirement; softer for Fan track)
- [ ] Minute-specific squares (goal in first 15 / last 10) via the scores action feed (`SoccerData.Minutes`) instead of mock
- [ ] `html2canvas` image share of the finished card (currently tweet-text share)
- [ ] Second-screen test: two browsers on the same fixture get different cards but check simultaneously
