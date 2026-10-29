import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHandler, keyOk } from '../api/[action].mjs';
import { createStore } from '../lib/board.mjs';
import { fakeBlob } from './fake-blob.mjs';

process.env.BOARD_KEY = 'k-api';
const env = { BOARD_KEY: 'k-api', CLARA_KEY: 'x' };
const req = (path, body, key = 'k-api') => new Request('https://t/api/' + path, { method: body ? 'POST' : 'GET', headers: { 'x-board-key': key, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const mk = (o = {}) => { const fb = fakeBlob(); const store = o.store || createStore(fb, { fetchImpl: fb.fetch }); return makeHandler({ store, env, delay: 0, ...o }); };

test('#6 상수시간 키 비교', () => {
  assert.equal(keyOk('k-api', 'k-api'), true);
  assert.equal(keyOk('k-ap', 'k-api'), false);
  assert.equal(keyOk('', ''), false);
});

test('401 + 응답 지연', async () => {
  const h = mk({ delay: 30 });
  const t = Date.now(); const r = await h(req('board', null, 'bad'));
  assert.equal(r.status, 401); assert.ok(Date.now() - t >= 25);
});

test('#3 동기화가 클라라를 기다리는 동안 이동한 카드가 유실되지 않음', async () => {
  const fb = fakeBlob(); const store = createStore(fb, { fetchImpl: fb.fetch });
  const list = [{ docId: 'message:1#0', title: 'A', from: '이한옥', date: '2026-10-20' }, { docId: 'message:2#0', title: 'B', date: '2026-10-21' }];
  await mk({ store, fetcher: async () => list })(req('sync', { trigger: 'schedule' }));
  let release; const gate = new Promise((r) => (release = r));
  const h = mk({ store, fetcher: async () => { await gate; return list; } });
  const pSync = h(req('sync', {}));
  const mv = await h(req('move', { id: 'c:message:1', column: 'doing' }));
  assert.equal(mv.status, 200);
  release(); assert.equal((await pSync).status, 200);
  const b = await (await h(req('board'))).json();
  assert.equal(b.items['c:message:1'].column, 'doing');
});

test('#5 클라라 실패 시 502 + 보드 본문', async () => {
  const h = mk({ fetcher: async () => { throw new Error('MCP down'); } });
  const r = await h(req('sync', {}));
  assert.equal(r.status, 502);
  const j = await r.json(); assert.equal(j.lastError.message, 'MCP down'); assert.ok(j.items);
});

test('#5 복호화 실패는 명확한 500', async () => {
  const fb = fakeBlob(); const store = createStore(fb, { fetchImpl: fb.fetch });
  await store.mutate(() => {});
  const { boardPath } = await import('../lib/board.mjs');
  fb.files.get(boardPath()).data = Buffer.from('corrupted-data-not-aes-gcm-000000000000');
  const r = await mk({ store })(req('board'));
  assert.equal(r.status, 500); assert.match((await r.json()).error, /BOARD_KEY/);
});

test('추가·편집·숨김·복원·영구삭제 라우트', async () => {
  const h = mk();
  const b1 = await (await h(req('add', { title: '직접 할일' }))).json();
  const id = Object.keys(b1.items)[0];
  assert.equal((await h(req('edit', { id, priority: 'high', note: 'n' }))).status, 200);
  assert.equal((await h(req('edit', { id, priority: 'x' }))).status, 400);
  assert.equal((await (await h(req('hide', { id }))).json()).items[id].column, 'hidden');
  assert.equal((await (await h(req('restore', { id }))).json()).items[id].column, 'todo');
  await h(req('delete', { id }));
  assert.equal((await (await h(req('purge', { id }))).json()).items[id], undefined);
  assert.equal((await h(req('move', { id: 'nope', column: 'done' }))).status, 404);
});
