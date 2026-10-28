import { getStore } from '@netlify/blobs';
import { fetchTodos } from './clara.mjs';

export const COLUMNS = ['todo', 'doing', 'done'];
const KEY = 'board';

export function store() {
  return getStore({ name: 'clara-kanban', consistency: 'strong' });
}

export async function loadBoard() {
  const b = await store().get(KEY, { type: 'json' });
  return b || { items: {}, lastSync: null, lastSyncCount: 0, lastError: null, history: [] };
}

export async function saveBoard(b) {
  await store().setJSON(KEY, b);
  return b;
}

export async function syncBoard(trigger = 'schedule') {
  const b = await loadBoard();
  const now = new Date().toISOString();
  try {
    const key = process.env.CLARA_KEY;
    if (!key) throw new Error('CLARA_KEY 환경변수 없음');
    const todos = await fetchTodos({ key, url: process.env.CLARA_URL, me: process.env.CLARA_ME || '김광훈', days: Number(process.env.CLARA_DAYS || 60) });
    let added = 0;
    for (const t of todos) {
      const prev = b.items[t.id];
      if (prev) b.items[t.id] = { ...prev, ...t, column: prev.column, movedAt: prev.movedAt, source: 'clara' };
      else { b.items[t.id] = { ...t, column: 'todo', source: 'clara', createdAt: now, movedAt: now }; added++; }
    }
    b.lastSync = now; b.lastSyncCount = todos.length; b.lastError = null;
    b.history = [{ at: now, trigger, fetched: todos.length, added }, ...(b.history || [])].slice(0, 48);
  } catch (e) {
    b.lastError = { at: now, message: String(e.message || e).slice(0, 300) };
    b.history = [{ at: now, trigger, error: b.lastError.message }, ...(b.history || [])].slice(0, 48);
  }
  return saveBoard(b);
}
