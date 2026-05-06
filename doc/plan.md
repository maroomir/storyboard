# Storyboard — 마이그레이션 계획서

> 작성일: 2026-05-03
> 상태: Phase 6 마감(에디터 통합). 다음: Phase 7 — export·온보딩·i18n·**0.1.0** 메타
> MVP 게이트(0.0.1): 로컬 빌드·`vsce package`·수동 QA·dogfooding — Marketplace 발행은 범위 밖
> 짝 문서: `doc/concept.md`

본 문서는 **Picktion 웹앱**에서 **Storyboard VSCode Extension**으로의 전체 마이그레이션 절차를 정의한다. 컨셉·파일 포맷·명령어의 합의는 `doc/concept.md`에 있다. 본 문서는 그 컨셉을 어떻게 단계적으로 구현할지에 집중한다.

## 0. 한눈에 보기

- 기존 Picktion (`maroomir/picktion`)은 **그대로 보존(아카이브 예정)**.
- 새 저장소 (`maroomir/storyboard`)에서 **VSCode Extension으로 처음부터 재구성**.
- 현 코드 중 **`services/ai/`, 일부 `models/`, 일부 `utils/`만 그대로 이식**, 나머지는 폐기.
- 단일 워크스페이스 = 단일 프로젝트 모델. 자체 storage·revision·toaster 모두 폐기, VSCode 네이티브로 대체.
- **MVP = Phase 0–5 (~5.5주)**. **첫 공개 번들(CHANGELOG·패키지 버전 0.1.0) = Phase 7**, **Marketplace QA·발행 = Phase 8** (+~2주 누적 ~8주), 1인 풀타임 기준.

## 1. 신규 저장소 디렉토리 구조

```
/storyboard
├── package.json                       # Extension manifest + scripts
├── src/                               # Extension Host (Node.js)
│   ├── extension.ts                   # activate(), deactivate()
│   ├── core/
│   │   ├── workspace.ts               # 워크스페이스 = 프로젝트 인식
│   │   ├── projectFiles.ts            # .storyboard/project.json 로드/저장
│   │   ├── pathConventions.ts         # character/, background/, scene/, draft/ 경로 헬퍼
│   │   └── logger.ts
│   ├── domain/                        # 현 src/models/ 슬림 이식
│   │   ├── Character.ts
│   │   ├── Background.ts
│   │   ├── Scene.ts
│   │   ├── Draft.ts                   # 신규 (현 Story.ts 대체)
│   │   └── Project.ts
│   ├── files/                         # 핵심 신규: 파일 ↔ 도메인
│   │   ├── card.ts                    # YAML ↔ Character/Background
│   │   ├── scene.ts                   # txt frontmatter 파싱
│   │   ├── draft.ts                   # md 출력 생성/파싱
│   │   ├── projectJson.ts
│   │   └── sceneCache.ts              # .storyboard/cache/scenes/*.json
│   ├── services/
│   │   ├── ai/                        # 현 src/services/ai/ 그대로 이식
│   │   ├── secrets/SecretStore.ts
│   │   └── settings/ConfigBridge.ts
│   ├── providers/
│   │   ├── CardCustomEditorProvider.ts        # .card 커스텀 에디터
│   │   ├── SidebarCharactersProvider.ts
│   │   ├── SidebarBackgroundsProvider.ts
│   │   ├── SidebarScenesProvider.ts
│   │   ├── ScenePanelProvider.ts              # 씬 생성 패널
│   │   ├── RelationGraphProvider.ts
│   │   ├── InlineCompletionProvider.ts        # draft/*.md 대상
│   │   ├── GrammarDiagnosticsProvider.ts
│   │   ├── CharacterHoverProvider.ts
│   │   └── SceneCodeLensProvider.ts
│   ├── commands/
│   │   ├── init.ts
│   │   ├── createCharacter.ts
│   │   ├── createBackground.ts
│   │   ├── newScene.ts
│   │   ├── generateDraft.ts
│   │   ├── generateAllDrafts.ts
│   │   ├── setApiKey.ts
│   │   ├── openRelationGraph.ts
│   │   ├── exportDraft.ts
│   │   └── index.ts
│   ├── messaging/
│   │   ├── protocol.ts                # zod 스키마
│   │   └── bridge.ts
│   └── utils/                         # 기존 src/utils/ 일부 이식
│
├── webview-ui/                        # Webview UI (React)
│   ├── src/
│   │   ├── views/
│   │   │   ├── characters/
│   │   │   ├── backgrounds/
│   │   │   ├── scenes/
│   │   │   ├── card-editor/           # .card 커스텀 에디터 webview
│   │   │   ├── scene-panel/
│   │   │   └── relation-graph/
│   │   ├── components/                # common 슬림
│   │   ├── hooks/useExtensionRpc.ts
│   │   ├── store/                     # zustand 슬림
│   │   ├── theme/vscodeVars.css
│   │   ├── main.tsx
│   │   └── index.css
│   ├── package.json
│   └── vite.config.ts
│
├── shared/
│   ├── types/                         # 도메인 타입 + 메시지 스키마
│   └── messaging-protocol.ts
│
├── doc/
│   ├── concept.md                     # storyboard-concept.md를 여기로 이전
│   ├── architecture/
│   ├── guide/
│   └── releases/
├── test/
│   ├── unit/
│   ├── integration/
│   └── fixtures/                      # Storyboard 전용 테스트 fixture
├── .vscodeignore
├── .vscode/launch.json
├── tsconfig.json
├── esbuild.config.mjs
├── README.md
├── CHANGELOG.md
└── LICENSE                            # Apache-2.0
```

