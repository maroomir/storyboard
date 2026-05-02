# Storyboard

Storyboard는 작가가 VSCode에서 소설·시나리오를 창작하기 위한 AI 기반 픽션 IDE입니다.

이 저장소는 기존 Picktion 웹앱을 그대로 이식하지 않고, VSCode Extension으로 새롭게 재구성하기 위한 신규 프로젝트입니다. 현재는 Phase 0 저장소 베이스라인을 정리하는 단계입니다.

## 현재 상태

- 저장소: `maroomir/storyboard`
- 형태: VSCode Extension 예정
- 구현 상태: 초기 문서 및 저장소 기반 정리 중
- 기준 문서:
  - [`doc/concept.md`](doc/concept.md): 제품 컨셉, 워크스페이스 구조, 파일 포맷, 명령어 모델
  - [`doc/plan.md`](doc/plan.md): Picktion에서 Storyboard로 전환하는 단계별 계획
  - [`doc/decisions/00-decisions.md`](doc/decisions/00-decisions.md): 초기 저장소 의사결정 로그

## 제품 방향

Storyboard의 기본 멘탈 모델은 단순합니다.

- VSCode 워크스페이스 폴더 하나가 소설 프로젝트 하나입니다.
- `scene/*.txt` 파일 하나가 씬 하나입니다.
- `character/*.card`, `background/*.card`는 YAML 기반 자료 카드입니다.
- `draft/*.md`는 AI가 생성하는 원고 산출물이며 기본적으로 Git에서 제외합니다.

자세한 디렉토리 구조와 파일 포맷은 [`doc/concept.md`](doc/concept.md)를 참고하세요.

## 초기 개발 로드맵

Phase 0/1은 작은 PR 단위로 나누어 진행합니다.

1. **PR 1 — 저장소 베이스라인 정리**
   - 라이선스, 변경 로그, `.gitignore`, README, 의사결정 로그 정리
2. **PR 2 — TypeScript + esbuild 스캐폴딩**
   - 최소 VSCode extension manifest와 `storyboard.helloWorld` 명령 추가
3. **PR 3 — `storyboard.init` 명령**
   - Storyboard 프로젝트 디렉토리와 `.storyboard/project.json` 생성
4. **PR 4 — Activity Bar + Sidebar placeholder**
   - 빈 webview placeholder와 Activity Bar 진입점 추가

## 개발 안내

아직 `package.json`과 빌드 스크립트가 없습니다. PR 2에서 TypeScript, esbuild, VSCode extension 개발 설정을 추가할 예정입니다.

개발 규칙은 다음 문서를 따릅니다.

- [`AGENTS.md`](AGENTS.md)
- [`CLAUDE.md`](CLAUDE.md)
- [`.clinerules/`](.clinerules/)

## 라이선스

MIT License. 자세한 내용은 [`LICENSE`](LICENSE)를 참고하세요.
