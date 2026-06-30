# WorldCup Bingo - Live Auto-Checking Bingo Card
## Build Spec for Claude Code

---

## What we're building

A World Cup bingo card web app where fans get a randomly generated card of match events before each game. TxLINE's real-time SSE stream auto-checks off squares the moment they happen - no manual input, no refreshing. Cards are shareable, replayable across all 104 games, and generate a score at the end of each match.

Submitted to the **Superteam × TxODDS World Cup Hackathon** under the **Fan Experiences** track.

**Hackathon deadline:** July 19, 2026 (23:59 UTC)  
**Required:** deployed app (mainnet or devnet), demo video, public GitHub repo, working link

---

## Architecture overview

```
TxLINE SSE Stream
       │
       ▼
Node.js Backend (Express)
  ├── Ingests SSE events from TxLINE
  ├── Maps events to bingo square categories
  ├── Broadcasts matched squares to connected clients via SSE
  └── REST endpoints: generate card, get match events
       │
       ▼
Frontend (Next.js or plain HTML + vanilla JS)
  ├── Card generator (5×5 grid, randomised per user per match)
  ├── SSE listener → auto-checks squares in real time
  ├── Streak + score tracker
  ├── Share flow → image export + tweet
  └── Match selector (upcoming games from TxLINE)
```

---

## Project structure

```
worldcup-bingo/
├── backend/
│   ├── index.js              # Express server entry point
│   ├── txline.js             # TxLINE SSE client
│   ├── eventMap.js           # Maps TxLINE events → bingo categories
│   ├── broadcast.js          # SSE broadcaster to frontend clients
│   └── routes/
│       ├── card.js           # GET /card/:matchId - generate a card
│       ├── matches.js        # GET /matches - upcoming World Cup fixtures
│       └── events.js         # GET /events/:matchId - SSE stream to client
├── frontend/
│   ├── index.html            # Match selector / home
│   ├── bingo.html            # Bingo card page
│   ├── app.js                # Card rendering + SSE listener
│   └── styles.css
├── .env.example
├── package.json
└── README.md
```

---

## The bingo squares - master list

25 squares total per card. Each game, 25 are drawn randomly from this pool of ~40 and shuffled into a 5×5 grid. The centre square is always FREE.

### Always in the pool (high probability, good for engagement)
| Square | TxLINE trigger |
|---|---|
| Corner kick in first 10 mins | `corner` event, minute ≤ 10 |
| Yellow card | `yellow_card` |
| Goal scored | `goal` |
| VAR review | `var_review` |
| Substitution before 60 mins | `substitution`, minute < 60 |
| Injury stoppage | `injury` |
| Shot on target (first of match) | `shot_on_target`, first occurrence |
| Odds shift ≥ 5% | `odds_shift`, threshold ≥ 5pp |
| Foul in the box | `foul`, location = penalty_area |
| Match goes to extra time | `extra_time_start` |

### Medium probability
| Square | TxLINE trigger |
|---|---|
| Red card | `red_card` |
| Penalty awarded | `penalty_awarded` |
| Goal in first 15 mins | `goal`, minute ≤ 15 |
| Goal in last 10 mins | `goal`, minute ≥ 80 |
| Hat trick | 3x `goal` same player |
| Own goal | `own_goal` |
| Goalkeeper save (5+ in match) | `save`, count ≥ 5 |
| Match ends 0-0 | `full_time`, score = 0-0 |
| Comeback (losing team equalises) | score logic from event stream |
| Free kick goal | `goal`, type = free_kick |

### Low probability / spicy squares
| Square | TxLINE trigger |
|---|---|
| Penalty shootout | `penalty_shootout_start` |
| Two red cards in one match | `red_card`, count ≥ 2 |
| Goal disallowed by VAR | `var_goal_disallowed` |
| Injury to a goalkeeper | `injury`, position = goalkeeper |
| 5+ goals in the match | `full_time`, total_goals ≥ 5 |
| Penalty missed | `penalty_missed` |
| Three substitutions in one half | `substitution`, count per half ≥ 3 |

**Note:** Confirm exact TxLINE event type names and field structures from their docs before implementing: https://txline.txodds.com/documentation/worldcup. The names above are illustrative - adapt to whatever TxLINE actually emits.

