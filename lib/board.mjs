// 보드 저장소 (Vercel Blob) — list 없이 항상 최신을 읽고, 동시 쓰기는 조건부 갱신 (#2 #3)
//
// Blob 공개 URL 은 CDN 이 최소 60초 캐시하고(쿼리스트링 무시), get(useCache:false)도 오래된 내용을 줄 수 있음.
// 그래서 내용은 "버전마다 새 파일"(처음 보는 URL → 항상 최신)로 쓰고,
// 어느 파일이 최신인지는 고정 포인터 파일의 메타데이터(head = API 조회, 항상 최신)에 기록한다.
//   읽기: head(pointer) → contentType 의 d=<버전> → v/<버전>.bin 다운로드   (Simple Op)
//   쓰기: put(v/<새 버전>.bin) → put(pointer, ifMatch=읽을 때 ETag)            (Advanced Op 2)
//         ETag 가 바뀌었으면(다른 요청이 먼저 씀) 새 파일 삭제 후 최신 보드로 다시 적용
//   정리: 이전 버전 파일 삭제 (삭제는 무료)
import crypto from 'node:crypto';
import * as blob from '@vercel/blob';
import { emptyBoard, migrate } from './model.mjs';

const secret = () => process.env.BOARD_KEY || '';
const prefix = () => 'board/' + crypto.createHash('sha256').update('path:' + secret()).digest('hex').slice(0, 24) + '/';
export const pointerPath = () => prefix() + 'head';
export const dataPath = (ver) => prefix() + 'v/' + ver + '.bin';
const legacyFixed = () => prefix() + 'board.bin'; // v1.2 초기 배포본(고정 경로) — 읽기 전용 이관 대상
const aesKey = () => crypto.createHash('sha256').update('enc:' + secret()).digest();
const CT = 'application/x-kanban-pointer; d=';

export class DecryptError extends Error {}
export const SKIP = Symbol('skip-write');

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

const notFound = (e) => e?.name === 'BlobNotFoundError' || /not found|does not exist/i.test(String(e?.message || e));
const isConflict = (e) => e?.name === 'BlobPreconditionFailedError' || /precondition|etag mismatch|already exists/i.test(String(e?.message || e));
const strong = (etag) => String(etag || '').replace(/^W\//, '') || null;
const newVersion = () => String(Date.now()).padStart(15, '0') + '-' + crypto.randomBytes(4).toString('hex');

export function createStore(api = blob, { retries = 5, fetchImpl = (...a) => fetch(...a) } = {}) {
  const headOrNull = async (p) => { try { return await api.head(p); } catch (e) { if (notFound(e)) return null; throw e; } };
  const urlOf = (h, p) => new URL(h.url).origin + '/' + p;
  const download = async (url) => {
    const r = await fetchImpl(url, { cache: 'no-store' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('Blob 다운로드 실패 HTTP ' + r.status);
    return Buffer.from(await r.arrayBuffer());
  };

  async function read() {
    for (let i = 0; i < 4; i++) {
      const h = await headOrNull(pointerPath());
      if (!h) break;
      const ver = String(h.contentType || '').split('d=')[1];
      const buf = ver && (await download(urlOf(h, dataPath(ver))));
      if (buf) return { board: migrate(dec(buf)), etag: strong(h.etag), ver };
      await new Promise((r) => setTimeout(r, 150)); // 다른 요청이 막 교체·정리한 경우 재조회
    }
    // 이관 1: v1.2 초기 고정 경로 파일
    const lf = await headOrNull(legacyFixed());
    if (lf) { const buf = await download(lf.url); if (buf) return { board: migrate(dec(buf)), etag: null, ver: null }; }
    // 이관 2: v1 타임스탬프 파일 중 최신 (list 는 포인터가 생기기 전까지만)
    const { blobs } = await api.list({ prefix: prefix(), limit: 1000 });
    const old = blobs.filter((x) => /\/\d{15}\.bin$/.test(x.pathname)).sort((a, b) => (a.pathname < b.pathname ? 1 : -1));
    if (!old.length) return { board: emptyBoard(), etag: null, ver: null };
    const buf = await download(old[0].url);
    return { board: buf ? migrate(dec(buf)) : emptyBoard(), etag: null, ver: null };
  }

  async function write(board, etag, prevVer) {
    const ver = newVersion();
    await api.put(dataPath(ver), enc(board), { access: 'public', addRandomSuffix: false, contentType: 'application/octet-stream' });
    const opts = { access: 'public', addRandomSuffix: false, contentType: CT + ver, cacheControlMaxAge: 60 };
    if (etag) opts.ifMatch = etag; else opts.allowOverwrite = false;
    try {
      await api.put(pointerPath(), ver, opts); // 내용이 매번 달라 ETag 도 매번 바뀜
    } catch (e) {
      await api.del([dataPath(ver)]).catch(() => {});
      throw e;
    }
    if (prevVer && prevVer !== ver) await api.del([dataPath(prevVer)]).catch(() => {});
  }

  async function load() { return (await read()).board; }

  // fn(board) 가 board 를 직접 수정. SKIP 을 돌려주면 저장 생략. 충돌 시 최신 보드로 fn 을 다시 적용
  async function mutate(fn) {
    let last;
    for (let i = 0; i < retries; i++) {
      const { board, etag, ver } = await read();
      const out = await fn(board);
      if (out === SKIP) return { board, out, skipped: true };
      board.rev = (board.rev || 0) + 1;
      board.updatedAt = new Date().toISOString();
      try { await write(board, etag, ver); return { board, out }; }
      catch (e) { if (!isConflict(e)) throw e; last = e; await new Promise((r) => setTimeout(r, 50 + Math.random() * 150 * (i + 1))); }
    }
    throw new Error('동시 저장 충돌이 계속됨 — 잠시 후 다시 시도: ' + (last?.message || ''));
  }
  return { load, mutate };
}
