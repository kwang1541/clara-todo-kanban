import crypto from 'node:crypto';
import { createStore, DecryptError } from '../lib/board.mjs';
import * as M from '../lib/model.mjs';
import { fetchTodos } from '../lib/clara.mjs';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
// 상수시간 비교 (#6)
export const keyOk = (given, need) => !!need && crypto.timingSafeEqual(h(given || ''), h(need));

const ACTIONS = { move: (b, x, now) => M.move(b, x.id, x.column, now), add: (b, x, now) => M.add(b, x, now), delete: (b, x, now) => M.hide(b, x.id, now), hide: (b, x, now) => M.hide(b, x.id, now), restore: (b, x, now) => M.restore(b, x.id, now), purge: (b, x, now) => M.purge(b, x.id, now), edit: (b, x, now) => M.edit(b, x.id, x, now) };

export function makeHandler({ store = createStore(), fetcher = fetchTodos, env = process.env, delay = 800 } = {}) {
  return async function handle(req) {
    if (!keyOk(req.headers.get('x-board-key'), env.BOARD_KEY)) {
      await new Promise((r) => setTimeout(r, delay)); // 무차별 대입 속도 억제
      return json({ error: 'unauthorized' }, 401);
    }
    const route = new URL(req.url).pathname.replace(/^\/api\/?/, '');
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    try {
      if (req.method === 'GET' && route === 'board') return json(await store.load());
      if (req.method === 'POST' && route === 'sync') {
        const trigger = body.trigger === 'schedule' ? 'schedule' : 'manual';
        let todos = null, err = null;
        try {
          if (!env.CLARA_KEY) throw new Error('CLARA_KEY 환경변수 없음');
          // 클라라 조회를 먼저 끝내고 저장 직전에 최신 보드에 병합 → 경합 구간 최소화 (#3)
          todos = await fetcher({ key: env.CLARA_KEY, url: env.CLARA_URL || undefined, me: env.CLARA_ME || '김광훈', days: Number(env.CLARA_DAYS || 60) });
        } catch (e) { err = e; }
        const now = new Date().toISOString();
        const { board } = await store.mutate((b) => {
          if (err) Object.assign(b, M.recordSyncError(b, err.message || err, now, trigger));
          else Object.assign(b, M.applySync(b, todos, now, trigger).board);
        });
        return json(board, err ? 502 : 200);
      }
      if (req.method === 'POST' && ACTIONS[route]) {
        const now = new Date().toISOString();
        const { board } = await store.mutate((b) => { Object.assign(b, M.migrate(b)); ACTIONS[route](b, body, now); });
        return json(board);
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      if (e instanceof M.HttpError) return json({ error: e.message }, e.status);
      if (e instanceof DecryptError) return json({ error: e.message }, 500);
      return json({ error: String(e.message || e).slice(0, 300) }, 500);
    }
  };
}

const handle = makeHandler();
export const GET = (req) => handle(req);
export const POST = (req) => handle(req);
export const config = { maxDuration: 60 };