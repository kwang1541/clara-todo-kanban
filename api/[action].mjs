import { COLUMNS, loadBoard, saveBoard, syncBoard } from '../lib/board.mjs';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

async function handle(req) {
  const need = process.env.BOARD_KEY;
  if (!need || req.headers.get('x-board-key') !== need) return json({ error: 'unauthorized' }, 401);
  const route = new URL(req.url).pathname.replace(/^\/api\/?/, '');
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};

  if (req.method === 'GET' && route === 'board') return json(await loadBoard());
  if (req.method === 'POST' && route === 'sync') {
    const b = await syncBoard(body.trigger === 'schedule' ? 'schedule' : 'manual');
    return json(b, b.lastError ? 502 : 200);
  }

  const b = await loadBoard();
  const now = new Date().toISOString();
  if (req.method === 'POST' && route === 'move') {
    const it = b.items[body.id];
    if (!it || !COLUMNS.includes(body.column)) return json({ error: 'bad request' }, 400);
    it.column = body.column; it.movedAt = now;
    if (body.column === 'done') it.doneAt = now; else delete it.doneAt;
    return json(await saveBoard(b));
  }
  if (req.method === 'POST' && route === 'add') {
    const title = String(body.title || '').trim().slice(0, 200);
    if (!title) return json({ error: 'title required' }, 400);
    const id = 'm:' + Date.now().toString(36);
    b.items[id] = { id, title, from: '직접 추가', date: now.slice(0, 10), column: 'todo', source: 'manual', createdAt: now, movedAt: now, snippet: String(body.note || '').slice(0, 400) };
    return json(await saveBoard(b));
  }
  if (req.method === 'POST' && route === 'delete') {
    if (!b.items[body.id]) return json({ error: 'not found' }, 404);
    if (b.items[body.id].source === 'clara') b.items[body.id].column = 'hidden';
    else delete b.items[body.id];
    return json(await saveBoard(b));
  }
  return json({ error: 'not found' }, 404);
}

export const GET = handle;
export const POST = handle;
export const config = { maxDuration: 60 };
