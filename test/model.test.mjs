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

test('#4 같은 제목이라도 날짜가 다른 문서는 카드 2장', () => {
  const { board, added } = M.applySync(M.emptyBoard(), [todo('message:1#0', '주간업무보고'), todo('message:2#0', '주간업무보고', { date: '2026-10-27' })], NOW);
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

test('#4 보완: 같은 제목·같은 날짜 중복 게시는 1장, 작성자 보강', () => {
  const { board, added } = M.applySync(M.emptyBoard(), [todo('message:101#0', '수율 규칙', { from: '' }), todo('message:102#0', '수율 규칙')], NOW);
  assert.equal(added, 1);
  const arr = Object.values(board.items);
  assert.equal(arr.length, 1);
  assert.equal(arr[0].from, '이한옥');
  assert.equal(board.lastSyncCount, 1);
});

test('#4 보완: 이미 생긴 중복 카드는 손대지 않았으면 정리, 진행 중 카드는 대표로 유지', () => {
  let { board } = M.applySync(M.emptyBoard(), [todo('message:102#0', '수율 규칙')], NOW);
  M.move(board, 'c:message:102', 'doing', NOW);
  // v1.2 초기 배포에서 생긴 중복 카드 흉내
  board.items['c:message:101'] = { id: 'c:message:101', title: '수율 규칙', date: '2026-10-20', column: 'todo', source: 'clara', createdAt: NOW, movedAt: NOW };
  board.items['c:message:201'] = { id: 'c:message:201', title: '다른 일', date: '2026-10-20', column: 'todo', source: 'clara', createdAt: NOW, movedAt: NOW, local: { note: '메모' } };
  ({ board } = M.applySync(board, [todo('message:101#0', '수율 규칙', { from: '' }), todo('message:102#0', '수율 규칙'), todo('message:201#0', '다른 일'), todo('message:202#0', '다른 일')], '2026-10-29T03:00:00.000Z'));
  assert.equal(board.items['c:message:101'], undefined, '손대지 않은 중복은 정리');
  assert.equal(board.items['c:message:102'].column, 'doing');
  assert.ok(board.items['c:message:201'], '메모가 있는 카드는 대표로 유지');
  assert.equal(board.items['c:message:202'], undefined);
  assert.equal(Object.keys(board.items).length, 2);
});