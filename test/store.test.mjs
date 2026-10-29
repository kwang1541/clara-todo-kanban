import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, enc, dec, pointerPath, dataPath, DecryptError, SKIP } from '../lib/board.mjs';
import { fakeBlob } from './fake-blob.mjs';

process.env.BOARD_KEY = 'test-key-1';
const mk = () => { const fb = fakeBlob(); return { fb, s: createStore(fb, { fetchImpl: fb.fetch }) }; };
const dataFiles = (fb) => [...fb.files.keys()].filter((p) => p.includes('/v/'));

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

test('#2 포인터 생성 후 list 호출 0회, 버전 파일은 최신 1개만 유지', async () => {
  const { fb, s } = mk();
  await s.mutate((b) => { b.items.x = { id: 'x' }; }); // 최초 1회는 이관 확인 list
  const listAfterInit = fb.ops.list;
  await s.load(); await s.mutate((b) => { b.items.y = { id: 'y' }; }); await s.mutate((b) => { b.items.z = { id: 'z' }; });
  const b = await s.load();
  assert.equal(fb.ops.list, listAfterInit);
  assert.ok(fb.files.has(pointerPath()));
  assert.equal(dataFiles(fb).length, 1);
  assert.deepEqual(Object.keys(b.items).sort(), ['x', 'y', 'z']);
  assert.equal(b.rev, 3);
});

test('#2 쓰기 직후 읽기는 항상 최신 (버전 파일 URL 이 매번 새것)', async () => {
  const { s } = mk();
  for (let i = 1; i <= 3; i++) { await s.mutate((b) => { b.n = i; }); assert.equal((await s.load()).n, i); }
});

test('SKIP 이면 저장하지 않음', async () => {
  const { fb, s } = mk();
  await s.mutate((b) => { b.items.a = { id: 'a' }; });
  const puts = fb.ops.put;
  const r = await s.mutate(() => SKIP);
  assert.equal(r.skipped, true);
  assert.equal(fb.ops.put, puts);
});

test('#2 v1 타임스탬프 파일에서 1회 이관 (옛 파일 보존)', async () => {
  const { fb, s } = mk();
  const old = pointerPath().replace('head', '001761600000000.bin');
  await fb.put(old, enc({ items: { '제목': { id: '제목', docId: 'message:5#0', title: '제목', column: 'doing', source: 'clara' } }, history: [] }), {});
  const b = await s.load();
  assert.equal(b.items['c:message:5'].column, 'doing');
  await s.mutate(() => {});
  assert.ok(fb.files.has(pointerPath()));
  assert.ok(fb.files.has(old), '옛 파일은 롤백용으로 보존');
});

test('v1.2 초기 고정 경로(board.bin)에서 이관', async () => {
  const { fb, s } = mk();
  await fb.put(pointerPath().replace('head', 'board.bin'), enc({ schema: 2, rev: 3, items: { 'c:message:1': { id: 'c:message:1', column: 'doing' } } }), {});
  const b = await s.load();
  assert.equal(b.rev, 3);
  await s.mutate(() => {});
  assert.equal((await s.load()).items['c:message:1'].column, 'doing');
});

test('#3 동시 변경 2건 모두 반영 (포인터 ETag 충돌 시 재적용), 실패한 버전 파일은 정리', async () => {
  const { fb, s } = mk();
  await s.mutate((b) => { b.items = {}; });
  let first = true;
  await s.mutate(async (b) => { if (first) { first = false; await s.mutate((b2) => { b2.items.B = { id: 'B' }; }); } b.items.A = { id: 'A' }; });
  const b = await s.load();
  assert.ok(b.items.A && b.items.B, '두 변경 모두 남아야 함');
  assert.equal(dataFiles(fb).length, 1);
});

test('버전 파일이 잠깐 사라져도(다른 요청이 정리) 재조회로 읽음', async () => {
  const { fb, s } = mk();
  await s.mutate((b) => { b.v = 1; });
  const ver = fb.files.get(pointerPath()).contentType.split('d=')[1];
  const saved = fb.files.get(dataPath(ver));
  fb.files.delete(dataPath(ver));
  setTimeout(() => fb.files.set(dataPath(ver), saved), 50);
  assert.equal((await s.load()).v, 1);
});
