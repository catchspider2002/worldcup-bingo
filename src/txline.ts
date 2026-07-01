// WorldCup Bingo - TxLINE client (auth + fixtures + score state).
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

// Keep ONLY the senior men's FIFA World Cup 2026 - excludes qualifiers, youth (U-17/U-20),
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
  const latest = arr.reduce((a, b) => (seqOf(b) > seqOf(a) ? b : a));
  const phase = phaseOf(latest);
  const sm = statMap(latest);
  const sc = latest?.ScoreSoccer ?? latest?.scoreSoccer;
  const g1 = sm.get(1) ?? num(sc?.Participant1?.Total?.Goals);
  const g2 = sm.get(2) ?? num(sc?.Participant2?.Total?.Goals);
  const y = (sm.get(3) ?? num(sc?.Participant1?.Total?.YellowCards)) + (sm.get(4) ?? num(sc?.Participant2?.Total?.YellowCards));
  const r = (sm.get(5) ?? num(sc?.Participant1?.Total?.RedCards)) + (sm.get(6) ?? num(sc?.Participant2?.Total?.RedCards));
  const c = (sm.get(7) ?? num(sc?.Participant1?.Total?.Corners)) + (sm.get(8) ?? num(sc?.Participant2?.Total?.Corners));
  return {
    phase, started: phase !== 'NS', finished: FINISHED.has(phase),
    goals: g1 + g2, totalGoals: g1 + g2, yellows: y, reds: r, corners: c,
  };
}

// TxLINE soccer game-phase encoding (numeric id → code). Docs: scores/soccer-feed.
const PHASE_BY_ID: Record<number, string> = {
  1: 'NS', 2: 'H1', 3: 'HT', 4: 'H2', 5: 'F', 6: 'WET', 7: 'ET1', 8: 'HTET', 9: 'ET2',
  10: 'FET', 11: 'WPE', 12: 'PE', 13: 'FPE', 14: 'I', 15: 'A', 16: 'C', 17: 'TXCC', 18: 'TXCS', 19: 'P',
};
const PHASE_CODES = new Set(Object.values(PHASE_BY_ID));
function phaseOf(u: any): string {
  for (const k of Object.keys(u || {})) {
    if (!/status|phase|gamestate/i.test(k)) continue;
    let v: any = (u as any)[k];
    if (v && typeof v === 'object') v = Object.keys(v)[0];
    if (typeof v === 'number' && PHASE_BY_ID[v]) return PHASE_BY_ID[v];
    if (typeof v === 'string') { if (PHASE_CODES.has(v)) return v; const n = Number(v); if (Number.isFinite(n) && PHASE_BY_ID[n]) return PHASE_BY_ID[n]; }
  }
  return 'NS';
}
function seqOf(u: any): number { return num(u?.Seq ?? u?.seq ?? u?.Timestamp ?? u?.timestamp ?? u?.Ts ?? u?.ts); }
function statMap(u: any): Map<number, number> {
  const m = new Map<number, number>();
  const s = u?.Stats ?? u?.stats;
  if (Array.isArray(s)) { for (const it of s) { const k = Number(it?.Key ?? it?.key ?? it?.[0]); if (Number.isFinite(k)) m.set(k, num(it?.Value ?? it?.value ?? it?.[1])); } }
  else if (s && typeof s === 'object') { for (const k of Object.keys(s)) { const kn = Number(k); if (Number.isFinite(kn)) m.set(kn, num((s as any)[k])); } }
  return m;
}
const num = (x: any) => (Number.isFinite(Number(x)) ? Number(x) : 0);
