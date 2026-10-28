import crypto from 'node:crypto';
import { put, list, del } from '@vercel/blob';
import { fetchTodos } from './clara.mjs';

export const COLUMNS = ['todo', 'doing', 'done'];
const secret = () => process.env.BOARD_KEY || '';
const prefix = () => 'board/' + crypto.createHash('sha256').update('path:' + secret()).digest('hex').slice(0, 24) + '/';
const aesKey = () => crypto.createHash('sha256').update('enc:' + secret()).digest();

function enc(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', aesKey(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]);
}
function dec(buf) {
  const d = crypto.createDecipheriv('aes-256-gcm', aesKey(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
}

// 저장할 때마다 새 파일(타임스탬프) → 읽을 땐 list 로 최신 1개 (CDN 캐시 영향 없음)
async function blobs() {
  const { blobs } = await list({ prefix: prefix(), limit: 1000 });
  return blobs.sort((a, b) => (a.pathname < b.pathname ? 1 : -1));
}

export async function loadBoard() {
  const bs = await blobs();
  if (!bs.length) return { items: {}, lastSync: null, lastSyncCount: 0, lastError: null, history: [] };
  const r = await fetch(bs[0].url, { cache: 'no-store' });
  return dec(Buffer.from(await r.arrayBuffer()));
}

export async function saveBoard(b) {
  const name = prefix() + String(Date.now()).padStart(15, '0') + '.bin';
  await put(name, enc(b), { access: 'public', addRandomSuffix: false, contentType: 'application/octet-stream' });
  const old = (await blobs()).slice(5).map((x) => x.url);
  if (old.length) await del(old).catch(() => {});
  return b;
}

export async function syncBoard(trigger = 'schedule') {
  const b = await loadBoard();
  const now = new Date().toISOString();
  try {
    const key = process.env.CLARA_KEY;
    if (!key) throw new Error('CLARA_KEY 환경변수 없음');
    const todos = await fetchTodos({ key, url: process.env.CLARA_URL || undefined, me: process.env.CLARA_ME || '김광훈', days: Number(process.env.CLARA_DAYS || 60) });
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
