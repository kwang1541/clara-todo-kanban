// 테스트용 메모리 Blob (get/put/list + ETag 조건부 쓰기 흉내)
export function fakeBlob() {
  const files = new Map(); let n = 0; const ops = { get: 0, put: 0, list: 0 };
  const api = {
    files, ops,
    async get(path) { ops.get++; const f = files.get(path); if (!f) return null; return { statusCode: 200, stream: new Blob([f.data]).stream(), blob: { etag: f.etag } }; },
    async put(path, data, o = {}) {
      ops.put++; const f = files.get(path);
      if (o.ifMatch && (!f || f.etag !== o.ifMatch)) throw new Error('Precondition failed');
      if (!o.ifMatch && f && !o.allowOverwrite) throw new Error('This blob already exists');
      files.set(path, { data: Buffer.from(data), etag: '"e' + ++n + '"', url: 'mem://' + path });
      return { url: 'mem://' + path };
    },
    async list({ prefix }) { ops.list++; return { blobs: [...files.entries()].filter(([p]) => p.startsWith(prefix)).map(([pathname, f]) => ({ pathname, url: f.url })) }; },
    fetch: async (url) => { const f = [...files.values()].find((x) => x.url === url); return new Response(f.data); },
  };
  return api;
}
