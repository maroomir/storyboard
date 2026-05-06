# Storyboard

Storyboard는 작가가 VS Code에서 소설·시나리오를 창작하기 위한 AI 기반 픽션 IDE 확장입니다.

## 버전 0.0.1 (dogfooding)

- **이 저장소의 공개 버전은 `0.0.1`입니다.** (`package.json`의 `version`과 동일)
- **기본 플로우를 검증하는 초기 단계**이며, 완성도·안정성 목표의 정식 릴리즈는 아닙니다.
- **Visual Studio Marketplace 발행은 아직 하지 않습니다.** 로컬 개발(F5) 또는 로컬에서 만든 VSIX로만 검증하는 것을 권장합니다.

## 현재 구현 상태 (Phase 5 기준)

이전 Picktion 웹앱을 그대로 이식하지 않고, VS Code Extension으로 새로 구성한 프로젝트입니다.

- **워크스페이스**: 폴더 하나 = 소설 프로젝트. `Storyboard: Initialize Project`로 `.storyboard/project.json`과 표준 디렉터리 생성
- **Activity Bar**: **Storyboard · Characters**, **Storyboard · Backgrounds**, **Storyboard · Scenes** 세 진입점이 각각 있고, 각각 전용 Webview 사이드바 뷰 하나가 붙는다.
- **카드**: `character/*.card`, `background/*.card` — 커스텀 에디터 + Characters 뷰(캐릭터만) / Backgrounds 뷰(배경만)로 목록 분리. 사이드바 목록은 이미지 없는 컴팩트 카드로 표시되며, 각 항목에서 열기·삭제가 가능
- **씬·드래프트**: `scene/*.txt` ↔ `draft/*.md` — CodeLens·명령으로 생성/재생성, 포맷 적용
- **Scenes 사이드바**: Scenes Activity Bar 진입점의 **Scenes** 뷰 — 씬 목록, 상태 배지, 웹뷰 내 Generate / Open Draft 등
- **관계 그래프**: 캐릭터 관계 시각화(드래그)
- **AI**: `mock` 기본값, SecretStorage API 키, OpenAI / Claude / Google / Ollama provider

기준 문서:

- [`doc/concept.md`](doc/concept.md): 제품 컨셉, 워크스페이스 구조, 파일 포맷
- [`doc/plan.md`](doc/plan.md): 단계별 마이그레이션 계획 및 MVP 게이트
- [`doc/testing/extension-qa.md`](doc/testing/extension-qa.md): 수동 QA(처음 켜 보는 사람용 체크리스트)
- [`doc/decisions/00-decisions.md`](doc/decisions/00-decisions.md): 초기 의사결정 로그

## 제품 모델 (요약)

- 워크스페이스 폴더 하나가 **프로젝트 하나**
- `scene/*.txt` 한 파일이 **씬 하나**
- `character/*.card`, `background/*.card`는 **YAML 기반 자료 카드**
- `draft/*.md`는 AI 생성 초안(기본적으로 Git에서 제외하는 흐름을 권장)

## 처음 써 보기 (요약)

자세한 단계·성공 기준은 **[`doc/testing/extension-qa.md`](doc/testing/extension-qa.md)** 를 따릅니다.

1. 이 저장소를 VS Code로 연 뒤 `npm install`
2. **Run and Debug**에서 `Run Extension`(F5) → Extension Development Host 창
3. 빈 폴더를 워크스페이스로 연 다음 `Storyboard: Initialize Project`
4. Activity Bar에서 **Characters** / **Backgrounds** / **Scenes** 각 뷰의 **+**로 카드·씬을 추가하고, Characters / Backgrounds 사이드바의 컴팩트 카드 항목에서 카드 열기·삭제를 확인합니다. 씬 파일의 CodeLens로 드래프트도 생성할 수 있습니다(세 뷰 제목 줄의 톱니바퀴는 모두 동일한 Storyboard 설정 패널로 연결됨).
5. 필요 시 `Storyboard: Set API Key...`로 키 등록(키 없이도 `mock`으로 흐름 확인 가능)

## 개발 안내

```bash
npm install
npm run build
npm run lint
npm test
```

| 스크립트 | 용도 |
| --- | --- |
| `npm run compile` | 확장 호스트만 (`src/` → `out/extension.js`) |
| `npm run build:webview` | 웹뷰 UI만 (`webview-ui/` → `out/webview-ui/`) |
| `npm run build` | 위 둘 모두 (`compile` + `build:webview`) |

**`webview-ui/`**(사이드바·설정 패널·카드 에디터 등 React 번들)만 고친 경우에는 `npm run build:webview`만 실행해도 됩니다. Extension Development Host(F5) 창에서는 빌드 후 **`Developer: Reload Window`**로 한 번 리로드해야 새 번들이 로드되는 경우가 많습니다.

### Extension Development Host

1. 저장소 루트를 VS Code로 엽니다.
2. `npm install`을 한 번 실행합니다.
3. **Run and Debug**에서 `Run Extension`을 선택하고 **F5**합니다.
4. 새 창에서 `Cmd+Shift+P` / `Ctrl+Shift+P` → `Storyboard: Hello World`로 확장 로딩을 확인할 수 있습니다.

### Storyboard 프로젝트 초기화

Extension Development Host에서 빈 폴더(또는 아직 Storyboard가 아닌 폴더)를 연 뒤,

**`Storyboard: Initialize Project`** 를 실행합니다.

성공 시 워크스페이스에 예를 들어 다음과 같은 구조가 생깁니다(기존 `.gitignore` / README는 덮어쓰지 않고, 필요 시 블록만 추가합니다).

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
```

### AI Provider와 API 키

- 설정 키: `storyboard.defaultProvider`, `storyboard.providers.*`, `storyboard.tasks` 등 (`package.json`의 `contributes.configuration` 참고)
- API 키는 Settings에 넣지 않고 **SecretStorage**에만 저장합니다.
- 명령: **`Storyboard: Set API Key...`** — provider 선택 후 키 입력; 빈 값으로 확인 시 해당 provider 키 삭제

기본 provider는 **`mock`** (키 없이 파이프라인·UI 동작 확인용)입니다.

_F5가 안 뜨면 `npm run compile` 또는 `npm run build` 성공 여부와 Run 구성을 먼저 확인하세요. UI만 바꿨는데 반영이 안 되면 `npm run build:webview` 후 호스트 창을 리로드했는지 확인하세요._

### 로컬 VSIX 패키징 (Marketplace 없이)

MVP/dogfooding 게이트에서만 필요하면, 빌드 후 다음을 실행합니다.

```bash
npm run build
npx @vscode/vsce package
```

생성된 `storyboard-0.0.1.vsix`를 VS Code의 **Extensions: Install from VSIX** 로 설치해 검증할 수 있습니다.

### README용 스크린샷·GIF (선택)

Marketplace용 자산은 아직 확정하지 않았습니다. 소개 이미지를 넣을 때는 예를 들어 다음 세 가지를 권장합니다(파일은 추후 `doc/` 또는 `assets/`에 두고 README에서 링크).

1. Activity Bar에 세 개의 Storyboard 진입점(Characters / Backgrounds / Scenes)과 각 사이드바 뷰
2. `.card` 커스텀 에디터
3. 관계 그래프 또는 씬 → 드래프트 생성 짧은 GIF

## 개발 규칙

- [`AGENTS.md`](AGENTS.md)
- [`CLAUDE.md`](CLAUDE.md)
- [`.clinerules/`](.clinerules/)

## 라이선스

Apache License 2.0 — [`LICENSE`](LICENSE)
