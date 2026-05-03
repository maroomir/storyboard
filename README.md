# Storyboard

Storyboard는 작가가 VSCode에서 소설·시나리오를 창작하기 위한 AI 기반 픽션 IDE입니다.

이 저장소는 기존 Picktion 웹앱을 그대로 이식하지 않고, VSCode Extension으로 새롭게 재구성하기 위한 신규 프로젝트입니다. 현재는 Phase 3에서 AI provider 설정과 SecretStorage 기반 API 키 관리를 준비하는 단계입니다.

## 현재 상태

- 저장소: `maroomir/storyboard`
- 형태: VSCode Extension 예정
- 구현 상태: 프로젝트 초기화, `.card` 커스텀 에디터, 사이드바 카드 목록, API 키 저장 명령 구현 중
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

개발 의존성을 설치한 뒤 컴파일과 린트를 실행할 수 있습니다.

```bash
npm install
npm run build
npm run lint
```

### Extension Development Host 실행

1. 이 저장소 루트(`/storyboard`)를 VSCode로 엽니다.
2. `npm install`을 한 번 실행합니다.
3. 왼쪽 **Run and Debug** 패널에서 `Run Extension` 구성을 선택합니다.
4. F5를 누르면 새 **Extension Development Host** 창이 열립니다.
5. 새 창에서 명령 팔레트(`Cmd+Shift+P`)를 열고 `Storyboard: Hello World`를 실행합니다.
6. `Hello from Storyboard!` 정보 메시지가 보이면 최소 extension 등록이 정상입니다.

### Storyboard 프로젝트 초기화

Extension Development Host에서 빈 폴더 또는 아직 Storyboard 프로젝트가 아닌 폴더를 연 뒤 명령 팔레트에서 `Storyboard: Initialize Project`를 실행합니다.

명령이 성공하면 열린 워크스페이스 폴더에 다음 구조가 생성됩니다.

```text
.storyboard/project.json
.storyboard/cache/personas/
.storyboard/cache/scenes/
character/sample.card
character/profile/
background/sample.card
background/concept/
scene/01-prologue.txt
draft/
.gitignore
README.md
```

이미 `.storyboard/project.json`이 있는 폴더에서는 초기화를 다시 수행하지 않습니다. 기존 `.gitignore`는 덮어쓰지 않고 Storyboard 전용 ignore 블록만 추가합니다. 기존 `README.md`도 덮어쓰지 않습니다.

### AI Provider 설정과 API 키

Storyboard는 VSCode Settings UI에 `storyboard.*` 설정을 노출합니다. 현재 기본 provider는 키 없이 동작 흐름을 확인할 수 있도록 `mock`입니다.

주요 설정:

- `storyboard.defaultProvider`: `openai`, `claude`, `google`, `ollama`, `mock` 중 선택
- `storyboard.providers.openai.model`
- `storyboard.providers.claude.model`
- `storyboard.providers.google.model`
- `storyboard.providers.ollama.baseUrl`
- `storyboard.providers.ollama.model`
- `storyboard.tasks`: 작업별 provider override

API 키는 Settings에 저장하지 않고 VSCode `SecretStorage`에만 저장합니다.

1. 명령 팔레트에서 `Storyboard: Set API Key...`를 실행합니다.
2. provider를 선택합니다. (`mock`은 키가 필요 없어 표시하지 않습니다.)
3. API 키를 입력하면 SecretStorage에 저장됩니다.
4. 빈 값을 입력하고 확인하면 해당 provider의 기존 키를 삭제합니다.

### Activity Bar와 Sidebar

F5로 Extension Development Host를 실행하면 Activity Bar에 Storyboard 아이콘이 표시됩니다. 아이콘을 클릭하면 현재는 빈 placeholder webview가 열리고, `Coming soon: Phase 2` 메시지를 표시합니다.

F5가 반응하지 않으면 먼저 `npm run compile`이 성공하는지 확인하고, Run and Debug 패널에서 `Run Extension` 구성이 선택되어 있는지 확인하세요.

개발 규칙은 다음 문서를 따릅니다.

- [`AGENTS.md`](AGENTS.md)
- [`CLAUDE.md`](CLAUDE.md)
- [`.clinerules/`](.clinerules/)

## 라이선스

MIT License. 자세한 내용은 [`LICENSE`](LICENSE)를 참고하세요.
