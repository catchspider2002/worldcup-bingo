// WorldCup Bingo — TxLINE client (auth + fixtures + score state).
// Auth: every data call needs Authorization: Bearer <guest JWT> + X-Api-Token: <TXLINE_API_KEY>.
// Documented soccer stat keys (full game): 1/2 goals, 3/4 yellows, 5/6 reds, 7/8 corners (P1/P2).

const BASE = 'https://txline.txodds.com';

export interface TxEnv { TXLINE_API_KEY?: string; jwtCache?: { get(): Promise<string | null>; set(v: string): Promise<void> } }

// JWT cache is supplied by the caller (Durable Object storage), so this module stays stateless.
async function getJwt(env: TxEnv, force = false): Promise<string> {
  if (!force && env.jwtCache) {
    const cached = await env.jwtCache.get();
    if (cached) return cached;
  }
  const r = await fetch(`${BASE}/auth/guest/start`, { method: 'POST' });
  if (!r.ok) throw new Error('guest start failed: ' + r.status);
  const token = (await r.json() as { token: string }).token;
  if (env.jwtCache) await env.jwtCache.set(token);
  return token;
}

async function authedGet(env: TxEnv, path: string): Promise<Response> {
  if (!env.TXLINE_API_KEY) throw new Error('TXLINE_API_KEY not set');
  let jwt = await getJwt(env);
  const headers = () => ({ Authorization: `Bearer ${jwt}`, 'X-Api-Token': env.TXLINE_API_KEY! });
  let res = await fetch(BASE + path, { headers: headers() });
  if (res.status === 401) { jwt = await getJwt(env, true); res = await fetch(BASE + path, { headers: headers() }); }
  return res;
}

export interface TxFixture {
  fixtureId: number; competition: string; startTime: number;
  home: string; away: string; p1IsHome: boolean;
}

// Keep ONLY the senior men's FIFA World Cup 2026 — excludes qualifiers, youth (U-17/U-20),
// women's, Club World Cup, beach/futsal/esports, and any other edition/year.
function isMainWorldCup(name: string): boolean {
  const s = (name || '').toLowerCase();
  if (!/world cup/.test(s)) return false;
  if (/qualif|wom(e|a)n|u-?\d{1,2}|under[\s-]?\d{1,2}|youth|club|beach|futsal|esoccer|e-?sports|e[\s-]?world/.test(s)) return false;
  const year = s.match(/\b(19|20)\d{2}\b/);
  if (year && year[0] !== '2026') return false;
  return true;
}

export async function listFixtures(env: TxEnv, competitionId?: number): Promise<TxFixture[]> {
  const q = competitionId ? `?competitionId=${competitionId}` : '';
  const res = await authedGet(env, '/api/fixtures/snapshot' + q);
  if (!res.ok) throw new Error('fixtures ' + res.status);
  const arr = await res.json() as any[];
  return arr.map((f) => {
    const p1Home = !!f.Participant1IsHome;
    return {
      fixtureId: f.FixtureId, competition: f.Competition, startTime: f.StartTime,
      home: p1Home ? f.Participant1 : f.Participant2,
      away: p1Home ? f.Participant2 : f.Participant1,
      p1IsHome: p1Home,
    };
  }).filter((f) => (competitionId ? true : isMainWorldCup(f.competition || '')));
}

export interface ScoreState {
  phase: string; started: boolean; finished: boolean;
  goals: number; yellows: number; reds: number; corners: number; totalGoals: number;
}

const FINISHED = new Set(['F', 'FET', 'FPE']);

export async function getScoreState(env: TxEnv, fixtureId: string | number): Promise<ScoreState> {
  const res = await authedGet(env, `/api/scores/snapshot/${fixtureId}`);
  if (!res.ok) throw new Error('scores ' + res.status);
  const arr = await res.json() as any[];
  const empty: ScoreState = { phase: 'NS', started: false, finished: false, goals: 0, yellows: 0, reds: 0, corners: 0, totalGoals: 0 };
  if (!Array.isArray(arr) || arr.length === 0) return empty;
  const latest = arr.reduce((a, b) => ((b?.seq ?? b?.ts ?? 0) > (a?.seq ?? a?.ts ?? 0) ? b : a));
  const phase = phaseOf(latest);
  const st = latest?.stats || {};
  const sc = latest?.scoreSoccer;
  const n = (k: string, totFallback?: number) => (st[k] != null ? num(st[k]) : (totFallback ?? 0));
  const g1 = n('1', num(sc?.Participant1?.Total?.Goals));
  const g2 = n('2', num(sc?.Participant2?.Total?.Goals));
  const y = n('3', num(sc?.Participant1?.Total?.YellowCards)) + n('4', num(sc?.Participant2?.Total?.YellowCards));
  const r = n('5', num(sc?.Participant1?.Total?.RedCards)) + n('6', num(sc?.Participant2?.Total?.RedCards));
  const c = n('7', num(sc?.Participant1?.Total?.Corners)) + n('8', num(sc?.Participant2?.Total?.Corners));
  return {
    phase, started: phase !== 'NS', finished: FINISHED.has(phase),
    goals: g1 + g2, totalGoals: g1 + g2, yellows: y, reds: r, corners: c,
  };
}

function phaseOf(u: any): string {
  if (typeof u?.gameState === 'string' && u.gameState) return u.gameState;
  const s = u?.statusSoccerId;
  if (typeof s === 'string') return s;
  if (s && typeof s === 'object') return Object.keys(s)[0] || 'NS';
  return 'NS';
}
const num = (x: any) => (Number.isFinite(Number(x)) ? Number(x) : 0);
