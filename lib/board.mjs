// 보드 저장소: Vercel Blob 고정 경로 1파일 + ETag 조건부 쓰기 (#2 #3)
// - 읽기: get(useCache:false) → Simple Operation (list 없음)
// - 쓰기: put(ifMatch) → Advanced Operation 1회, 다른 요청이 먼저 썼으면 최신 보드로 다시 적용
import crypto from 'node:crypto';
import * as blob from '@vercel/blob';
import { emptyBoard, migrate } from './model.mjs';

const secret = () => process.env.BOARD_KEY || '';
const prefix = () => 'board/' + crypto.createHash('sha256').update('path:' + secret()).digest('hex').slice(0, 24) + '/';
export const boardPath = () => prefix() + 'board.bin';
const aesKey = () => crypto.createHash('sha256').update('enc:' + secret()).digest();

export class DecryptError extends Error {}

export function enc(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', aesKey(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]);
}
export function dec(buf) {
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', aesKey(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
  } catch {
    throw new DecryptError('보드 복호화 실패 — BOARD_KEY 가 저장 당시와 다를 수 있음');
  }
}

const isConflict = (e) => e instanceof (blob.BlobPreconditionFailedError || class {}) || /precondition|already exists|412|409/i.test(String(e?.message || e));

export function createStore(api = blob, { retries = 5, fetchImpl = (...a) => fetch(...a) } = {}) {
  async function read() {
    const r = await api.get(boardPath(), { access: 'public', useCache: false });
    if (r && r.statusCode !== 404 && r.stream) {
      const buf = Buffer.from(await new Response(r.stream).arrayBuffer());
      return { board: migrate(dec(buf)), etag: r.blob.etag };
    }
    // v1 이관: 타임스탬프 파일 중 최신 1개 (고정 파일이 생기면 더 이상 list 하지 않음, 옛 파일은 롤백용으로 보존)
    const { blobs } = await api.list({ prefix: prefix(), limit: 1000 });
    const old = blobs.filter((x) => /\/\d{15}\.bin$/.test(x.pathname)).sort((a, b) => (a.pathname < b.pathname ? 1 : -1));
    if (!old.length) return { board: emptyBoard(), etag: null };
    const res = await fetchImpl(old[0].url, { cache: 'no-store' });
    return { board: migrate(dec(Buffer.from(await res.arrayBuffer()))), etag: null };
  }

  async function write(board, etag) {
    const opts = { access: 'public', addRandomSuffix: false, contentType: 'application/octet-stream', cacheControlMaxAge: 60 };
    if (etag) opts.ifMatch = etag; else opts.allowOverwrite = false;
    await api.put(boardPath(), enc(board), opts);
  }

  async function load() { return (await read()).board; }

  // fn(board) 가 board 를 직접 수정. 충돌 시 최신 보드로 fn 을 다시 적용
  async function mutate(fn) {
    let last;
    for (let i = 0; i < retries; i++) {
      const { board, etag } = await read();
      const out = await fn(board);
      board.rev = (board.rev || 0) + 1;
      board.updatedAt = new Date().toISOString();
      try { await write(board, etag); return { board, out }; }
      catch (e) { if (!isConflict(e)) throw e; last = e; await new Promise((r) => setTimeout(r, 50 + Math.random() * 150 * (i + 1))); }
    }
    throw new Error('동시 저장 충돌이 계속됨 — 잠시 후 다시 시도: ' + (last?.message || ''));
  }
  return { load, mutate };
}