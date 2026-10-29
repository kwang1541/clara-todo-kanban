// 보드 도메인 로직 (순수 함수, 저장소·네트워크 무관) — 단위테스트 대상
export const COLUMNS = ['todo', 'doing', 'done'];
export const SCHEMA = 2;
export const ARCHIVE_DAYS = 30;
const PRIORITIES = ['high', 'mid', 'low', ''];

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const emptyBoard = () => ({ schema: SCHEMA, items: {}, purged: {}, lastSync: null, lastSyncCount: 0, lastError: null, history: [] });

// 카드 키: 클라라 문서 ID(청크 번호 제거) → URL → 제목 순 폴백 (#4)
export function keyOf(t) {
  const doc = String(t.docId || '').split('#')[0].trim();
  if (doc) return 'c:' + doc;
  if (t.url) return 'u:' + t.url;
  return 't:' + String(t.title || '').trim();
}

const isNewKey = (k) => /^(c|u|t|m):/.test(k);
const ts = (iso) => (iso ? Date.parse(iso) || 0 : 0);

// v1(제목 키) → v2(문서 키) 1회 이관. 열 위치·이동 시각·완료 시각·사용자 입력 유지
export function migrate(board) {
  const b = { ...emptyBoard(), ...board, schema: board.schema || 1, items: { ...(board.items || {}) }, purged: { ...(board.purged || {}) } };
  if (b.schema === SCHEMA) return b;
  const next = {};
  for (const [k, it] of Object.entries(b.items)) {
    let nk = k;
    if (!isNewKey(k)) nk = it.source === 'manual' ? 'm:' + k.replace(/^m:/, '') : keyOf(it);
    const cur = next[nk];
    if (!cur || ts(it.movedAt) > ts(cur.movedAt)) next[nk] = { ...it, id: nk };
  }
  b.items = next;
  b.schema = SCHEMA;
  return b;
}

// 동기화 병합: 기존 카드 열·사용자 입력 유지, 신규는 todo, 영구삭제한 카드는 다시 만들지 않음, Done 30일 경과 자동 보관 (#3 #4 #7)
export function applySync(board, todos, now, trigger = 'schedule') {
  const b = migrate(board);
  let added = 0;
  for (const raw of todos) {
    const t = { ...raw, id: raw.id && isNewKey(raw.id) ? raw.id : keyOf(raw) };
    if (b.purged[t.id]) continue;
    const prev = b.items[t.id];
    if (prev) {
      b.items[t.id] = { ...prev, ...t, column: prev.column, movedAt: prev.movedAt, createdAt: prev.createdAt || now, local: prev.local, source: 'clara', lastSeenAt: now };
      if (prev.doneAt) b.items[t.id].doneAt = prev.doneAt;
    } else {
      b.items[t.id] = { ...t, column: 'todo', source: 'clara', createdAt: now, movedAt: now, lastSeenAt: now };
      added++;
    }
  }
  const archived = autoArchive(b, now);
  b.lastSync = now; b.lastSyncCount = todos.length; b.lastError = null;
  b.history = [{ at: now, trigger, fetched: todos.length, added, archived }, ...(b.history || [])].slice(0, 48);
  return { board: b, added, archived };
}

export function recordSyncError(board, message, now, trigger = 'schedule') {
  const b = migrate(board);
  b.lastError = { at: now, message: String(message).slice(0, 300) };
  b.history = [{ at: now, trigger, error: b.lastError.message }, ...(b.history || [])].slice(0, 48);
  return b;
}

export function autoArchive(b, now, days = ARCHIVE_DAYS) {
  let n = 0;
  const limit = ts(now) - days * 864e5;
  for (const it of Object.values(b.items)) {
    if (it.column === 'done' && it.doneAt && ts(it.doneAt) < limit) { it.column = 'archived'; it.archivedAt = now; n++; }
  }
  return n;
}

const need = (b, id) => { const it = b.items[id]; if (!it) throw new HttpError(404, 'not found'); return it; };

export function move(b, id, column, now) {
  const it = need(b, id);
  if (!COLUMNS.includes(column)) throw new HttpError(400, 'bad column');
  it.column = column; it.movedAt = now;
  if (column === 'done') it.doneAt = now; else delete it.doneAt;
  delete it.archivedAt; delete it.hiddenFrom;
  return it;
}

export function add(b, body, now) {
  const title = String(body.title || '').trim().slice(0, 200);
  if (!title) throw new HttpError(400, 'title required');
  let id = 'm:' + Date.parse(now).toString(36);
  while (b.items[id]) id += '_';
  b.items[id] = { id, title, from: '직접 추가', date: now.slice(0, 10), column: 'todo', source: 'manual', createdAt: now, movedAt: now, snippet: '' };
  if (body.note || body.priority || body.due) edit(b, id, body, now);
  return b.items[id];
}

// 숨기기: 원래 열을 기억해 복원 가능 (#7)
export function hide(b, id, now) {
  const it = need(b, id);
  if (it.column === 'hidden') return it;
  it.hiddenFrom = it.column === 'archived' ? 'done' : it.column;
  it.column = 'hidden'; it.hiddenAt = now;
  return it;
}

export function restore(b, id, now) {
  const it = need(b, id);
  if (it.column === 'hidden') it.column = COLUMNS.includes(it.hiddenFrom) ? it.hiddenFrom : 'todo';
  else if (it.column === 'archived') it.column = 'done';
  else return it;
  delete it.hiddenFrom; delete it.hiddenAt; delete it.archivedAt;
  if (it.column === 'done' && !it.doneAt) it.doneAt = now;
  it.movedAt = now;
  return it;
}

// 영구삭제: 숨김·보관 카드만. 클라라 카드는 다음 동기화에 다시 생기지 않도록 기록
export function purge(b, id, now) {
  const it = need(b, id);
  if (!['hidden', 'archived'].includes(it.column)) throw new HttpError(400, 'hide first');
  if (it.source === 'clara') {
    b.purged = { ...(b.purged || {}), [id]: now };
    const keys = Object.keys(b.purged);
    if (keys.length > 500) for (const k of keys.sort((x, y) => (b.purged[x] < b.purged[y] ? -1 : 1)).slice(0, keys.length - 500)) delete b.purged[k];
  }
  delete b.items[id];
}

// 사용자 입력(우선순위·마감일·메모)은 local 에 보관 → 클라라 동기화가 덮어쓰지 않음 (#8)
export function edit(b, id, body, now) {
  const it = need(b, id);
  const local = { ...(it.local || {}) };
  if ('priority' in body) { if (!PRIORITIES.includes(body.priority)) throw new HttpError(400, 'bad priority'); local.priority = body.priority; }
  if ('due' in body) { const d = String(body.due || ''); if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new HttpError(400, 'bad due'); local.due = d; }
  if ('note' in body) local.note = String(body.note || '').slice(0, 1000);
  for (const k of Object.keys(local)) if (local[k] === '') delete local[k];
  it.local = local;
  if (it.source === 'manual' && body.title) it.title = String(body.title).trim().slice(0, 200) || it.title;
  it.editedAt = now;
  return it;
}
