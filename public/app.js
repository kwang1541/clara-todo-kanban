'use strict';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let KEY = localStorage.getItem('kanbanKey') || '';
let board = null;
let lastFetch = 0;
const NEXT = { todo: ['doing'], doing: ['todo', 'done'], done: ['doing'] };
const LABEL = { todo: '← Todo', doing: 'Doing', done: 'Done →' };
const PRI = { high: '상', mid: '중', low: '하' };
const PRANK = { high: 0, mid: 1, low: 2 };
const WIP = 5;
const DAY = 864e5;
const view = JSON.parse(localStorage.getItem('kanbanView') || '{}');

// ---------- API ----------
async function api(path, body) {
  let r;
  try {
    r = await fetch('/api/' + path, { method: body ? 'POST' : 'GET', headers: { 'x-board-key': KEY, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  } catch { throw new Error('네트워크 오류'); }
  if (r.status === 401) { showLogin('키가 맞지 않습니다'); throw new Error('unauthorized'); }
  const j = await r.json().catch(() => ({}));
  if (j && j.items) { board = j; lastFetch = Date.now(); } // 502(동기화 실패)여도 보드는 반영 (#5)
  if (!r.ok) throw new Error(j.lastError?.message || j.error || 'HTTP ' + r.status);
  return j;
}

// ---------- 토스트 ----------
let toastTimer;
function toast(msg, { bad = false, action, onAction, ms = 4000 } = {}) {
  const t = $('#toast');
  $('#toastMsg').textContent = msg;
  t.classList.toggle('bad', bad);
  const b = $('#toastAct');
  b.hidden = !action;
  if (action) { b.textContent = action; b.onclick = () => { t.hidden = true; onAction(); }; }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

// ---------- 공통 ----------
function showLogin(msg) { $('#app').hidden = true; $('#login').hidden = false; $('#lerr').textContent = msg || ''; }
function fmt(iso) { if (!iso) return '-'; return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
const kstDate = (d = new Date()) => new Date(d.getTime() + 9 * 36e5).toISOString().slice(0, 10);
const days = (iso) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / DAY) : 0);
function dueInfo(due) {
  if (!due) return null;
  const d = Math.round((Date.parse(due) - Date.parse(kstDate())) / DAY);
  if (d < 0) return { txt: `마감 ${-d}일 초과`, cls: 'late' };
  if (d === 0) return { txt: '오늘 마감', cls: 'late' };
  if (d <= 2) return { txt: `D-${d}`, cls: 'soon' };
  return { txt: `마감 ${due.slice(5).replace('-', '/')}`, cls: '' };
}
const items = () => Object.values(board.items || {});

// 동기화가 오래됐으면 배너 (KST 07~22시 운영 시간 기준 3시간) (#5)
function banner() {
  const el = $('#banner');
  const msgs = [];
  const h = new Date(Date.now() + 9 * 36e5).getUTCHours();
  if (board.lastSync && h >= 8 && h <= 22 && Date.now() - Date.parse(board.lastSync) > 3 * 36e5) msgs.push(`마지막 동기화가 ${Math.floor((Date.now() - Date.parse(board.lastSync)) / 36e5)}시간 전입니다. GitHub Actions(sync) 상태를 확인하세요.`);
  if (board.lastError && (!board.lastSync || board.lastError.at > board.lastSync)) msgs.push(`최근 동기화 실패 ${fmt(board.lastError.at)}: ${board.lastError.message}`);
  el.hidden = !msgs.length;
  el.textContent = msgs.join(' / ');
}

function filterOpts() {
  const froms = [...new Set(items().filter((i) => !['hidden', 'archived'].includes(i.column)).map((i) => i.from).filter(Boolean))].sort();
  const sel = $('#fFrom');
  const cur = view.from || '';
  sel.innerHTML = '<option value="">요청자 전체</option>' + froms.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
  sel.value = froms.includes(cur) ? cur : '';
}

function match(i) {
  const L = i.local || {};
  if (view.from && i.from !== view.from) return false;
  if (view.src && i.source !== view.src) return false;
  if (view.pri && (view.pri === 'none' ? L.priority : L.priority !== view.pri)) return false;
  const q = (view.q || '').trim().toLowerCase();
  if (q && !`${i.title} ${i.from} ${i.snippet} ${i.map} ${L.note || ''}`.toLowerCase().includes(q)) return false;
  return true;
}

function sorter(col) {
  if (view.sort === 'priority') return (a, b) => (PRANK[a.local?.priority] ?? 9) - (PRANK[b.local?.priority] ?? 9) || (b.date || '').localeCompare(a.date || '');
  if (view.sort === 'due') return (a, b) => (a.local?.due || '9999').localeCompare(b.local?.due || '9999') || (b.date || '').localeCompare(a.date || '');
  return col === 'done' ? (a, b) => (b.doneAt || '').localeCompare(a.doneAt || '') : (a, b) => (b.date || '').localeCompare(a.date || '');
}

function cardHtml(i, col) {
  const L = i.local || {};
  const isNew = i.source === 'clara' && col === 'todo' && i.createdAt && Date.now() - Date.parse(i.createdAt) < 2 * 36e5;
  const expired = i.source === 'clara' && i.lastSeenAt && board.lastSync && i.lastSeenAt < board.lastSync && col !== 'done';
  const due = dueInfo(L.due);
  const stay = col !== 'done' ? days(i.movedAt) : 0;
  const cls = ['card', isNew ? 'new' : '', L.priority ? 'p-' + L.priority : ''].join(' ');
  return `<div class="${cls}" draggable="true" data-id="${esc(i.id)}">
  <div class="t">${esc(i.title)}</div>
  <div class="m"><span>${esc(i.date || '')}</span><span>${esc(i.from || '')}</span>${i.source === 'manual' ? '<span class="tag">직접</span>' : '<span class="tag">클라라</span>'}${L.priority ? `<span class="tag b-${L.priority}">${PRI[L.priority]}</span>` : ''}${due ? `<span class="${due.cls}">${esc(due.txt)}</span>` : ''}${stay >= 1 ? `<span title="이 열에 머문 기간">${col === 'todo' ? 'Todo' : 'Doing'} ${stay}일째</span>` : ''}${expired ? '<span class="tag exp" title="최근 동기화(최근 60일 검색)에 더 이상 나타나지 않음">기간 만료</span>' : ''}${i.doneAt ? `<span>완료 ${fmt(i.doneAt)}</span>` : ''}</div>
  ${L.note ? `<div class="note">${esc(L.note)}</div>` : ''}
  <div class="s">${esc(i.map ? '[' + i.map + ']\n' : '')}${esc(i.snippet || '')}</div>
  <div class="a">${NEXT[col].map((n) => `<button data-mv="${n}">${LABEL[n]}</button>`).join('')}<button data-edit>편집</button>${i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">클라라에서 열기</a>` : ''}<button data-del title="숨기기">×</button></div></div>`;
}

function render() {
  const all = items();
  const st = $('#status');
  st.innerHTML = `마지막 동기화 <b>${fmt(board.lastSync)}</b> · 클라라 ${board.lastSyncCount ?? 0}건 · 매일 07~22시 매시 자동` + (board.lastError && (!board.lastSync || board.lastError.at > board.lastSync) ? ` · <span class="err">동기화 오류</span>` : '');
  banner();
  const hid = all.filter((i) => i.column === 'hidden').length;
  const arc = all.filter((i) => i.column === 'archived').length;
  $('#hiddenBtn').textContent = `숨김함 ${hid}`;
  $('#archBtn').textContent = `보관함 ${arc}`;
  let shown = 0, total = 0;
  for (const col of ['todo', 'doing', 'done']) {
    const sec = document.querySelector(`.col[data-col=${col}]`);
    const inCol = all.filter((i) => i.column === col);
    const arr = inCol.filter(match).sort(sorter(col));
    total += inCol.length; shown += arr.length;
    const wip = col === 'doing' && inCol.length > WIP;
    sec.classList.toggle('wip', wip);
    sec.querySelector('.cnt').textContent = (arr.length !== inCol.length ? `${arr.length}/${inCol.length}건` : `${inCol.length}건`) + (wip ? ` · WIP ${WIP}건 초과` : '');
    sec.querySelector('.list').innerHTML = arr.map((i) => cardHtml(i, col)).join('');
  }
  $('#fCount').textContent = shown !== total ? `필터 결과 ${shown}/${total}건` : '';
}

async function load() {
  await api('board');
  $('#login').hidden = true; $('#app').hidden = false;
  filterOpts(); render();
}

// ---------- 카드 조작 ----------
async function move(id, column) {
  const it = board.items[id];
  const prev = { column: it.column, doneAt: it.doneAt };
  it.column = column; render();
  try { await api('move', { id, column }); render(); }
  catch (e) {
    // 실패 시 원위치 (#5)
    if (board.items[id]) Object.assign(board.items[id], prev);
    render(); toast('이동 실패: ' + e.message, { bad: true });
  }
}
async function act(path, body, okMsg, opt) {
  try { await api(path, body); filterOpts(); render(); if (okMsg) toast(okMsg, opt); }
  catch (e) { render(); toast('처리 실패: ' + e.message, { bad: true }); }
}
const hideCard = (id) => act('hide', { id }, '카드를 숨겼습니다', { action: '실행 취소', onAction: () => act('restore', { id }, '복원했습니다'), ms: 6000 });

let editing = null;
function openEdit(id) {
  const it = board.items[id]; editing = id;
  const f = $('#editForm').elements; const L = it.local || {};
  $('#editTitleRO').textContent = it.source === 'manual' ? '' : it.title;
  $('#titleWrap').hidden = it.source !== 'manual';
  f.title.value = it.title; f.priority.value = L.priority || ''; f.due.value = L.due || ''; f.note.value = L.note || '';
  $('#editDlg').showModal();
}
$('#editDlg').addEventListener('close', () => {
  if ($('#editDlg').returnValue !== 'save' || !editing) return;
  const f = $('#editForm').elements;
  const body = { id: editing, priority: f.priority.value, due: f.due.value, note: f.note.value };
  if (board.items[editing]?.source === 'manual') body.title = f.title.value;
  act('edit', body, '저장했습니다');
});

// ---------- 패널: 숨김함 / 보관함 / 통계 ----------
function openPanel(kind) {
  $('#panelTitle').textContent = { hidden: '숨김함', archived: '보관함 (Done 30일 경과 자동 보관)', stats: '처리 통계' }[kind];
  $('#panelBody').innerHTML = kind === 'stats' ? statsHtml() : binHtml(kind);
  $('#panelBody').querySelectorAll('[data-w]').forEach((el) => (el.style.width = el.dataset.w + 'px')); // CSP: 인라인 style 속성 대신 CSSOM
  $('#panel').dataset.kind = kind;
  if (!$('#panel').open) $('#panel').showModal();
}
function binHtml(kind) {
  const arr = items().filter((i) => i.column === kind).sort((a, b) => ((b.hiddenAt || b.archivedAt || '') > (a.hiddenAt || a.archivedAt || '') ? 1 : -1));
  if (!arr.length) return '<p class="meta">비어 있습니다.</p>';
  return arr.map((i) => `<div class="row" data-id="${esc(i.id)}"><div class="rt"><div>${esc(i.title)}</div><div class="meta">${esc(i.from || '')} · ${esc(i.date || '')} · ${kind === 'hidden' ? '숨김 ' + fmt(i.hiddenAt) : '완료 ' + fmt(i.doneAt)}</div></div>
    <button data-restore>복원</button><button data-purge class="danger">영구삭제</button></div>`).join('');
}
function weekStart(iso) { const d = new Date(Date.parse(iso) + 9 * 36e5); const wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd); return d.toISOString().slice(0, 10); }
function statsHtml() {
  const all = items().filter((i) => i.column !== 'hidden');
  const weeks = []; const ws = weekStart(new Date().toISOString());
  for (let k = 7; k >= 0; k--) { const d = new Date(Date.parse(ws) - k * 7 * DAY); weeks.push(d.toISOString().slice(0, 10)); }
  const nw = Object.fromEntries(weeks.map((w) => [w, { add: 0, done: 0 }]));
  for (const i of all) {
    if (i.createdAt && nw[weekStart(i.createdAt)]) nw[weekStart(i.createdAt)].add++;
    if (i.doneAt && nw[weekStart(i.doneAt)]) nw[weekStart(i.doneAt)].done++;
  }
  const done = all.filter((i) => i.doneAt && i.createdAt);
  const lead = done.length ? (done.reduce((s, i) => s + (Date.parse(i.doneAt) - Date.parse(i.createdAt)), 0) / done.length / DAY).toFixed(1) : '-';
  const open = all.filter((i) => ['todo', 'doing'].includes(i.column));
  const stale = open.filter((i) => days(i.movedAt) >= 7).length;
  const mx = Math.max(1, ...weeks.map((w) => Math.max(nw[w].add, nw[w].done)));
  const by = {};
  for (const i of all) { const k = i.from || '(미상)'; by[k] ||= { open: 0, done: 0 }; if (['done', 'archived'].includes(i.column)) by[k].done++; else by[k].open++; }
  return `<div class="kpi"><div>진행 중<b>${open.length}</b></div><div>7일 이상 정체<b>${stale}</b></div><div>완료 누계<b>${all.filter((i) => i.doneAt).length}</b></div><div>평균 리드타임<b>${lead}일</b></div></div>
  <h2>주별 신규 · 완료 (최근 8주)</h2><table><tr><th>주(월요일)</th><th>신규</th><th></th><th>완료</th><th></th></tr>
  ${weeks.map((w) => `<tr><td>${w.slice(5)}</td><td>${nw[w].add}</td><td><span class="bar" data-w="${Math.round((nw[w].add / mx) * 120)}"></span></td><td>${nw[w].done}</td><td><span class="bar d" data-w="${Math.round((nw[w].done / mx) * 120)}"></span></td></tr>`).join('')}</table>
  <h2>요청자별</h2><table><tr><th>요청자</th><th>진행</th><th>완료</th></tr>${Object.entries(by).sort((a, b) => b[1].open + b[1].done - a[1].open - a[1].done).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.open}</td><td>${v.done}</td></tr>`).join('')}</table>
  <p class="meta">리드타임 = 보드 등록(createdAt) → 완료(doneAt). 숨긴 카드는 제외.</p>`;
}

// ---------- 이벤트 ----------
document.addEventListener('click', async (e) => {
  const row = e.target.closest('#panel .row');
  if (row) {
    const id = row.dataset.id;
    if (e.target.hasAttribute('data-restore')) { await act('restore', { id }, '복원했습니다'); openPanel($('#panel').dataset.kind); }
    else if (e.target.hasAttribute('data-purge') && confirm('영구삭제할까요? 클라라 카드는 이후 동기화에도 다시 나타나지 않습니다.')) { await act('purge', { id }, '영구삭제했습니다'); openPanel($('#panel').dataset.kind); }
    return;
  }
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  if (e.target.dataset.mv) await move(id, e.target.dataset.mv);
  else if (e.target.hasAttribute('data-edit')) openEdit(id);
  else if (e.target.hasAttribute('data-del')) hideCard(id);
  else if (e.target.tagName !== 'A') card.classList.toggle('open');
});
document.addEventListener('dragstart', (e) => { const c = e.target.closest?.('.card'); if (c) { e.dataTransfer.setData('text/plain', c.dataset.id); c.classList.add('dragging'); } });
document.addEventListener('dragend', (e) => e.target.classList?.remove('dragging'));
document.querySelectorAll('.list').forEach((l) => {
  l.addEventListener('dragover', (e) => { e.preventDefault(); l.classList.add('over'); });
  l.addEventListener('dragleave', () => l.classList.remove('over'));
  l.addEventListener('drop', async (e) => { e.preventDefault(); l.classList.remove('over'); const id = e.dataTransfer.getData('text/plain'); const col = l.parentElement.dataset.col; if (id && board.items[id] && board.items[id].column !== col) await move(id, col); });
});
$('#syncBtn').onclick = async () => {
  const b = $('#syncBtn'); b.disabled = true; b.textContent = '동기화 중…';
  try { const before = board.history?.[0]?.at; await api('sync', {}); filterOpts(); render(); const h = board.history?.[0]; toast(h && h.at !== before ? `동기화 완료: 클라라 ${h.fetched}건, 신규 ${h.added}건` : '동기화 완료'); }
  catch (e) { filterOpts(); render(); toast('동기화 실패: ' + e.message, { bad: true, ms: 8000 }); }
  finally { b.disabled = false; b.textContent = '지금 동기화'; }
};
$('#newTitle').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.value.trim()) { const v = e.target.value; e.target.value = ''; act('add', { title: v }, '추가했습니다'); } });
$('#hiddenBtn').onclick = () => openPanel('hidden');
$('#archBtn').onclick = () => openPanel('archived');
$('#statBtn').onclick = () => openPanel('stats');
$('#panelClose').onclick = () => $('#panel').close();
for (const [sel, k] of [['#q', 'q'], ['#fFrom', 'from'], ['#fSrc', 'src'], ['#fPri', 'pri'], ['#sort', 'sort']]) {
  const el = $(sel); if (view[k]) el.value = view[k];
  el.addEventListener(sel === '#q' ? 'input' : 'change', () => { view[k] = el.value; localStorage.setItem('kanbanView', JSON.stringify(view)); if (board) render(); });
}
$('#go').onclick = () => { KEY = $('#key').value.trim(); localStorage.setItem('kanbanKey', KEY); load().catch((e) => { if (e.message !== 'unauthorized') $('#lerr').textContent = e.message; }); };
$('#key').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#go').click(); });
$('#logout').onclick = () => { localStorage.removeItem('kanbanKey'); KEY = ''; showLogin(); };

// 재조회: 탭이 보일 때만 5분 주기 + 탭 복귀 시 1분 이상 지났으면 (#2)
const refresh = () => { if (KEY && board && document.visibilityState === 'visible' && Date.now() - lastFetch > 60e3 && !$('#editDlg').open) api('board').then(() => { filterOpts(); render(); }).catch(() => {}); };
setInterval(() => { if (Date.now() - lastFetch >= 5 * 60e3) refresh(); }, 30e3);
document.addEventListener('visibilitychange', refresh);
window.addEventListener('focus', refresh);
if (KEY) load().catch((e) => { if (e.message !== 'unauthorized') { showLogin(e.message); } }); else showLogin();
