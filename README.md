# 클라라 할일 칸반

클라라(ai.cands.kr) MCP 에서 **나를 지목한(@김광훈) 요청**을 매시 정각 가져와 `Todo → Doing → Done` 칸반으로 관리한다. (Vercel 배포, Netlify 계정 정지로 2026-10-28 전환)

- 동기화: GitHub Actions `sync.yml` (매시 정각 cron) → `POST /api/sync` → `lib/clara.mjs` 가 MCP `search(q=@김광훈, profile=fresh)` 호출, 최근 60일·본인 작성 제외·제목 기준 중복 제거
- 저장: Vercel Blob (AES-256-GCM 암호화, 저장마다 새 파일·최신 5개 보관). 카드 위치(열)는 동기화해도 유지, 새 건만 Todo 로
- API: `api/[action].mjs` (`/api/board|sync|move|add|delete`), 헤더 `x-board-key` = `BOARD_KEY`
- 화면: `public/index.html` (드래그 또는 버튼 이동, 직접 추가, 지금 동기화)
- 배포: `main` 푸시 → GitHub Actions `deploy.yml` → Vercel prod

## 환경변수 (Vercel)
| 이름 | 내용 |
|---|---|
| CLARA_KEY | 클라라 MCP 개인 키 (Bearer) |
| BOARD_KEY | 칸반 접근 키 (암호화 키도 여기서 파생) |
| BLOB_READ_WRITE_TOKEN | Vercel Blob 스토어 연결 시 자동 |
| CLARA_ME / CLARA_DAYS | 기본 `김광훈` / `60` |

## GitHub Secrets
VERCEL_TOKEN · VERCEL_ORG_ID · VERCEL_PROJECT_ID · APP_URL · BOARD_KEY
