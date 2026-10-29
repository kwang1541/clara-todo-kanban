// 최소 빌드: 빌드 시각을 화면에 찍고 함수 모듈 import 점검
import fs from 'fs';
const stamp = new Date().toISOString();
const f = 'public/index.html';
fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/data-build="[^"]*"/, `data-build="${stamp}"`));
for (const m of ['../lib/model.mjs', '../lib/clara.mjs', '../lib/board.mjs', '../api/[action].mjs']) await import(m);
console.log('build ok', stamp);