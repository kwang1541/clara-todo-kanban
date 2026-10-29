# 클라라 할일 칸반

클라라(ai.cands.kr) MCP 에서 **나를 지목한(@김광훈) 요청**을 매시 가져와 `Todo → Doing → Done` 칸반으로 관리한다. (Vercel 배포, Netlify 계정 정지로 2026-10-28 전환)

- 전체 구성도·흐름도: [#1](https://github.com/kwang1541/clara-todo-kanban/issues/1) (v1.2 변경분은 #1 댓글)

## 구성
| 파일 | 역할 |
|---|---|
| `public/index.html`, `app.js`, `app.css` | 칸반 화면 (CSP 때문에 인라인 스크립트·스타일 없음) |
| `api/[action].mjs` | `GET /api/board`, `POST /api/sync·move·add·edit·hide(delete)·restore·purge`, 헤더 `x-board-key` = `BOARD_KEY` (상수시간 비교, 실패 시 0.8초 지연) |
| `lib/model.mjs` | 도메인 로직(순수 함수): 동기화 병합·키 규칙·이관·숨김/보관·편집 |
| `lib/board.mjs` | 저장소: Vercel Blob — 버전마다 새 파일 + 고정 포인터(head 메타데이터로 최신 버전 확인), AES-256-GCM, 포인터 ETag 조건부 쓰기 |
| `lib/clara.mjs` | 클라라 MCP 클라이언트, 할일 추출(최근 60일·@멘션·본인 작성 제외·문서 단위 중복 제거) |
| `test/` | `node --test` 단위테스트 (메모리 Blob 으로 저장·동시성 검증) |

## 데이터 규칙
- **카드 키**: `c:` + 클라라 문서 ID(`message:111689#0` → `message:111689`) → 없으면 `u:`+URL → `t:`+제목. 직접 추가는 `m:`
- **열**: `todo · doing · done` + `hidden`(숨김함, 원래 열로 복원) + `archived`(Done 30일 경과 자동 보관)
- **사용자 입력**(우선순위·마감일·메모)은 `local` 에 저장 → 클라라 동기화가 덮어쓰지 않음
- **영구삭제**한 클라라 카드는 `purged` 에 기록해 다시 만들지 않음 (최근 500건)
- **동시 쓰기**: 모든 변경은 `mutate()` — head(포인터)로 최신 버전+ETag 확인 → 버전 파일 읽기 → 변경 → 새 버전 파일 put → 포인터 `put(ifMatch)`. 충돌 시 새 파일 삭제 후 최신 보드로 재적용(최대 5회). 동기화는 클라라 조회를 먼저 끝낸 뒤 저장 직전에 병합
- **왜 고정 경로 1파일이 아닌가**: Blob 공개 URL 은 CDN 이 최소 60초 캐시하고 쿼리스트링·`get(useCache:false)` 로도 최신을 보장하지 못함(2026-10-29 실측). 처음 보는 URL(새 버전 파일)과 head 메타데이터만 항상 최신
- v1(제목 키·타임스탬프 파일) 보드는 첫 접근 시 자동 이관. 옛 파일은 롤백용으로 남겨 둠

## 운영 한도 (Vercel Hobby, Blob)
Hobby 는 한도 초과 시 Blob 이 30일간 막힌다. Advanced Operations(업로드·list) 월 2,000회, Simple Operations(캐시 MISS 읽기) 월 10,000회.

| 동작 | 호출 | 월 예상 |
|---|---|---|
| 정기 동기화 (KST 07~22시 매시 16회/일) | head 1 + 다운로드 1, 변경 있거나 2시간마다만 저장(put 2) | Advanced ~480 · Simple ~960 |
| 카드 조작 (하루 10회 가정) | head 1 + 다운로드 1 + put 2 | Advanced ~600 · Simple ~600 |
| 화면 재조회 (탭 표시 중 5분마다, 8시간×22일) | head 1 (같은 버전 다운로드는 캐시 HIT) | Simple ~2,100 |
| **합계** | | **Advanced ~1,080 · Simple ~3,700** |
v1.1 은 읽기·쓰기마다 `list` 를 불러 매시 동기화만으로 월 ~2,160회(한도 초과)였다.

## GitHub Actions
- `deploy.yml`: main push → `npm test` 통과 시에만 Vercel prod 배포 (CLI·actions 버전 고정)
- `sync.yml`: KST 07~22시 매시 정각 `POST /api/sync`. 실패(200 아님) 시 job 실패 → GitHub 기본 실패 메일
- **60일 규칙**: 공개 저장소는 60일간 활동이 없으면 schedule 워크플로가 자동 비활성화된다. `sync.yml` 이 실행마다 자신을 재활성화(API)하고, 화면은 마지막 동기화가 3시간 넘으면 경고 배너를 띄운다

## 환경변수 (Vercel)
| 이름 | 내용 |
|---|---|
| CLARA_KEY | 클라라 MCP 개인 키 (Bearer) |
| BOARD_KEY | 칸반 접근 키 (암호화 키·저장 경로도 여기서 파생 — 바꾸면 새 빈 보드가 된다) |
| BLOB_READ_WRITE_TOKEN | Vercel Blob 스토어 연결 시 자동 |
| CLARA_ME / CLARA_DAYS / CLARA_URL | 기본 `김광훈` / `60` / `https://ai.cands.kr/mcp/` |

## GitHub Secrets
VERCEL_TOKEN · VERCEL_ORG_ID · VERCEL_PROJECT_ID · APP_URL · BOARD_KEY

## 개발
```
npm install
npm test
```
