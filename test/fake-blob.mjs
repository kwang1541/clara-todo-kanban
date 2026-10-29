// 테스트용 메모리 Blob — 실제 Blob 처럼: head 는 최신 메타데이터, 없으면 BlobNotFoundError, ETag 조건부 쓰기
const ORIGIN = 'https://fake.public.blob.vercel-storage.com';
export function fakeBlob() {
  const files = new Map(); let n = 0; const ops = { head: 0, put: 0, list: 0, del: 0 };
  const nf = () => Object.assign(new Error('Vercel Blob: The requested blob does not exist'), { name: 'BlobNotFoundError' });
  const api = {
    files, ops,
    async head(path) { ops.head++; const f = files.get(path); if (!f) throw nf(); return { etag: f.etag, contentType: f.contentType, url: ORIGIN + '/' + path, pathname: path }; },
    async put(path, data, o = {}) {
      ops.put++; const f = files.get(path);
      if (o.ifMatch && (!f || f.etag !== o.ifMatch)) throw Object.assign(new Error('Vercel Blob: Precondition failed: ETag mismatch.'), { name: 'BlobPreconditionFailedError' });
      if (!o.ifMatch && f && !o.allowOverwrite) throw new Error('Vercel Blob: This blob already exists');
      files.set(path, { data: Buffer.from(data), etag: '"e' + ++n + '"', contentType: o.contentType || '' });
      return { url: ORIGIN + '/' + path, etag: '"e' + n + '"' };
    },
    async del(urls) { ops.del++; for (const u of [].concat(urls)) files.delete(u.startsWith(ORIGIN) ? u.slice(ORIGIN.length + 1) : u); },
    async list({ prefix }) { ops.list++; return { blobs: [...files.keys()].filter((p) => p.startsWith(prefix)).map((pathname) => ({ pathname, url: ORIGIN + '/' + pathname })) }; },
    fetch: async (url) => { const f = files.get(url.slice(ORIGIN.length + 1)); return f ? new Response(f.data) : new Response('nf', { status: 404 }); },
  };
  return api;
}