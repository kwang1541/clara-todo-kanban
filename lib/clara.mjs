// 클라라(ai.cands.kr) MCP 클라이언트 + 내 할일 추출
// MCP Streamable HTTP: initialize -> notifications/initialized -> tools/call (Mcp-Session-Id 유지, SSE data: 라인 응답)

import { keyOf } from './model.mjs';

const DEFAULT_URL = 'https://ai.cands.kr/mcp/';

export function makeClient({ url = DEFAULT_URL, key }) {
  let sid = null;
  let seq = 1;
  async function rpc(method, params, notify = false) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: key.startsWith('Bearer ') ? key : `Bearer ${key}`,
    };
    if (sid) headers['Mcp-Session-Id'] = sid;
    const body = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: seq++, method, params };
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const s = r.headers.get('mcp-session-id');
    if (s) sid = s;
    if (notify) return null;
    const t = await r.text();
    if (!r.ok) throw new Error(`MCP ${method} HTTP ${r.status}: ${t.slice(0, 200)}`);
    const line = t.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() || t;
    const j = JSON.parse(line);
    if (j.error) throw new Error(`MCP ${method} error: ${JSON.stringify(j.error).slice(0, 200)}`);
    return j.result;
  }
  async function init() {
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'clara-todo-kanban', version: '1.0' } });
    await rpc('notifications/initialized', {}, true);
  }
  async function call(name, args) {
    const res = await rpc('tools/call', { name, arguments: args });
    const text = (res?.content || []).map((c) => c.text).join('\n');
    try { return JSON.parse(text); } catch { return text; }
  }
  return { init, call };
}

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

// 내 할일 = 최근 N일 안에 다른 사람이 나(@이름)를 지목한 노트/메시지
export async function fetchTodos({ key, url, me = '김광훈', days = 60, max = 300, now = Date.now() }) {
  const c = makeClient({ url, key });
  await c.init();
  const since = new Date(now - days * 864e5).toISOString().slice(0, 10);
  const years = [...new Set([new Date(now).getFullYear(), new Date(now - days * 864e5).getFullYear()])];
  const mention = new RegExp(`@\\s*@?\\s*${me}`);
  const byKey = new Map();
  for (const year of years) {
    for (let offset = 0; offset < max; offset += 100) {
      const r = await c.call('search', { q: `@${me}`, year, profile: 'fresh', k: 100, offset });
      const hits = r?.results || [];
      for (const h of hits) {
        if (!h.date || h.date < since) continue;
        const text = `${h.title || ''} ${h.snippet || ''}`;
        if (!mention.test(text)) continue;
        const leads = (h.leads || []).filter((x) => x && x !== 'undefined');
        if (leads.includes(me)) continue; // 내가 쓴 글은 제외
        const title = norm(h.title);
        const k = keyOf({ docId: h.id, url: h.url, title }); // 문서 단위 키 (#4)
        const prev = byKey.get(k);
        const item = {
          id: k,
          docId: h.id,
          title,
          from: leads.join(', ') || (prev?.from ?? ''),
          date: h.date,
          map: h.map || '',
          snippet: norm(h.snippet).slice(0, 400),
          url: h.url || '',
          sourceUrl: h.source_url || h.origin_url || '',
        };
        if (!prev || (item.from && !prev.from) || item.date > prev.date) byKey.set(k, { ...prev, ...item, from: item.from || prev?.from || '' });
      }
      if (!r?.has_more || hits.length === 0) break;
    }
  }
  return [...byKey.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}
