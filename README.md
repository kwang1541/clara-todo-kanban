# 클라라 할일 칸반

클라라(ai.cands.kr) MCP 에서 **나를 지목한(@김광훈) 요청**을 매시 정각 가져와 `Todo → Doing → Done` 칸반으로 관리한다.

- 동기화: `netlify/functions/sync-hourly.mjs` (Netlify Scheduled Function, `@hourly`) → `lib/clara.mjs` 가 MCP `search(q=@김광훈, profile=fresh)` 호출, 최근 60일·본인 작성 제외·제목 기준 중복 제거
- 저장: Netlify Blobs (`clara-kanban/board`). 카드 위치(열)는 동기화해도 유지, 새 건만 Todo 로 들어옴
- API: `netlify/functions/api.mjs` (`/api/board|sync|move|add|delete`), 헤더 `x-board-key` = `BOARD_KEY`
- 화면: `public/index.html` (드래그 또는 버튼으로 이동, 직접 추가, 지금 동기화)
- 배포: `main` 푸시 → GitHub Actions → Netlify (`NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID` 시크릿)

## Netlify 환경변수
| 이름 | 내용 |
|---|---|
| CLARA_KEY | 클라라 MCP 개인 키 (Bearer) |
| BOARD_KEY | 칸반 접근 키 |
| CLARA_ME | 기본 `김광훈` |
| CLARA_DAYS | 기본 `60` |
