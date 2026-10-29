import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, enc, dec, boardPath, DecryptError } from '../lib/board.mjs';
import { fakeBlob } from './fake-blob.mjs';

process.env.BOARD_KEY = 'test-key-1';

test('암복호화 왕복', () => {
  const o = { items: { a: { title: '한글' } } };
  assert.deepEqual(dec(enc(o)), o);
});

test('키가 다르면 DecryptError', () => {
  const buf = enc({ a: 1 });
  process.env.BOARD_KEY = 'other';
  assert.throws(() => dec(buf), DecryptError);
  process.env.BOARD_KEY = 'test-key-1';
});

test('#2 정상 운영 시 list 호출 0회 (고정 경로 get/put)', async () => {
  const fb = fakeBlob(); const s = createStore(fb, { fetchImpl: fb.fetch });
  await s.mutate((b) => { b.items.x = { id: 'x' }; }); // 최초 1회는 이관 확인 list
  const listAfterInit = fb.ops.list;
  await s.load(); await s.mutate((b) => { b.items.y = { id: 'y' }; }); await s.load();
  assert.equal(fb.ops.list, listAfterInit);
  assert.equal(fb.files.size, 1);
  assert.ok(fb.files.has(boardPath()));
});

test('#2 v1 타임스탬프 파일에서 1회 이관', async () => {
  const fb = fakeBlob();
  const old = boardPath().replace('board.bin', '001761600000000.bin');
  await fb.put(old, enc({ items: { '제목': { id: '제목', docId: 'message:5#0', title: '제목', column: 'doing', source: 'clara' } }, history: [] }), {});
  const s = createStore(fb, { fetchImpl: fb.fetch });
  const b = await s.load();
  assert.equal(b.items['c:message:5'].column, 'doing');
  await s.mutate(() => {});
  assert.ok(fb.files.has(boardPath()));
  assert.ok(fb.files.has(old), '옛 파일은 롤백용으로 보존');
});

test('#3 동시 변경 2건 모두 반영 (ETag 충돌 시 재적용)', async () => {
  const fb = fakeBlob(); const s = createStore(fb, { fetchImpl: fb.fetch });
  await s.mutate((b) => { b.items = {}; });
  // A 가 읽은 뒤 B 가 먼저 저장 → A 는 충돌 후 최신 보드로 재시도
  let first = true;
  await s.mutate(async (b) => { if (first) { first = false; await s.mutate((b2) => { b2.items.B = { id: 'B' }; }); } b.items.A = { id: 'A' }; });
  const b = await s.load();
  assert.ok(b.items.A && b.items.B, '두 변경 모두 남아야 함');
});
