// WorldCup Bingo - Cloudflare Worker. Routes + static assets; real-time via MatchRoom DO.
import { listFixtures } from './txline';
import { generateCard } from './squares';
export { MatchRoom } from './matchRoom';

export interface Env {
  ASSETS: Fetcher;
  MATCH_ROOM: DurableObjectNamespace;
  TXLINE_API_KEY?: string;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

function room(env: Env, fixtureId: string, path: string, req?: Request): Promise<Response> {
  const id = env.MATCH_ROOM.idFromName(fixtureId);
  const stub = env.MATCH_ROOM.get(id);
  const u = new URL(`https://room${path}`);
  u.searchParams.set('fixtureId', fixtureId);
  const fwd = req ? new Request(u.toString(), req) : new Request(u.toString());
  return stub.fetch(fwd);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(req);

    try {
      // GET /api/matches - upcoming/live World Cup fixtures
      if (path === '/api/matches' && req.method === 'GET') {
        if (!env.TXLINE_API_KEY) return json({ fixtures: [], note: 'TXLINE_API_KEY not set' });
        const cid = url.searchParams.get('competitionId');
        const fixtures = await listFixtures({ TXLINE_API_KEY: env.TXLINE_API_KEY }, cid ? Number(cid) : undefined);
        return json({ fixtures });
      }

      // GET /api/card/:fixtureId?u=userId - seeded 5x5 card
      let m = path.match(/^\/api\/card\/(\w+)$/);
      if (m && req.method === 'GET') {
        const userId = url.searchParams.get('u') || 'anon';
        return json({ fixtureId: m[1], cells: generateCard(m[1], userId) });
      }

      // GET (WebSocket) /api/events/:fixtureId - live square checks
      m = path.match(/^\/api\/events\/(\w+)$/);
      if (m) return room(env, m[1], '/events', req);

      // POST /api/mock-event/:fixtureId { category, detail } - demo driver
      m = path.match(/^\/api\/mock-event\/(\w+)$/);
      if (m && req.method === 'POST') return room(env, m[1], '/mock', req);

      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String((e as Error).message || e) }, 500);
    }
  },
};
