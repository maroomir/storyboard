# Storyboard — 마이그레이션 계획서

> 작성일: 2026-05-03
> 상태: Phase 0 시작 직전
> 짝 문서: `storyboard-concept.md`

본 문서는 **Picktion 웹앱**(현 저장소)에서 **Storyboard VSCode Extension**(신규 저장소)으로의 전체 마이그레이션 절차를 정의한다. 컨셉·파일 포맷·명령어의 합의는 `storyboard-concept.md`에 있다. 본 문서는 그 컨셉을 어떻게 단계적으로 구현할지에 집중한다.

## 0. 한눈에 보기

- 기존 Picktion (`maroomir/picktion`)은 **그대로 보존(아카이브 예정)**.
- 새 저장소 (`maroomir/storyboard`)에서 **VSCode Extension으로 처음부터 재구성**.
- 현 코드 중 **`services/ai/`, 일부 `models/`, 일부 `utils/`만 그대로 이식**, 나머지는 폐기.
- 단일 워크스페이스 = 단일 프로젝트 모델. 자체 storage·revision·toaster 모두 폐기, VSCode 네이티브로 대체.
- **MVP = Phase 0–5 (~5.5주)**, **정식 출시 = Phase 6–8 (+~2주, 누적 ~7.5주)**, 1인 풀타임 기준.

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
│   │   ├── importPicktion.ts                  # 선택
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
│   └── fixtures/golden/               # Picktion에서 수집한 회귀 픽스처
├── .vscodeignore
├── .vscode/launch.json
├── tsconfig.json
├── esbuild.config.mjs
├── README.md
├── CHANGELOG.md
└── LICENSE                            # MIT
```

## 2. 모듈 매핑 (현 Picktion → Storyboard)

| 현 Picktion 자산 | Storyboard에서의 운명 |
|---|---|
| `services/ai/` (5 provider + 16 prompts + pipeline) | **그대로 이식**, extension host에서 호출 |
| `services/storage/IndexedDBAdapter.ts` | **삭제** |
| `services/storage/FileSystemAdapter.ts` (.picktion) | **삭제** (또는 `commands/importPicktion.ts`로 일회성 흡수) |
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

### Phase 0 — 결정 + 골든 픽스처 (2~3일)

**목표**: 새 환경 + 회귀 검증 기준선 확보.

**체크리스트**
- [ ] GitHub 신규 repo `maroomir/storyboard` 생성 (Public, MIT)
- [ ] VSCode Marketplace publisher `maroomir` 등록 (Personal Access Token 발급)
- [ ] 이름·도메인·publisher·라이선스 합의 사항 문서화 (`doc/concept.md` 이전)
- [ ] **회귀 픽스처 50쌍 수집** (현 Picktion 가동 중에):
  - 씬 생성 5단계 입력/출력 20개
  - traits 추출 입력/출력 15개
  - 배경 추출 입력/출력 10개
  - MBTI/페르소나 5개
- [ ] 픽스처를 신규 repo `test/fixtures/golden/`에 커밋
- [ ] `storyboard-concept.md`, `storyboard-plan.md`를 신규 repo `doc/`로 이전
- [ ] 현 picktion repo는 그대로 두되 `STORYBOARD_PLAN.md`(루트 또는 README 상단 안내) 추가는 보류

**산출물**: 새 repo, 픽스처, 정식화된 컨셉/계획 문서

**검증**: 픽스처 50쌍이 신규 repo에서 로드 가능

### Phase 1 — 확장 스캐폴딩 (3~5일)

**목표**: F5 → 빈 확장 + `storyboard.init` 명령 + 워크스페이스 인식.

**체크리스트**
- [ ] `npm init` + extension manifest 작성
  - `engines.vscode: ^1.90.0`
  - `activationEvents`, `contributes.commands`, `contributes.viewsContainers.activitybar`, `contributes.views`, `contributes.configuration`
  - `publisher: maroomir`, `displayName: Storyboard`, `categories: ["AI", "Other", "Notebooks"]`
- [ ] 의존성 설치: `vscode`, `esbuild`, `typescript`, `eslint`, `prettier`, `js-yaml`, `zod`, `uuid`
- [ ] `esbuild.config.mjs` (extension host CJS 번들, `external: ["vscode"]`)
- [ ] `.vscode/launch.json` (F5 디버그)
- [ ] `commands/init.ts`:
  - 빈 폴더 검증 (이미 `.storyboard/` 있으면 안내 후 중단)
  - `.storyboard/project.json` + 6개 디렉토리 + `.gitignore` + `README.md` 생성
  - 첫 캐릭터/배경/씬 샘플 1개씩
- [ ] 사이드바 view container (Activity Bar 아이콘) — 빈 webview placeholder
- [ ] `core/workspace.ts`: `.storyboard/project.json` 존재 검사 + 활성 프로젝트 컨텍스트
- [ ] `core/logger.ts`: `vscode.window.createOutputChannel('Storyboard')`

**검증**
- 빈 폴더에서 `Storyboard: Initialize Project` → 디렉토리 구조 자동 생성
- `.storyboard/project.json` 존재하는 폴더를 열면 사이드바 아이콘 활성화
- `vsce package` 성공, `.vsix` 생성

### Phase 2 — 파일 시스템 + Card Custom Editor (1주)

**목표**: `.card` 커스텀 에디터로 캐릭터/배경 카드 편집. 사이드바에 목록 표시.

**체크리스트**
- [ ] `files/card.ts`: YAML ↔ Character/Background 양방향 변환 + zod 스키마 검증
- [ ] `files/projectJson.ts`: `.storyboard/project.json` 로드/저장
- [ ] `files/sceneCache.ts`: cache 디렉토리 헬퍼
- [ ] `core/pathConventions.ts`: `characterCardPath(id)`, `profilePath(id)`, `sceneFilePath(id)`, `draftPath(id)`
- [ ] `providers/CardCustomEditorProvider.ts`:
  - `vscode.window.registerCustomEditorProvider('storyboard.card', ...)`
  - webview에 폼 UI (이미지 미리보기 + key/value 편집기)
  - 양방향 동기화 (`TextDocument` ↔ webview state)
- [ ] `webview-ui/views/card-editor/`: 카드 편집 React 컴포넌트
  - 좌측: 이미지 영역 (`webview.asWebviewUri`로 .png 표시)
  - 우측: 동적 key/value 편집기 + 배열 편집기 (tags, traits, relations, arc, recentDialogues)
  - description은 멀티라인 textarea
- [ ] `providers/SidebarCharactersProvider.ts`, `SidebarBackgroundsProvider.ts`:
  - `WebviewViewProvider` 구현
  - file watcher (`vscode.workspace.createFileSystemWatcher`)로 `character/*.card`, `background/*.card` 변경 감지
- [ ] `messaging/protocol.ts`: 첫 RPC 메서드 정의 (`cards.list`, `cards.read`, `cards.write`)
- [ ] `commands/createCharacter.ts`, `createBackground.ts`: 새 카드 + 빈 프로필 PNG placeholder
- [ ] **Round-trip 테스트**: YAML → 도메인 객체 → YAML 동등성

**검증**
- 사이드바에서 캐릭터 추가 → `character/<id>.card` 생성
- `.card` 더블클릭 → 커스텀 에디터 열림 (이미지 + 폼)
- 폼 편집 → YAML 자동 갱신, git diff에 사람이 읽을 수 있게 표시
- 외부 텍스트 에디터(Open With…)로 YAML 직접 수정 → 폼에 반영

### Phase 3 — AI 서비스 이식 + Secret + 설정 (1주)

**목표**: AI provider 5종이 extension host에서 동작, 키는 SecretStorage.

**체크리스트**
- [ ] 현 `src/services/ai/`를 신규 repo `src/services/ai/`로 그대로 이식
- [ ] **브라우저 전용 코드 제거**: localStorage/IndexedDB 의존 부분 제거 (대부분 settingsStore 의존이라 어댑터로 끊으면 됨)
- [ ] `services/secrets/SecretStore.ts`:
  - `setApiKey(provider, key)`, `getApiKey(provider)`, `deleteApiKey(provider)`, `hasApiKey(provider)`
  - `vscode.ExtensionContext.secrets` 사용
- [ ] `services/settings/ConfigBridge.ts`:
  - `vscode.workspace.getConfiguration('storyboard')` 어댑터
  - 현 `settingsStore` 인터페이스 모방 → 기존 AI 코드 변경 최소화
- [ ] `package.json#contributes.configuration`:
  - `storyboard.defaultProvider`, `storyboard.providers.openai.model`, `storyboard.providers.claude.model`, `storyboard.providers.google.model`, `storyboard.providers.ollama.baseUrl`, `storyboard.providers.ollama.model`
  - `storyboard.tasks.<taskName>.provider` (작업별 provider 오버라이드)
  - `storyboard.grammar.realtimeEnabled` (기본 `false`)
  - `storyboard.scene.prefixDigits` (기본 `2`)
- [ ] `commands/setApiKey.ts`: QuickPick(provider 선택) → InputBox(key) → SecretStorage 저장
- [ ] RPC 핸들러 `ai.*`: webview에서 호출 가능하게
- [ ] 골든 픽스처 회귀 테스트 (결정적 부분: 파싱, traits 분배)

**검증**
- 5 provider 모두 `checkConnection()` 통과
- VSCode Settings UI에서 모델 변경 → 즉시 반영
- 키 등록/삭제 명령 정상

### Phase 4 — 씬 → 드래프트 파이프라인 (1.5주)

**목표**: `scene/*.txt` 파일에서 `Generate Draft` → `draft/*.md` 생성.

**체크리스트**
- [ ] `files/scene.ts`: txt + 옵셔널 frontmatter 파싱
- [ ] `files/draft.ts`: 도메인 결과 → md 직렬화 (format에 따라 다름)
- [ ] `services/ai/pipelines/sceneGenerationPipeline.ts` 이식 + Storyboard용 어댑터
  - 입력: scene file path, project context (캐릭터·배경·이전 씬 cache)
  - 출력: draft md 텍스트 + per-scene cache JSON
- [ ] `commands/generateDraft.ts`:
  - 인자: scene file URI (없으면 active editor)
  - `vscode.window.withProgress` 진행 표시
  - 단계별 메시지 ("상황 추출…", "페르소나 생성…", ...)
  - 완료 시 `draft/<scene>.md` 생성 + 자동으로 열기
- [ ] `commands/generateAllDrafts.ts`: 일괄 처리, 진행률 바
- [ ] `providers/SceneCodeLensProvider.ts`:
  - `scene/*.txt` 위에 `▶ Generate` / `🔄 Regenerate` / `🎭 Apply Format`
  - 클릭 → `commands.executeCommand`
- [ ] 캐시 정책:
  - `.storyboard/cache/scenes/<scene>.json` 저장
  - 다음 호출 시 입력 hash 비교, 동일하면 캐시 반환 (옵션)
- [ ] traits 자동 갱신 백그라운드 작업: 새 draft 생성 후 캐릭터 카드의 `traits`/`recentDialogues` 업데이트

**검증**
- 샘플 scene → draft 생성 정상 (한국어, 5단계 파이프라인)
- 두 번째 호출 시 캐시 hit
- 캐릭터 카드에 새 traits 자동 추가됨

### Phase 5 — 사이드바 + CodeLens + Graph (1주, MVP 마감)

**목표**: MVP 시각 기능 완성.

**체크리스트**
- [ ] `SidebarScenesProvider`: scene/ 디렉토리 트리 + 상태 배지
  - ✅ 생성됨 (draft 존재 + 최신)
  - ⚠️ 구버전 (scene이 draft보다 신규)
  - ⬜ 미생성
- [ ] 사이드바 컨텍스트 메뉴: New Scene, Generate, Open Draft
- [ ] `commands/newScene.ts`: 다음 사용 가능 번호 자동 계산 + slug 입력 + 파일 생성
- [ ] `RelationGraphProvider`: 캐릭터 관계 d3-force webview Panel
- [ ] `commands/openRelationGraph.ts`
- [ ] draft/*.md CodeLens: `🔁 Re-generate` / `🩹 Grammar Check` / `🌿 Expand`
- [ ] webview-ui Tailwind 테마: VSCode color tokens 매핑 완성
- [ ] **MVP QA 체크리스트** (`doc/testing/extension-qa.md`)

**검증**
- 사이드바 3종 완성
- 관계 그래프 표시 + 노드 드래그
- macOS/Windows에서 한 번씩: init → 캐릭터 추가 → 씬 작성 → 생성 → export까지 동작

### MVP 게이트 (Phase 5 완료 후)
- [ ] `vsce package` 성공, .vsix < 50MB
- [ ] Marketplace `--pre-release` 발행 가능 상태
- [ ] README 스크린샷·GIF 3장
- [ ] CHANGELOG v0.1.0
- [ ] 본인 사용 1주일 dogfooding 통과

> 여기까지가 **MVP**다. pre-release로 일부 사용자(또는 본인)에게 배포해 피드백을 모은 후 Phase 6–8로 진행한다.

### Phase 6 — 에디터 통합 (1주)

**목표**: `draft/*.md`에서 작가가 손수 편집할 때 AI 보조가 자연스럽게 동작.

**체크리스트**
- [ ] `InlineCompletionProvider`:
  - `draft/*.md` 파일에서만 활성
  - 현재 커서 직전 N글자 + 활성 캐릭터 추정 + 배경 컨텍스트 → AI 호출
  - ghost text 표시, Tab으로 수락
  - 디바운스 700ms, 메모리 LRU 캐시
- [ ] `GrammarDiagnosticsProvider`:
  - draft/*.md 저장 시 또는 명시적 명령 시 grammar check
  - `DiagnosticCollection`으로 squiggle
  - `provideCodeActions`로 "수정" QuickFix
  - `storyboard.grammar.realtimeEnabled` 기본 `false` (성능 보호)
- [ ] `CharacterHoverProvider`:
  - 본문에서 등장 캐릭터 이름 hover → 페르소나 + 최근 대사 + 관계 카드
  - 캐릭터 이름 매칭은 `characterDetector.ts` 재사용
- [ ] `commands/expandDraft.ts`: 선택 영역을 AI로 확장
- [ ] 사용자 가이드 문서 (`doc/guide/editor.md`)

**검증**
- 타이핑 → 인라인 완성 ghost text 표시
- 맞춤법 squiggle + Quick Fix
- 캐릭터 이름 hover 카드 표시

### Phase 7 — Export + 폴리시 + Picktion Import (1주)

**체크리스트**
- [ ] `commands/exportDraft.ts`:
  - 옵션: 단일/전체, 형식(TXT/PDF/DOCX)
  - draft/*.md를 정렬 순서대로 합치고 export
  - jspdf, docx는 extension host에서 직접 호출 (이미 Node 호환)
- [ ] `commands/importPicktion.ts`:
  - `.picktion` 파일 선택 → 새 워크스페이스 폴더로 변환
  - characters → `character/*.card`
  - backgrounds → `background/*.card`
  - scenes → `scene/*.txt` + `draft/*.md`
  - 사용자 안내 메시지
- [ ] 첫 실행 환영 webview (`onboarding`):
  - "워크스페이스 폴더가 비어 있습니다. Initialize Project를 실행하시겠어요?"
  - API 키 등록 안내
- [ ] 다국어 i18n 기초 (`ko` 기본, `en` 영문 키)
- [ ] 아이콘 (128×128 PNG), 배너 색상, README 영상/GIF
- [ ] CHANGELOG v0.9.0

**검증**
- TXT/PDF/DOCX export 정상
- `.picktion` import 라운드트립 손실 없음
- 첫 사용자 시나리오: 빈 VSCode → Storyboard 설치 → 폴더 열기 → init → 첫 씬 생성 (15분 이내)

### Phase 8 — QA + 정식 출시 (3~5일)

**체크리스트**
- [ ] **QA 매트릭스**: macOS / Windows / Linux × 한국어 입력 IME × VSCode stable/insiders
- [ ] 성능: 100 캐릭터 + 100 씬 프로젝트 부하 테스트 (사이드바 응답성, file watcher)
- [ ] 에러 처리: API 키 없음, 네트워크 끊김, 잘못된 YAML, 없는 이미지 등
- [ ] Marketplace 메타: 키워드(`fiction`, `novel`, `creative writing`, `AI`, `storyboard`, `screenwriter`), 카테고리, repository 링크
- [ ] LICENSE (MIT) 확정
- [ ] 텔레메트리 **수집 안 함** 명시 (privacy-first)
- [ ] `vsce publish` 정식 v1.0.0
- [ ] Picktion repo README에 "Storyboard로 이전" 안내 + archive 처리
- [ ] 발표 글 (블로그 / Reddit r/writing, r/vscode)

## 4. Phase별 일정 요약

| Phase | 기간 | 누적 | 핵심 산출 |
|---|---|---|---|
| 0. 결정 + 골든 픽스처 | 2~3일 | 0.5주 | 새 repo, 픽스처 |
| 1. 확장 스캐폴딩 | 3~5일 | 1주 | F5 동작하는 빈 확장 |
| 2. 파일 시스템 + Card Editor | 1주 | 2주 | `.card` 커스텀 에디터 |
| 3. AI + Secret + 설정 | 1주 | 3주 | 5 provider 동작 |
| 4. 씬 → 드래프트 파이프라인 | 1.5주 | 4.5주 | scene → draft 생성 |
| 5. 사이드바 + Graph | 1주 | **5.5주 (MVP)** | Marketplace pre-release |
| 6. 에디터 통합 | 1주 | 6.5주 | inline 완성·맞춤법·hover |
| 7. Export + Polish + Import | 1주 | 7.5주 | 풀 기능 |
| 8. QA + 정식 출시 | 3~5일 | **~8주 (v1.0.0)** | Marketplace 정식 |

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
| Picktion 사용자 데이터 포맷 변화 | Phase 7 import 실패 | 골든 픽스처에 `.picktion` 샘플 포함, round-trip 테스트 |
| LLM 출력 비결정성 → 회귀 픽스처 의미 약화 | Phase 3 검증 어려움 | 결정적 부분(파싱, traits 분배, frontmatter)만 strict, LLM 호출은 구조적 검증(스키마 통과 여부) |
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

## 9. 시작 액션

1. Phase 0의 \"GitHub 신규 repo 생성\" 단계부터 시작.
2. 신규 repo에 `doc/concept.md`, `doc/plan.md` 두 문서를 옮긴다.
3. 새 폴더에서 본 문서 + 컨셉 문서를 열고 Phase 0 체크리스트부터 차례로 수행한다.

## 10. 참고

- 짝 문서: `doc/concept.md` (컨셉·파일 포맷·명령어 명세)
- 원본 컨셉 메모: 루트의 `storyboard_concept.md` (정식화 후 정리 예정)
- 기존 Picktion 아키텍처: `doc/architecture/architecture.md` (참조용)