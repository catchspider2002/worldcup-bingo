// WorldCup Bingo — MatchRoom Durable Object.
// One instance per fixture. Holds the connected browsers (WebSocket) and the set of
// already-triggered bingo categories. An alarm polls TxLINE scores every ~20s, maps the
// state to satisfied categories, and broadcasts any newly-checked squares to all clients.
import { getScoreState } from './txline';
import { categoriesFor } from './squares';

const POLL_MS = 20000;

export interface RoomEnv { TXLINE_API_KEY?: string }

export class MatchRoom {
  ctx: DurableObjectState;
  env: RoomEnv;
  constructor(ctx: DurableObjectState, env: RoomEnv) { this.ctx = ctx; this.env = env; }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const fixtureId = url.searchParams.get('fixtureId');
    if (fixtureId) await this.ctx.storage.put('fixtureId', fixtureId);

    // Demo driver: POST /mock { category, detail }
    if (url.pathname === '/mock' && req.method === 'POST') {
      const b = await req.json().catch(() => ({})) as { category?: string; detail?: string };
      if (!b.category) return new Response('category required', { status: 400 });
      await this.trigger([b.category], b.detail || 'mock event');
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    // WebSocket subscribe
    if (req.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      this.ctx.acceptWebSocket(server);
      const triggered = (await this.ctx.storage.get<string[]>('triggered')) || [];
      server.send(JSON.stringify({ type: 'init', categories: triggered }));
      await this.ensureAlarm();
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('not found', { status: 404 });
  }

  async ensureAlarm(): Promise<void> {
    if (!(await this.ctx.storage.getAlarm())) {
      await this.ctx.storage.setAlarm(Date.now() + 3000); // first poll soon after connect
    }
  }

  async alarm(): Promise<void> {
    const fixtureId = await this.ctx.storage.get<string>('fixtureId');
    const sockets = this.ctx.getWebSockets();
    if (!fixtureId || sockets.length === 0) return; // nobody listening — stop polling

    let finished = false;
    try {
      const jwtCache = {
        get: () => this.ctx.storage.get<string>('jwt').then((v) => v ?? null),
        set: (v: string) => this.ctx.storage.put('jwt', v),
      };
      const s = await getScoreState({ TXLINE_API_KEY: this.env.TXLINE_API_KEY, jwtCache }, fixtureId);
      finished = s.finished;
      const cats = categoriesFor({ goals: s.goals, yellows: s.yellows, reds: s.reds, corners: s.corners, phase: s.phase });
      await this.trigger(cats, s.phase);
    } catch (e) {
      console.log('alarm poll error', String(e));
    }
    if (finished) this.broadcast({ type: 'finished' });
    else await this.ctx.storage.setAlarm(Date.now() + POLL_MS);
  }

  async trigger(categories: string[], detail: string): Promise<void> {
    const triggered = new Set((await this.ctx.storage.get<string[]>('triggered')) || []);
    const fresh = categories.filter((c) => c && !triggered.has(c));
    if (fresh.length === 0) return;
    fresh.forEach((c) => triggered.add(c));
    await this.ctx.storage.put('triggered', [...triggered]);
    this.broadcast({ type: 'check', categories: fresh, detail });
  }

  broadcast(msg: unknown): void {
    const str = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(str); } catch { /* closed */ } }
  }

  async webSocketClose(ws: WebSocket): Promise<void> { try { ws.close(); } catch { /* noop */ } }
  async webSocketError(): Promise<void> { /* noop */ }
}
