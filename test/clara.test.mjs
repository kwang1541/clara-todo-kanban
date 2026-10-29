import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchTodos } from '../lib/clara.mjs';

test('fetchTodos: 60일·멘션·본인 제외·문서 단위 중복 제거', async () => {
  const now = Date.parse('2026-10-29T00:00:00Z');
  const results = [
    { id: 'message:1#0', title: '수율 보고', snippet: '@김광훈 확인 부탁', date: '2026-10-20', leads: ['이한옥'] },
    { id: 'message:1#1', title: '수율 보고', snippet: '@김광훈 2페이지', date: '2026-10-20', leads: [] },
    { id: 'message:2#0', title: '수율 보고', snippet: '@김광훈 다른 문서', date: '2026-10-21', leads: ['한상기'] },
    { id: 'message:3#0', title: '내 글', snippet: '@김광훈', date: '2026-10-21', leads: ['김광훈'] },
    { id: 'message:4#0', title: '옛 글', snippet: '@김광훈', date: '2026-07-01', leads: ['이한옥'] },
    { id: 'message:5#0', title: '멘션 없음', snippet: '김광훈 과장', date: '2026-10-21', leads: ['이한옥'] },
  ];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, o) => {
    const body = JSON.parse(o.body);
    const sse = (result) => new Response('event: message\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: body.id ?? 0, result }) + '\n', { headers: { 'mcp-session-id': 's1' } });
    if (body.method === 'tools/call') {
      const r = body.params.arguments.year === 2026 ? { results, has_more: false } : { results: [], has_more: false };
      return sse({ content: [{ type: 'text', text: JSON.stringify(r) }] });
    }
    return sse({});
  };
  try {
    const todos = await fetchTodos({ key: 'k', now });
    assert.deepEqual(todos.map((t) => t.id).sort(), ['c:message:1', 'c:message:2']);
    assert.equal(todos.find((t) => t.id === 'c:message:1').from, '이한옥');
  } finally { globalThis.fetch = orig; }
});