## 2. 모듈 매핑 (현 Picktion → Storyboard)

| 현 Picktion 자산 | Storyboard에서의 운명 |
|---|---|
| `services/ai/` (5 provider + 16 prompts + pipeline) | **그대로 이식**, extension host에서 호출 |
| `services/storage/IndexedDBAdapter.ts` | **삭제** |
| `services/storage/FileSystemAdapter.ts` (.picktion) | **삭제** (Storyboard는 폴더·`.card` 포맷만 지원; `.picktion` 호환 import는 범위 밖) |
| `services/storage/StorageService.ts` 인터페이스 | **삭제** |
| `services/config/ConfigService.ts` | 슬림 이식 (presets.json은 webview-ui로 이전) |
| `models/Project.ts`, `Character.ts`, `Background.ts`, `Scene.ts`, `Story.ts` | 도메인 정의는 **재사용**, 직렬화 로직은 폐기 후 `files/` 모듈로 재작성 |
| `models/ProjectSerialization.ts`, `ProjectEventSerialization.ts` | **삭제** |
| `models/CharacterArc.ts`, `BackgroundLocation.ts` | 재사용 (.card YAML 안에 포함) |
| `models/Tag.ts` | 재사용 |
| `store/projectStore.ts` + revision/snapshot helpers | **삭제** (Git이 대체) |
| `store/projectStore/characterHelpers`, `sceneHelpers` | webview 측에 슬림 재구성 |
| `store/settingsStore.ts` (API 키 암호화) | **삭제 + `vscode.SecretStorage`로 교체** |
| `store/configStore.ts` | VSCode `configuration` 어댑터로 교체 |
| `store/uiStore.ts` | webview 측 그대로 유지 (모달·로딩 상태) |
| `hooks/useAutoSave.ts` | **삭제** (VSCode 자동 저장 + file watcher) |
| `hooks/useAI.ts` | RPC 호출 형태로 재작성 (얇아짐) |
| `hooks/useContextualAutocomplete.ts` | **`InlineCompletionProvider`로 LSP 스타일 이식** (draft/*.md 대상) |
| `hooks/useKeyboardShortcuts.ts` | VSCode `contributes.keybindings`로 이전 |
| `hooks/useToast.ts` | **삭제** (`vscode.window.showInformationMessage`) |
| `hooks/useTheme.ts` | **삭제** (VSCode 테마 자동 감지) |
| `utils/crypto.ts` | **삭제** |
| `utils/settingsExport.ts` | **삭제** (VSCode Settings Sync가 대체) |
| `utils/exportUtils.ts` | `commands/exportDraft.ts`로 이동 (그대로 작동) |
| `utils/aiResponseParser.ts`, `jsonRepair.ts`, `traitsProcessor.ts`, `characterDetector.ts`, `sceneMatcher.ts`, `textParser.ts`, `autocomplete.ts`, `autocompleteContext.ts` | **그대로 재사용** |
| `utils/logger.ts` | extension host 로거로 교체 (`vscode.window.createOutputChannel`) |
| `components/editor/TextEditor.tsx` | **삭제** (VSCode 네이티브 에디터 사용) |
| `components/editor/GenerateScenePanel.tsx` | webview Panel로 재구성 |
| `components/character/*`, `components/background/*`, `components/events/*` | 사이드바 webview view로 재배치 |
| `components/project/ProjectSelectionView.tsx`, `ProjectWizard.tsx` | **삭제** (워크스페이스가 프로젝트) |
| `components/layout/Navbar.tsx`, `Sidebar.tsx` | **삭제** (VSCode 네이티브 UI) |
| `components/common/*` (Button, Card, Dialog, ...) | 대부분 유지 (webview-ui로 이전) |
| `components/common/Toast.tsx`, `Toaster.tsx`, `ThemeToggle.tsx`, `SyncReviewModal.tsx` | **삭제** |
| `components/settings/SettingsDialog.tsx` | **삭제** (VSCode `Preferences`로 이전) |
| `lib/utils.ts` (cn 등) | 유지 |

## 3. 마이그레이션 단계 — 9 Phase, ~8주

각 Phase는 **독립 PR**로 끝낼 수 있고, **Phase 끝마다 F5로 확장이 동작**한다.

### Phase 0 — 저장소 베이스라인 정리 (완료)

**목표**: 새 저장소의 기본 문서·라이선스·개발 규칙을 정리하고 Phase 1 진입 기준을 확정.

**체크리스트**
- [x] GitHub 신규 저장소 `maroomir/storyboard` 생성
- [ ] VSCode Marketplace publisher `maroomir` 등록 (Personal Access Token 발급)
- [x] 이름·도메인·publisher·라이선스 합의 사항 문서화 (`doc/concept.md` 이전)
- [x] 골든 픽스처 수집 제외 결정 기록 (`doc/decisions/00-repo-baseline.md`)
- [x] `storyboard-concept.md`, `storyboard-plan.md`를 신규 repo `doc/`로 이전
- [x] `LICENSE` (Apache-2.0) 추가
- [x] `.gitignore` 추가
- [x] `CHANGELOG.md` 골격 추가
- [x] `README.md` 확장
- [x] `.clinerules/` 존재 확인
- [x] 초기 의사결정 로그 추가 (`doc/decisions/00-repo-baseline.md`)

**산출물**: 새 repo, 정식화된 컨셉/계획 문서, 라이선스, 변경 로그, 개발 규칙, 의사결정 로그

**검증**: 파일 존재와 문서 링크를 수동 확인. PR 1 시점에는 `package.json`이 없어 빌드/테스트는 생략.

### Phase 1 — 확장 스캐폴딩 (3~5일)

**목표**: F5 → 빈 확장 + `storyboard.init` 명령 + 워크스페이스 인식.

**체크리스트**
- [x] `npm init` + extension manifest 작성
  - `engines.vscode: ^1.90.0`
  - `activationEvents`, `contributes.commands`, `contributes.viewsContainers.activitybar`, `contributes.views`
  - `publisher: maroomir`, `displayName: Storyboard`, `categories: ["AI", "Other"]`
  - `contributes.configuration`은 Phase 3 설정 작업에서 추가 예정
- [x] 의존성 설치: `esbuild`, `typescript`, `eslint`, `prettier`, `js-yaml`, `zod`, `uuid`
  - `vscode` npm 패키지는 설치하지 않음. 런타임 API는 VSCode가 제공하고 타입은 `@types/vscode` 사용.
- [x] `esbuild.config.mjs` (extension host CJS 번들, `external: ["vscode"]`)
- [x] `.vscode/launch.json` (F5 디버그)
- [x] `commands/init.ts`:
  - 비-Storyboard 폴더에서 실행 가능
  - 이미 `.storyboard/project.json` 있으면 안내 후 중단
  - `.storyboard/`만 있고 `project.json`이 없으면 안전을 위해 중단
  - `.storyboard/project.json` + 표준 디렉토리 + `.gitignore` + `README.md` 생성
  - 첫 캐릭터/배경/씬 샘플 1개씩 생성
- [x] 사이드바 view container (Activity Bar 아이콘) — 빈 webview placeholder
- [x] `core/workspace.ts`: 워크스페이스 선택 + `.storyboard/project.json` 존재 검사
- [x] `core/logger.ts`: `vscode.window.createOutputChannel('Storyboard')`
- [x] `files/projectJson.ts`: `.storyboard/project.json` 생성/검증/저장 (zod)
- [x] `core/pathConventions.ts`: Storyboard 표준 경로 헬퍼
- [x] `webview-ui/` 최소 Vite + React placeholder 구성

**검증**
- [x] 빈 폴더에서 `Storyboard: Initialize Project` → 디렉토리 구조 자동 생성
- [x] `.storyboard/project.json` 존재하는 폴더를 열면 사이드바 아이콘 활성화
- [x] Activity Bar 아이콘 클릭 → Sidebar placeholder webview 표시
- [x] `npm run build` 성공
- [x] `npm run lint` 성공
- [x] `npx tsc --noEmit` 성공
- [ ] `vsce package` 성공, `.vsix` 생성

### Phase 2 — 파일 시스템 + Card Custom Editor (완료)

**목표**: `.card` 커스텀 에디터로 캐릭터/배경 카드 편집. 사이드바에 목록 표시.

**체크리스트**
- [x] `files/card.ts`: YAML ↔ Character/Background 양방향 변환 + zod 스키마 검증
- [x] `files/projectJson.ts`: `.storyboard/project.json` 로드/저장
- [x] `files/sceneCache.ts`: cache 디렉토리 헬퍼
- [x] `core/pathConventions.ts`: `characterCardPath(id)`, `profilePath(id)`, `sceneFilePath(id)`, `draftPath(id)`
- [x] `providers/CardCustomEditorProvider.ts`:
  - `vscode.window.registerCustomEditorProvider('storyboard.card', ...)`
  - webview에 폼 UI (이미지 미리보기 + key/value 편집기)
  - 양방향 동기화 (`TextDocument` ↔ webview state)
- [x] `webview-ui/views/card-editor/`: 카드 편집 React 컴포넌트
  - 좌측: 이미지 영역 (`webview.asWebviewUri`로 .png 표시)
  - 우측: 동적 key/value 편집기 + 배열 편집기 (tags, traits, relations, arc, recentDialogues)
  - description은 멀티라인 textarea
- [x] `providers/SidebarCharactersProvider.ts`, `SidebarBackgroundsProvider.ts`:
  - `WebviewViewProvider` 구현
  - file watcher (`vscode.workspace.createFileSystemWatcher`)로 `character/*.card`, `background/*.card` 변경 감지
- [x] `messaging/protocol.ts`: 첫 RPC 메서드 정의 (`cards.list`, `cards.read`, `cards.write`)
- [x] `commands/createCharacter.ts`, `createBackground.ts`: 새 카드 + 빈 프로필 PNG placeholder
- [x] **Round-trip 테스트**: YAML → 도메인 객체 → YAML 동등성

> 구현 메모: 현재 구현은 초기 저장소 규모에 맞춰 `SidebarCardsProvider.ts`, `commands/createCard.ts`, `src/shared/messaging.ts`, `webview-ui/src/main.tsx`의 공용 구조로 단순화했다. 기능 경계는 Phase 2 요구사항과 동일하며, webview 세부 디렉토리 분리는 UI 규모가 커지는 시점에 진행한다.

**검증**
- [x] 사이드바에서 캐릭터 추가 → `character/<id>.card` 생성
- [x] `.card` 더블클릭 → 커스텀 에디터 열림 (이미지 + 폼)
- [x] 폼 편집 → YAML 자동 갱신, git diff에 사람이 읽을 수 있게 표시
- [x] 외부 텍스트 에디터(Open With…)로 YAML 직접 수정 → 폼에 반영

### Phase 3 — AI 서비스 이식 + Secret + 설정 (1주)

**목표**: AI provider 5종이 extension host에서 동작, 키는 SecretStorage.

**체크리스트**
- [ ] 현 `src/services/ai/`를 신규 repo `src/services/ai/`로 그대로 이식
- [ ] **브라우저 전용 코드 제거**: localStorage/IndexedDB 의존 부분 제거 (대부분 settingsStore 의존이라 어댑터로 끊으면 됨)
- [x] `src/services/ai/types.ts`, `AiProviderError`, `providerRegistry.ts`: provider 공용 타입과 registry 기반 마련
- [x] `MockAiProvider`, `OpenAiProvider`: mock + OpenAI provider 최소 구현
- [x] `ClaudeProvider`, `GoogleProvider`, `OllamaProvider`: 나머지 provider 3종 구현
- [x] `AIService` facade + 핵심 prompt 모듈(`situationExtraction`, `personaGeneration`, `personaDialogue`, `genreFormatting`) 최소 이식
- [x] `services/secrets/SecretStore.ts`:
  - `setApiKey(provider, key)`, `getApiKey(provider)`, `deleteApiKey(provider)`, `hasApiKey(provider)`
  - `vscode.ExtensionContext.secrets` 사용
- [x] `services/settings/ConfigBridge.ts`:
  - `vscode.workspace.getConfiguration('storyboard')` 어댑터
  - 현 `settingsStore` 인터페이스 모방 → 기존 AI 코드 변경 최소화
- [x] `package.json#contributes.configuration`:
  - `storyboard.defaultProvider`, `storyboard.providers.openai.model`, `storyboard.providers.claude.model`, `storyboard.providers.google.model`, `storyboard.providers.ollama.baseUrl`, `storyboard.providers.ollama.model`
  - `storyboard.tasks.<taskName>.provider` (작업별 provider 오버라이드)
  - `storyboard.grammar.realtimeEnabled` (기본 `false`)
  - `storyboard.scene.prefixDigits` (기본 `2`)
- [x] `commands/setApiKey.ts`: QuickPick(provider 선택) → InputBox(key) → SecretStorage 저장
- [x] RPC 핸들러 `ai.*`: webview에서 호출 가능하게
- [x] Storyboard 전용 fixture 테스트 (결정적 부분: 파싱, traits 분배)
- [x] Storyboard 전용 fixture 테스트 (결정적 부분: 파싱, traits 분배)

> PR-3a 메모: AI provider 이식 전 단계로 `src/services/ai/types.ts`, `SecretStore`, `ConfigBridge`, `Storyboard: Set API Key...` 명령, `package.json#contributes.configuration`, 관련 단위 테스트를 먼저 추가했다. 기본 provider는 초기 dogfooding을 위해 `mock`으로 둔다.
> PR-3b 메모: Picktion의 `OpenAIProvider` 호출 패턴을 Node.js extension host용으로 단순화해 이식했다. `MockAiProvider`와 `OpenAiProvider`만 `isAvailable: true`이며, Claude/Google/Ollama는 PR-3c에서 구현한다. `ai.providers.list`, `ai.providers.checkConnection`, `ai.generate` RPC 스키마와 핸들러를 추가했다.
> PR-3c 메모: Picktion의 `ClaudeProvider`, `GoogleProvider`, `OllamaProvider` 호출 패턴을 같은 `AiProvider` 인터페이스로 이식했다. 5개 provider 모두 registry에 등록되며, OpenAI/Claude/Google은 SecretStorage API 키를 사용하고 Ollama는 `storyboard.providers.ollama.*` 설정을 사용한다.
> PR-3d 메모: Picktion의 결정적 AI 유틸 중 `aiResponseParser`, `jsonRepair`, `traitsProcessor`를 `src/utils/`로 이식하고, Storyboard fixture 기반 단위 테스트를 추가했다. LLM 호출 결과가 아니라 파싱·정규화·trait 처리 결과만 strict하게 검증한다.
> PR-3d 추가 메모: Picktion의 상위 AI 계층 중 `AIService` facade와 핵심 prompt 4종(`situationExtraction`, `personaGeneration`, `personaDialogue`, `genreFormatting`)을 우선 이식했다. 전체 `sceneGenerationPipeline` 연결은 Phase 4로 넘기되, Phase 3에서 필요한 orchestration 진입점은 확보했다.

**검증**
- [x] 5 provider 모두 registry에 등록되고 `checkConnection()` 경로가 단위 테스트에서 injectable client로 검증됨
- [x] VSCode Settings UI 모델 변경을 반영하는 `ConfigBridge` 단위 테스트 통과
- [x] 키 등록/삭제를 담당하는 `SecretStore`와 `Storyboard: Set API Key...` wiring 구현
- [x] 결정적 파싱/trait fixture 테스트 통과

### Phase 4 — 씬 → 드래프트 파이프라인 (1.5주)

**목표**: `scene/*.txt` 파일에서 `Generate Draft` → `draft/*.md` 생성.

**체크리스트**
- [x] `files/scene.ts`: txt + 옵셔널 frontmatter 파싱
- [x] `files/draft.ts`: 도메인 결과 → md 직렬화 (format에 따라 다름)
- [x] `services/ai/pipelines/sceneGenerationPipeline.ts` 이식 + Storyboard용 어댑터
  - 입력: scene file path, project context (캐릭터·배경·이전 씬 cache)
  - 출력: draft md 텍스트 + per-scene cache JSON
- [x] `commands/generateDraft.ts`:
  - 인자: scene file URI (없으면 active editor)
  - `vscode.window.withProgress` 진행 표시
  - 단계별 메시지 ("상황 추출…", "페르소나 생성…", ...)
  - 완료 시 `draft/<scene>.md` 생성 + 자동으로 열기
- [x] `commands/generateAllDrafts.ts`: 일괄 처리, 진행률 바
- [x] `providers/SceneCodeLensProvider.ts`:
  - `scene/*.txt` 위에 `▶ Generate` / `🔄 Regenerate` / `🎭 Apply Format`
  - 클릭 → `commands.executeCommand`
- [x] 캐시 정책:
  - `.storyboard/cache/scenes/<scene>.json` 저장
  - 다음 호출 시 입력 hash 비교, 동일하면 캐시 반환 (옵션)
- [x] traits 자동 갱신 백그라운드 작업: 새 draft 생성 후 캐릭터 카드의 `traits`/`recentDialogues` 업데이트

> 구현 메모: Storyboard에서는 `scene/*.txt` 한 파일이 `draft/*.md` 한 파일로 이어지므로, Picktion 파이프라인의 여러 situation 결과를 한 draft body로 병합한 뒤 project format을 적용한다. 캐시는 scene 입력 hash와 draft 존재 여부를 함께 확인하며, cache JSON에는 `situationExtraction`, `personaDialogue`, `sceneDraft`, `traitsExtraction`의 실제 resolved provider를 기록한다. `mock` provider도 Phase 4 수동 검증이 가능하도록 task별 구조화 응답을 반환한다.

**검증**
- 샘플 scene → draft 생성 정상 (한국어, 5단계 파이프라인)
- 두 번째 호출 시 캐시 hit
- 캐릭터 카드에 새 traits 자동 추가됨

### Phase 5 — 사이드바 + CodeLens + Graph (1주, MVP 마감)

**목표**: MVP 시각 기능 완성.

**체크리스트**
- [x] `SidebarScenesProvider`: scene/ 디렉토리 트리 + 상태 배지
  - ✅ 생성됨 (draft 존재 + 최신)
  - ⚠️ 구버전 (scene이 draft보다 신규)
  - ⬜ 미생성
- [x] 사이드바 컨텍스트 메뉴: New Scene, Generate, Open Draft
- [x] `commands/newScene.ts`: 다음 사용 가능 번호 자동 계산 + slug 입력 + 파일 생성
- [x] `RelationGraphProvider`: 캐릭터 관계 d3-force webview Panel
- [x] `commands/openRelationGraph.ts`
- [x] draft/*.md CodeLens: `🔁 Re-generate` / `🩹 Grammar Check` / `🌿 Expand`
- [x] webview-ui Tailwind 테마: VSCode color tokens 매핑 완성
- [x] **MVP QA 체크리스트** (`doc/testing/extension-qa.md`)

> **구현 메모 (WebviewView 한계)**: Activity Bar에 올라간 `WebviewView` 사이드바에서는 VSCode `contributes.menus`의 `view/item/context`(탐색기 스타일 행별 컨텍스트 메뉴)가 적용되지 않는다. 씬 행별 **Generate / Open Draft** 등은 **webview 내부 버튼 그룹**으로 제공하고, `view/title` 영역만 VSCode 기본 툴바 메뉴(`New Scene` 등)를 사용한다.

**검증**
- [x] 사이드바 3종 완성
- [x] 관계 그래프 표시 + 노드 드래그
- [x] macOS/Windows에서 한 번씩: init → 캐릭터 추가 → 씬 작성 → 생성 → export까지 동작 (export는 Phase 7 예정이므로 Phase 5 게이트에서는 draft·그래프·사이드바까지 확인)

### MVP 게이트 (Phase 5 완료 후, `package.json` 0.0.1 dogfooding)

기능 범위의 **MVP(Phase 0–5)** 와 별개로, **아직 Marketplace에 올리지 않는** 검증 게이트다.

- [x] `npm run build` / `npm run lint` / `npm test` 통과
- [x] `vsce package`(또는 `npx @vscode/vsce package`) 성공, 산출 `.vsix` < 50MB
- [ ] [`doc/testing/extension-qa.md`](testing/extension-qa.md)의 End-to-end 플로우 최소 1회 통과
- [ ] [`README.md`](../README.md)에 0.0.1·dogfooding·Marketplace 미발행 등 현재 제한이 반영됨
- [ ] [`CHANGELOG.md`](../CHANGELOG.md) `[Unreleased]`에 Phase 4–5 요약이 반영됨(정식 버전 섹션 분리는 실제 릴리스/태그 시점에 선택)
- [ ] 본인 사용 1주일 dogfooding 통과(이슈·결정 사항 기록)

**이번 0.0.1 게이트에서 제외(후속)**

- Visual Studio Marketplace `publish` / `--pre-release`
- README용 스크린샷·GIF 3장 확정(원하면 dogfooding 병행 중 추가)

> 코드 의미의 **MVP(기능)** 는 Phase 0–5까지이며, **배포 채널**은 pre-release 이후 또는 상위 버전에서 연다.

### Phase 6 — 에디터 통합 (1주)

**목표**: `draft/*.md`에서 작가가 손수 편집할 때 AI 보조가 자연스럽게 동작.

**체크리스트**
- [x] `InlineCompletionProvider`:
  - `draft/*.md` 파일에서만 활성
  - 현재 커서 직전 N글자 + 활성 캐릭터 추정 + 배경 컨텍스트 → AI 호출
  - ghost text 표시, Tab으로 수락
  - 디바운스 700ms, 메모리 LRU 캐시
- [x] `GrammarDiagnosticsProvider`:
  - draft/*.md 저장 시 또는 명시적 명령 시 grammar check
  - `DiagnosticCollection`으로 squiggle
  - `provideCodeActions`로 "수정" QuickFix
  - `storyboard.grammar.realtimeEnabled` 기본 `false` (성능 보호)
- [x] `CharacterHoverProvider`:
  - 본문에서 등장 캐릭터 이름 hover → 페르소나 + 최근 대사 + 관계 카드
  - 캐릭터 이름 매칭은 `characterDetector.ts` 재사용
- [x] `commands/expandDraft.ts`: 선택 영역을 AI로 확장
- [x] 사용자 가이드 문서 (`doc/guide/editor.md`)

**검증**
- 타이핑 → 인라인 완성 ghost text 표시
- 맞춤법 squiggle + Quick Fix
- 캐릭터 이름 hover 카드 표시
- provider/command 핵심 경로 단위 테스트(InlineCompletion/GrammarDiagnostics/expandDraft/CharacterHover) 통과

### Phase 7 — Export + 폴리시 + 첫 공개(0.1.0) (1주)

기능·온보딩·i18n·스토어용 자산과 함께, **Marketplace에 `publish`하기 전에 갖춰야 할 법무·메타·문서**를 여기서 끝낸다. (Phase 8은 그 산출물을 **검증한 뒤** 배포하는 단계.)

**체크리스트**
- [ ] `commands/exportDraft.ts`:
  - 옵션: 단일/전체, 형식(TXT/PDF/DOCX)
  - draft/*.md를 정렬 순서대로 합치고 export
  - jspdf, docx는 extension host에서 직접 호출 (이미 Node 호환)
- [ ] 첫 실행 환영 webview (`onboarding`):
  - "워크스페이스 폴더가 비어 있습니다. Initialize Project를 실행하시겠어요?"
  - API 키 등록 안내
- [ ] 다국어 i18n 기초: **`ko` 기본 UI 문자열**, **`en`은 설정 또는 locale 스위치로 선택(옵션)** — 소설 본문은 기존처럼 한국어 중심, 확장 UI는 한국어 우선
- [ ] 아이콘 (128×128 PNG), 배너 색상, README 영상/GIF
- [ ] `package.json` 버전 **0.1.0** 정렬 + **CHANGELOG 0.1.0** 섹션 (Unreleased 정리)
- [ ] **발행 준비(공개 전 필수, Phase 7에서 반영)**:
  - 루트 **`LICENSE`(Apache-2.0)** 와 `package.json`·README 등에 적힌 라이선스 표기가 **서로 모순 없이** 맞는지 확인·수정 (Phase 0에 파일이 있어도, 배포 직전 기준으로 다시 맞춘다)
  - README(또는 Marketplace 상세 초안에 쓸 본문)에 **텔레메트리·사용 데이터 수집 안 함** 등 privacy-first 문구 명시
  - Marketplace 제출용 메타를 manifest에 반영: **repository** 링크, **keywords**(`fiction`, `novel`, `creative writing`, `AI`, `storyboard`, `screenwriter`), **categories** 등 — 문안·키워드 최종 확정은 Phase 8에서 한 번 더 본다

**검증**
- TXT/PDF/DOCX export 정상
- `ko` 기본·`en` 전환(또는 영문 키 로드) 스모크 1회
- 첫 사용자 시나리오: 빈 VSCode → Storyboard 설치 → 폴더 열기 → init → 첫 씬 생성 (15분 이내)
- LICENSE·privacy 문구·Marketplace 메타가 **저장소에 반영**되어 있고, 로컬 `vsce package`로 패키지가 깨지지 않음

### Phase 8 — QA + Marketplace 첫 공개 (3~5일)

**Phase 8은 “0.1.0을 낸 뒤”가 아니라, `vsce publish` **직전** 마지막 게이트다.** Phase 7에서 고정한 0.1.0 빌드·CHANGELOG·문서·메타를 QA로 검증하고, 문제 없으면 같은 버전(**0.1.0**)을 Marketplace에 올린다.

**체크리스트**
- [ ] **발행 직전 점검**: Phase 7 반영분 기준으로 LICENSE·privacy 문구·`package.json` Marketplace 필드·아이콘·README/스크린샷이 **일치**하고 Marketplace·정책 요건을 만족하는지 확인
- [ ] **QA 매트릭스**: macOS / Windows / Linux × 한국어 입력 IME × VSCode stable/insiders
- [ ] 성능: 100 캐릭터 + 100 씬 프로젝트 부하 테스트 (사이드바 응답성, file watcher)
- [ ] 에러 처리: API 키 없음, 네트워크 끊김, 잘못된 YAML, 없는 이미지 등
- [ ] `vsce package`로 최종 VSIX 검증 → `vsce publish`로 Marketplace **첫 공개 0.1.0** (필요 시 `--pre-release` 여부는 Publisher 정책에 맞게 선택)
- [ ] Picktion repo README에 "Storyboard로 이전" 안내 + archive 처리
- [ ] 발표 글 (블로그 / Reddit r/writing, r/vscode) — **배포 직후·직전** 중 팀 편한 타이밍

> **버전 정리**: **1.0.0**은 장기 안정화·기능 완성도 목표로 두고, 이번 로드맵의 Marketplace 첫 버전은 **0.1.0**으로 맞춘다.

## 4. Phase별 일정 요약

| Phase | 기간 | 누적 | 핵심 산출 |
|---|---|---|---|
| 0. 저장소 베이스라인 정리 | 완료 | 완료 | 새 repo, 문서, 라이선스, 변경 로그 |
| 1. 확장 스캐폴딩 | 완료 | 완료 | F5 동작하는 빈 확장 + init + sidebar placeholder |
| 2. 파일 시스템 + Card Editor | 1주 | 2주 | `.card` 커스텀 에디터 |
| 3. AI + Secret + 설정 | 1주 | 3주 | 5 provider 동작 |
| 4. 씬 → 드래프트 파이프라인 | 1.5주 | 4.5주 | scene → draft 생성 |
| 5. 사이드바 + Graph | 1주 | **5.5주 (MVP)** | 0.0.1 로컬 VSIX + dogfooding 게이트 |
| 6. 에디터 통합 | 1주 | 6.5주 | inline 완성·맞춤법·hover |
| 7. Export + 폴리시 + 0.1.0 | 1주 | 7.5주 | export·온보딩·i18n·**발행 준비**(LICENSE·privacy·메타)·CHANGELOG **0.1.0** |
| 8. QA + Marketplace 첫 공개 | 3~5일 | **~8주 (0.1.0 발행)** | **발행 직전** QA → `vsce publish` |

> 1인 풀타임 기준. 파트타임이면 1.7~2배.

## 5. 기술 스택

### 5.1 Extension Host
- Node.js 18+
- TypeScript 5.6+
- esbuild (번들러)
- `vscode` API
- `js-yaml`, `zod`, `uuid`
- 현 Picktion에서 이식: `openai`, `@anthropic-ai/sdk`, `@google/generative-ai`, `axios`, `jspdf`, `docx`

### 5.2 Webview UI
- React 18 + Vite
- TailwindCSS + VSCode CSS variables 매핑
- Zustand (슬림)
- d3-force (관계 그래프)
- `@radix-ui/*` (필요한 것만)
- `lucide-react` (아이콘)

### 5.3 개발 도구
- ESLint + Prettier (현 설정 이식)
- Vitest (단위 테스트)
- `@vscode/test-electron` (확장 통합 테스트)
- `vsce` (패키징·배포)

## 6. 리스크 및 대응

| 리스크 | 영향 | 대응 |
|---|---|---|
| AI provider SDK가 Node.js에서 미지원 동작 | Phase 3 지연 | Phase 0에서 5 provider 모두 Node.js로 단순 호출 검증 (스파이크) |
| `CustomTextEditorProvider` 양방향 동기화 복잡도 | Phase 2 지연 | 공식 예제(`vscode-extension-samples/custom-editor-sample`) 참고. 텍스트 충돌 시 webview 재로드 fallback |
| 한국어 IME + InlineCompletion 충돌 | Phase 6 품질 | `inputBoxComposition` 이벤트 필터, IME 조합 중에는 ghost text 억제 |
| 큰 프로젝트(100+ 씬)에서 file watcher 성능 | Phase 5 품질 | lazy loading, 사이드바 가상 스크롤 |
| README·스크린샷·GIF 미비로 Marketplace 심사 보류 | Phase 7–8 지연 | Phase 7에서 최소 1세트 확보; dogfooding 중 보강 |
| LLM 출력 비결정성 → 회귀 테스트 의미 약화 | Phase 3 검증 어려움 | 결정적 부분(파싱, traits 분배, frontmatter)만 strict, LLM 호출은 구조적 검증(스키마 통과 여부) |
| Marketplace 거절 / 정책 위반 | 출시 지연 | `vscode.proposed.api` 미사용, 외부 호출 시 사용자 동의 UI |

## 7. 명명 규칙 / 코딩 표준

- 컨벤션은 현 picktion repo의 `.clinerules/`, `AGENTS.md`, `CLEANCODE.md`를 그대로 신규 repo에 이전한다.
- TS 코딩: `any` 금지, `readonly` 우선, 명시적 반환 타입.
- 파일명: 컴포넌트는 `PascalCase.tsx`, 그 외 모듈은 `camelCase.ts`.
- 명령어 ID: `storyboard.<area>.<verb>` (예: `storyboard.draft.generate`).
- 설정 키: `storyboard.<area>.<name>` (예: `storyboard.providers.openai.model`).

## 8. 진행 가시화

- 신규 repo의 GitHub Project (Kanban) 또는 Issues로 Phase별 체크리스트 트래킹.
- Phase 마감마다 PR + 태그 (`phase-1`, `phase-2`, ...).
- 본 문서의 각 Phase 체크리스트는 Issue로 변환해 진행 상태를 동기화한다.

## 9. 다음 액션

1. [`doc/testing/extension-qa.md`](testing/extension-qa.md)와 [`README.md`](../README.md)를 기준으로 **0.0.1 dogfooding 게이트**를 수행한다(`npm run build` → `vsce package` → VSIX 용량 기록).
2. Phase 7(export·온보딩·i18n·0.1.0 메타) 이슈를 쪼개 착수한다.
3. Marketplace 첫 공개는 Phase 8에서 **0.1.0** 기준으로 진행; 이후 버전 정책은 CHANGELOG·태그로 관리한다.

## 10. 참고

- 짝 문서: `doc/concept.md` (컨셉·파일 포맷·명령어 명세)
- 원본 컨셉 메모: 루트의 `storyboard_concept.md` (정식화 후 정리 예정)
- 기존 Picktion 아키텍처: `doc/architecture/architecture.md` (참조용)