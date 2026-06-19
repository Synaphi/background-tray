# CLAUDE.md — Background Tray (code repo)

이 폴더는 **코드 리포**입니다. **정본(설계·명세·로드맵·작업 규칙)은 Obsidian 문서**에 있습니다.
코드를 만지기 전에 아래 정본을 먼저 읽으세요.

## 정본 위치 (Obsidian — single source of truth)

| 문서 | 역할 |
|---|---|
| `C:\Obsidian\05. Projects\BackgroundTray\00. OVERVIEW.md` | 허브 — 상태·로드맵·열린 결정·링크 |
| `…\01. Spec.md` | 기술 명세 — ★Electron 연동·onunload 정리 체크리스트·기능 풀세트 |
| `…\02. Build_and_Deploy.md` | 빌드·테스트·GitHub·커뮤니티 스토어 배포 |
| `…\03. Scaffold.md` | 빌드 검증된 파일들의 정본(붙여넣기용) |
| `…\90. Worklog.md` / `…\91. Feedback_Backlog.md` | 자가발전 루프 (작업 기록·백로그) |
| `C:\Obsidian\_AI_GUIDE.md` / `C:\Obsidian\_PROJECT_LOOP.md` | 볼트 공통 규칙 |

> 코드와 문서가 어긋나면 **Obsidian 문서가 우선**입니다. 이 리포의 변경은 관련 Obsidian 문서에 반영하세요.

## 이 리포 사실

- **코드 위치**: `C:\Projects\BackgroundTray` (로컬) → GitHub `synaphi/background-tray`(예정).
- **개발 PC**: **7950X 전용**. `.obsidian/plugins` 동기화 충돌 방지를 위해 이 플러그인의 개발·테스트는 7950X에서만 합니다.
- **테스트 배포 위치**: `C:\Obsidian\.obsidian\plugins\background-tray\` (`main.js`+`manifest.json`+`styles.css`).
- **현재 범위**: MVP(로드맵 1단계 — Run in background + 트레이). 2~6단계는 미구현.

## 빌드 / 테스트

```bash
npm install
npm run dev      # esbuild watch → main.js
npm run build    # tsc 타입체크 + esbuild production (배포/검증용, exit 0 확인)
node smoke.cjs   # Electron 없이 핵심 경로 회귀 스모크 (10/10 PASS 기대)
```

빌드 함정·검증 결과는 `03. Scaffold.md` §검증요약 참조. 핵심:
- esbuild `external`에 `electron`·`@electron/remote` 필수(누락 시 번들 깨짐).
- `strict: true` → `settings` 필드는 `settings!:` (definite assignment).

## 작업 규칙 (요약 — 상세는 _AI_GUIDE / _PROJECT_LOOP)

1. 시작 시 `91. Feedback_Backlog`의 open 항목부터 확인.
2. 기능 단위로 incremental. 각 단계 후 빌드가 깨지지 않는지 확인하고 **"계속 진행할까요?"**를 묻는다. 혼자 끝까지 달리지 말 것.
3. 모든 Electron 호출은 try/catch — 앱 크래시 절대 금지. `onunload`는 Spec §3.4 체크리스트를 전부 수행(끄면 100% 원복).
4. 종료 시 `90. Worklog`에 한 줄 + 관련 문서 `status`/`updated` 갱신. 중요 변경은 `_AI_GUIDE` 접속 로그(2시간 간격·UTF-8·프론트매터·서명).