---

## Backend - detailed spec

### Environment variables (`.env`)

```
TXLINE_API_KEY=your_txline_key
TXLINE_SSE_URL=https://txline.txodds.com/stream
PORT=3001
```

### TxLINE SSE client (`txline.js`)

- Connect using `eventsource` npm package
- Parse all incoming JSON events for active matches
- Pass each event through `eventMap.js` to determine which bingo categories it satisfies
- Emit matched categories on an internal EventEmitter

### Event mapper (`eventMap.js`)

```js
// Example structure - adapt field names to actual TxLINE schema
function mapEventToSquares(event) {
  const matched = []

  if (event.type === 'goal') {
    matched.push('goal')
    if (event.minute <= 15) matched.push('goal_first_15')
    if (event.minute >= 80) matched.push('goal_last_10')
    if (event.subtype === 'own_goal') matched.push('own_goal')
    if (event.subtype === 'free_kick') matched.push('free_kick_goal')
  }

  if (event.type === 'yellow_card') matched.push('yellow_card')
  if (event.type === 'red_card') matched.push('red_card')
  // ... etc for all categories

  return matched  // array of square category keys that this event triggers
}
```

Returns an array of matched category keys. Broadcaster fires all of them.

### Routes

**`GET /matches`**
- Calls TxLINE to get upcoming and live World Cup fixtures
- Returns array of `{ matchId, homeTeam, awayTeam, kickoff, status }`

**`GET /card/:matchId`**
- Does not require auth
- Randomly selects 24 squares from the master pool (centre is always FREE)
- Shuffles into a 5×5 grid
- Returns the grid as a JSON array of 25 objects: `{ id, label, category, checked: false }`
- Seed the randomness from `matchId + userId` (use a UUID stored in localStorage as userId) so the same user always gets the same card for the same match (prevents refresh-to-cheat)

**`GET /events/:matchId`** - SSE to frontend
- Streams matched square category keys as they happen
- Format: `data: { "categories": ["goal", "goal_first_15"], "eventDetail": "Mbappé, 12'" }\n\n`
- Flushes all already-triggered categories on connection (for late joiners)

---

## Frontend - detailed spec

### Home page (`index.html`)

- Header: "World Cup Bingo" + tagline: "Your card. 104 games. All auto-checked."
- Fixture list: upcoming and live matches from `GET /matches`
  - Each fixture shows: teams, kickoff time, status badge (Live / Upcoming / Finished)
  - "Play" button → navigates to `/bingo.html?match=MATCH_ID`
- Footer: link to how it works

### Bingo card page (`bingo.html`)

**On load:**
1. Read `?match=MATCH_ID` from URL
2. Get/create userId from localStorage (generate UUID if not present)
3. Fetch card from `GET /card/:matchId` - render 5×5 grid
4. Open SSE connection to `GET /events/:matchId`
5. Show current score + match clock pulled from TxLINE (via a polling endpoint or same SSE stream)

**Grid rendering:**
- 5×5 CSS grid, each cell is a square card
- Square states:
  - Unchecked: white background, label text, subtle border
  - Checked: green background (`#EAF3DE`), checkmark icon, label text (strikethrough or dimmed)
  - Bingo line: highlight all squares in the completed row/col/diagonal with a gold border
  - FREE centre: always checked, styled differently (grey/neutral)
- Animate check: scale up briefly (1 → 1.08 → 1) + background colour transition on check
- Show a toast notification when a square is checked: "⚽ Goal! - Mbappé, 12' - square checked!"

**Bingo detection:**
- Check after every square is checked
- Win conditions: any complete row, column, or diagonal (standard bingo rules)
- On bingo: show a banner "BINGO!" + confetti animation (use canvas-confetti from cdnjs) + show share button
- Allow multiple bingos per card (keep playing after first bingo)

**Score system:**
- Each checked square = +10 points
- Completing a line = +50 bonus
- Full card (blackout) = +200 bonus
- Show running score in the header throughout the match

**End of match:**
- On `full_time` event: freeze the card
- Show results panel:
  - Final score (yours)
  - How many squares checked out of 24
  - Any bingo lines hit
  - Share button

### Share flow

Two share options:

