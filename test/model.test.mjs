import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../lib/model.mjs';

const NOW = '2026-10-29T01:00:00.000Z';
const todo = (docId, title, extra = {}) => ({ docId, title, from: '이한옥', date: '2026-10-20', url: '', ...extra });

test('keyOf: 문서ID(청크 제거) → url → 제목', () => {
  assert.equal(M.keyOf({ docId: 'message:111#0', title: 'a' }), 'c:message:111');
  assert.equal(M.keyOf({ docId: 'message:111#3', title: 'b' }), 'c:message:111');
  assert.equal(M.keyOf({ url: 'https://x/1', title: 'a' }), 'u:https://x/1');
  assert.equal(M.keyOf({ title: ' 주간보고 ' }), 't:주간보고');
});

test('#4 같은 제목 다른 문서는 카드 2장', () => {
  const { board, added } = M.applySync(M.emptyBoard(), [todo('message:1#0', '주간업무보고'), todo('message:2#0', '주간업무보고')], NOW);
  assert.equal(added, 2);
  assert.equal(Object.keys(board.items).length, 2);
});

test('#4 제목이 바뀌어도 카드 1장 · 열 유지', () => {
  let { board } = M.applySync(M.emptyBoard(), [todo('message:1#0', '원래 제목')], NOW);
  M.move(board, 'c:message:1', 'doing', NOW);
  ({ board } = M.applySync(board, [todo('message:1#0', '바뀐 제목')], '2026-10-29T02:00:00.000Z'));
  const arr = Object.values(board.items);
  assert.equal(arr.length, 1);
  assert.equal(arr[0].title, '바뀐 제목');
  assert.equal(arr[0].column, 'doing');
});

test('#4 v1(제목 키) 보드 이관: 열·완료시각 보존', () => {
  const v1 = { items: {
    '수율 보고': { id: '수율 보고', docId: 'message:9#0', title: '수율 보고', column: 'doing', source: 'clara', movedAt: '2026-10-28T01:00:00Z', createdAt: '2026-10-27T01:00:00Z' },
    '끝난 일': { id: '끝난 일', docId: 'message:8#0', title: '끝난 일', column: 'done', doneAt: '2026-10-28T03:00:00Z', source: 'clara', movedAt: '2026-10-28T03:00:00Z' },
    'm:abc': { id: 'm:abc', title: '직접', column: 'todo', source: 'manual' },
  }, history: [] };
  const { board, added } = M.applySync(v1, [todo('message:9#0', '수율 보고'), todo('message:8#0', '끝난 일')], NOW);
  assert.equal(added, 0);
  assert.equal(board.schema, 2);
  assert.equal(board.items['c:message:9'].column, 'doing');
  assert.equal(board.items['c:message:9'].createdAt, '2026-10-27T01:00:00Z');
  assert.equal(board.items['c:message:8'].doneAt, '2026-10-28T03:00:00Z');
  assert.ok(board.items['m:abc']);
  assert.equal(Object.keys(board.items).length, 3);
});

test('#8 사용자 입력(local)은 동기화가 덮어쓰지 않음', () => {
  let { board } = M.applySync(M.emptyBoard(), [todo('message:1#0', 'A')], NOW);
  M.edit(board, 'c:message:1', { priority: 'high', due: '2026-11-03', note: '자료 요청' }, NOW);
  ({ board } = M.applySync(board, [todo('message:1#0', 'A', { snippet: '새 내용' })], NOW));
  assert.deepEqual(board.items['c:message:1'].local, { priority: 'high', due: '2026-11-03', note: '자료 요청' });
  assert.throws(() => M.edit(board, 'c:message:1', { priority: 'urgent' }, NOW), /bad priority/);
  assert.throws(() => M.edit(board, 'c:message:1', { due: '11/3' }, NOW), /bad due/);
});

test('#7 숨기기 → 복원은 원래 열로, 영구삭제 카드는 재생성 안 됨', () => {
  let { board } = M.applySync(M.emptyBoard(), [todo('message:1#0', 'A')], NOW);
  M.move(board, 'c:message:1', 'doing', NOW);
  M.hide(board, 'c:message:1', NOW);
  assert.equal(board.items['c:message:1'].column, 'hidden');
  M.restore(board, 'c:message:1', NOW);
  assert.equal(board.items['c:message:1'].column, 'doing');
  assert.throws(() => M.purge(board, 'c:message:1', NOW), /hide first/);
  M.hide(board, 'c:message:1', NOW); M.purge(board, 'c:message:1', NOW);
  ({ board } = M.applySync(board, [todo('message:1#0', 'A')], NOW));
  assert.equal(board.items['c:message:1'], undefined);
});

test('#7 Done 30일 경과 자동 보관, 보관 복원은 Done', () => {
  const b = M.emptyBoard();
  M.add(b, { title: '옛일' }, '2026-09-01T00:00:00.000Z');
  const id = Object.keys(b.items)[0];
  M.move(b, id, 'done', '2026-09-10T00:00:00.000Z');
  const { board, archived } = M.applySync(b, [], NOW);
  assert.equal(archived, 1);
  assert.equal(board.items[id].column, 'archived');
  M.restore(board, id, NOW);
  assert.equal(board.items[id].column, 'done');
});

test('move: 허용 열 검증, done 해제 시 doneAt 삭제', () => {
  const b = M.emptyBoard(); M.add(b, { title: 'x' }, NOW); const id = Object.keys(b.items)[0];
  assert.throws(() => M.move(b, id, 'hidden', NOW), /bad column/);
  M.move(b, id, 'done', NOW); assert.ok(b.items[id].doneAt);
  M.move(b, id, 'doing', NOW); assert.equal(b.items[id].doneAt, undefined);
});

test('동기화 실패 기록은 보드를 유지', () => {
  let { board } = M.applySync(M.emptyBoard(), [todo('message:1#0', 'A')], NOW);
  board = M.recordSyncError(board, 'MCP HTTP 500', NOW);
  assert.equal(board.lastError.message, 'MCP HTTP 500');
  assert.equal(Object.keys(board.items).length, 1);
});
