// World Cup Bingo - frontend (home + card pages).
const qs = (s, r = document) => r.querySelector(s);
const api = (p, o) => fetch(p, o).then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status)); return d; });
const param = (k) => new URLSearchParams(location.search).get(k);
function uid() { let u = localStorage.getItem('wcb_uid'); if (!u) { u = crypto.randomUUID(); localStorage.setItem('wcb_uid', u); } return u; }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

const page = document.body.dataset.page;
if (page === 'home') initHome();
if (page === 'bingo') initBingo();

// ---------- Home ----------
async function initHome() {
  const host = qs('#fixtures');
  try {
    const { fixtures, note } = await api('/api/matches');
    if (note) { host.innerHTML = `<p class="muted">${esc(note)} - set it to list live fixtures. You can still open a card by fixture id: <code>/bingo.html?match=FIXTURE_ID</code>.</p>`; return; }
    // Show only live or upcoming matches - drop ones that have almost certainly finished
    // (kicked off more than ~2h45m ago, covering 90' + ET + penalties).
    const now = Date.now();
    const norm = (t) => (t < 1e12 ? t * 1000 : t);
    const shown = fixtures
      .map((f) => ({ ...f, _ms: norm(f.startTime) }))
      .filter((f) => f._ms >= now - 2.75 * 3600e3)
      .sort((a, b) => a._ms - b._ms);
    if (!shown.length) { host.innerHTML = '<p class="muted">No live or upcoming World Cup matches right now.</p>'; return; }
    host.innerHTML = shown.map((f) => {
      const live = f._ms <= now;
      const when = live ? '<span class="badge live">● LIVE</span>' : fmtTime(f.startTime);
      return `<div class="fixture"><div><div class="teams">${esc(f.home)} vs ${esc(f.away)}</div>` +
        `<div class="meta">${esc(f.competition || 'World Cup')} · ${when}</div></div>` +
        `<a class="btn primary" href="/bingo.html?match=${f.fixtureId}">Play</a></div>`;
    }).join('');
  } catch (e) { host.innerHTML = `<p class="muted">Couldn't load fixtures: ${esc(e.message)}</p>`; }
}
function fmtTime(t) {
  if (!t) return 'TBD';
  const ms = t < 1e12 ? t * 1000 : t; // seconds vs ms
  try { return new Date(ms).toLocaleString(); } catch { return 'TBD'; }
}

// ---------- Bingo card ----------
const LINES = (() => {
  const l = [];
  for (let r = 0; r < 5; r++) l.push([0, 1, 2, 3, 4].map((c) => r * 5 + c));
  for (let c = 0; c < 5; c++) l.push([0, 1, 2, 3, 4].map((r) => r * 5 + c));
  l.push([0, 6, 12, 18, 24]); l.push([4, 8, 12, 16, 20]);
  return l;
})();

async function initBingo() {
  const fixtureId = param('match');
  if (!fixtureId) { qs('#card').innerHTML = '<p class="muted">No match specified.</p>'; return; }
  qs('#match-title').textContent = `Match ${fixtureId}`;

  let cells = [];
  try { ({ cells } = await api(`/api/card/${fixtureId}?u=${uid()}`)); }
  catch (e) { qs('#card').innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }

  const checked = new Set([12]); // FREE centre
  const completedLines = new Set();
  let frozen = false;

  const root = qs('#card');
  root.innerHTML = '';
  cells.forEach((cell) => {
    const el = document.createElement('div');
    el.className = 'cell' + (cell.free ? ' free' : '') + (cell.free ? ' checked' : '');
    el.dataset.cat = cell.category; el.dataset.id = String(cell.id);
    el.textContent = cell.label;
    root.appendChild(el);
  });
  updateScore();

  function cellByCat(cat) { return [...root.children].find((e) => e.dataset.cat === cat); }
  function check(cat, detail) {
    if (frozen) return;
    const el = cellByCat(cat); if (!el) return;
    const id = Number(el.dataset.id);
    if (checked.has(id)) return;
    checked.add(id);
    el.classList.add('checked', 'pop');
    setTimeout(() => el.classList.remove('pop'), 200);
    toast(`✓ ${el.textContent}${detail ? ' - ' + detail : ''}`);
    detectBingo();
    updateScore();
  }
  function detectBingo() {
    LINES.forEach((line, i) => {
      if (completedLines.has(i)) return;
      if (line.every((id) => checked.has(id))) {
        completedLines.add(i);
        line.forEach((id) => root.children[id].classList.add('line'));
        toast('BINGO! 🎉');
        if (window.confetti) window.confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
      }
    });
  }
  function updateScore() {
    const squares = checked.size - 1; // exclude FREE
    const blackout = checked.size === 25 ? 200 : 0;
    const score = squares * 10 + completedLines.size * 50 + blackout;
    qs('#score-pill').textContent = `${score} pts`;
  }

  // share
  qs('#share-btn').addEventListener('click', () => {
    const squares = checked.size - 1;
    const text = `I got ${squares} squares in match ${fixtureId} on World Cup Bingo! ${location.origin} #WorldCup2026`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank');
  });

  // live connection
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const conn = qs('#conn');
  function connect() {
    const ws = new WebSocket(`${proto}://${location.host}/api/events/${fixtureId}`);
    ws.onopen = () => { conn.textContent = '● live'; conn.style.color = '#3B6D11'; };
    ws.onclose = () => { conn.textContent = '○ reconnecting…'; conn.style.color = ''; setTimeout(connect, 3000); };
    ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'init') (msg.categories || []).forEach((c) => check(c));
      else if (msg.type === 'check') (msg.categories || []).forEach((c) => check(c, msg.detail));
      else if (msg.type === 'finished') finish();
    };
  }
  connect();

  function finish() {
    frozen = true;
    const squares = checked.size - 1;
    qs('#result').classList.remove('hidden');
    qs('#result').innerHTML = `<h3>Full time</h3><p>You checked <b>${squares}</b> of 24 squares · ${completedLines.size} bingo line(s).</p>`;
  }
}

let toastTimer;
function toast(text) {
  const t = qs('#toast'); if (!t) return;
  t.textContent = text; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