1. **Tweet share:**
   - Text: `"I got [X] squares in Brazil vs France! 🟩⬜🟩⬜🟩 Play World Cup Bingo → [link] #WorldCup2026"`
   - Opens `twitter.com/intent/tweet?text=...` in a new tab

2. **Image share (stretch goal - implement if time allows):**
   - Use `html2canvas` (available on cdnjs) to screenshot the bingo grid
   - Download as PNG or share via Web Share API
   - The image shows the card state with checked squares visible - naturally shareable

---

## Visual design

Keep it clean and simple - this needs to feel polished enough for non-technical fans.

- Background: off-white (`#F9F8F6`)
- Card grid: white cells, 1px border, 8px border radius
- Checked cell: `background: #EAF3DE`, `color: #3B6D11`
- FREE cell: `background: #F1EFE8`, `color: #5F5E5A`
- Bingo line highlight: `border: 2px solid #EF9F27` (amber)
- Font: system font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`)
- Fully responsive - must work well on mobile (fans will use this on their phones during the match)
- Mobile layout: grid cells smaller (~60px), font size 11px, toast notifications at bottom of screen

---

## Deployment

- **Backend:** Railway, Render, or Fly.io - needs persistent SSE connections, do not use standard Vercel serverless
- **Frontend:** Vercel or Netlify (static)
- Both must be publicly accessible

---

## Demo video plan (max 5 minutes)

1. **0:00-0:30** - Open the home page, pick a live match, hit Play. Card generates instantly.
2. **0:30-1:30** - Watch a match event come in (goal or yellow card). Show the square auto-checking in real time with the animation. Show the toast notification.
3. **1:30-2:30** - Show the backend terminal: TxLINE event arrives → eventMap fires → SSE broadcast → frontend checks the square. Prove the full data flow live.
4. **2:30-3:30** - Simulate a bingo line completing. Show the "BINGO!" banner + confetti. Demonstrate the share tweet being composed.
5. **3:30-4:00** - Show the same match on two browser windows side by side - different cards (different random seeds), both getting the same squares checked at the same time.
6. **4:00-4:30** - Show the end-of-match results panel after `full_time` fires.
7. **4:30-5:00** - Wrap: "25 squares. 104 games. Zero manual effort. Every fan gets a different card - all powered by TxLINE."

---

## Submission checklist

- [ ] Backend deployed and publicly accessible
- [ ] Bingo card generates correctly and is stable on refresh (same card per user per match)
- [ ] Squares auto-check from live TxLINE events
- [ ] Bingo detection works for rows, columns, diagonals
- [ ] Share tweet flow works
- [ ] Mobile layout tested and usable
- [ ] GitHub repo public with README
- [ ] Demo video uploaded (Loom or YouTube)
- [ ] TxLINE endpoints used listed in submission form
- [ ] API feedback prepared for submission form

---

## TxLINE resources

- Quickstart: https://txline.txodds.com/documentation/quickstart
- World Cup docs: https://txline.txodds.com/documentation/worldcup
- Support: Discord and Telegram (links in hackathon brief)
- Data fees waived until July 19, 2026

---

## Key decisions / notes for Claude Code

- **Seed the card generator** using `matchId + userId` so the same user always gets the same card for a given match. A simple approach: `Math.seedrandom(matchId + userId)` using the `seedrandom` npm package, then use that to shuffle the square pool.
- **Store userId in localStorage** as a UUID. Generate on first visit. This gives consistent cards without requiring login.
- **Replay protection:** cache all triggered category keys per match in backend memory. When a new client connects mid-match, immediately flush all already-triggered categories so their card catches up.
- **Don't implement auth for the hackathon** - open access is fine. The Solana sign-in requirement from the brief is softer for Fan Experiences than for the Markets track ("sign up through Solana" - a simple wallet connect on the home page satisfies this).
- **Confetti library:** `canvas-confetti` is available on cdnjs - use it for the bingo moment, it's one line of JS and judges will love it.
- **Mobile first:** most fans will play this on their phones during the match. Test the grid at 375px width.
- **Start with a simulated event stream** for development - create a `mockStream.js` that fires fake TxLINE events on a timer so you can develop without needing a live match.
- The `html2canvas` image share is a stretch goal - ship the tweet share first, add image export if time allows.
