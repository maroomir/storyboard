# Storyboard — Architecture

> 작성일: 2026-05-03  
> 상태: 확정 (Phase 0 입력; 출시·i18n 정책은 로컬 `.doc/plan/storyboard-plan.md` Phase 7–8과 동기)

## 1. 한 줄 정의

**Storyboard는 작가가 VSCode에서 소설·시나리오를 창작하기 위한 AI 기반 픽션 IDE이다.**

기존 Picktion 웹앱을 폐기하고, 동일한 AI 핵심을 VSCode Extension으로 옮긴다. 이 문서는 사용자 멘탈 모델, 워크스페이스 구조, 파일 포맷, 명령어 체계의 합의된 정의를 담는다.

## 2. 멘탈 모델

- **워크스페이스 폴더 = 1 프로젝트 = 1 소설**.
  - 사용자가 `/Users/maroomir/MagicBoy/`를 VSCode로 열면, `MagicBoy` 라는 이름의 소설을 그곳에 적는다는 의미.
  - 멀티 프로젝트, 프로젝트 선택 화면은 존재하지 않는다.
- **씬 = 파일**.
  - `scene/01-prologue.txt` 한 파일이 한 씬.
  - 인라인 마커, 가상의 ID 시스템 없음. 파일명이 정렬과 식별을 동시에 책임진다.
- **카드 = 자료**.
  - 캐릭터·배경 정보는 `.card` 파일 한 개에 한 자료. 내부는 YAML, VSCode에서는 커스텀 에디터가 카드 형태로 렌더링.
  - Characters / Backgrounds 사이드바 목록은 각 자료를 이미지 없는 컴팩트 카드 항목으로 보여 주며, 항목에서 열기와 삭제를 수행할 수 있다.
- **원고는 생성물**.
  - `scene/*.txt`(시드) → AI 파이프라인 → `draft/*.md`(최종 원고).
  - `draft/`는 재생성 가능한 산출물이므로 기본적으로 Git에서 제외한다.

## 3. 디렉토리 구조 (확정)

```
MagicBoy/                         # 사용자가 VSCode로 여는 폴더 (= 1 프로젝트)
├── .storyboard/
│   ├── project.json              # 프로젝트 메타 (id, name, format, version)
│   ├── settings.json             # 프로젝트 단위 설정 (선택, git 추적)
│   └── cache/                    # AI 컨텍스트 캐시 (.gitignore)
│       ├── personas/             # 캐릭터별 페르소나 캐시
│       │   └── elia.json
│       └── scenes/               # 씬별 생성 컨텍스트 스냅샷
│           └── 01-prologue.json
│
├── character/
│   ├── elia.card                 # YAML, 커스텀 에디터로 렌더
│   ├── jihoon.card
│   └── profile/
│       ├── elia.png
│       └── jihoon.png
│
├── background/
│   ├── school.card
│   └── home.card
│
├── scene/                        # 사용자가 직접 적는 raw 시드
│   ├── 01-prologue.txt
│   ├── 02-chapter-01.txt
│   └── 03-chapter-02.txt
│
├── draft/                        # AI 생성 최종 원고 (.gitignore)
│   ├── 01-prologue.md
│   ├── 02-chapter-01.md
│   └── 03-chapter-02.md
│
├── .gitignore                    # .storyboard/cache/, draft/
└── README.md                     # 프로젝트 자유 노트
```

### 3.1 폴더 역할 요약

| 폴더 | 역할 | Git 추적 |
|---|---|---|
| `.storyboard/` | 프로젝트 메타 + 캐시 | `project.json`, `settings.json`만 추적 |
| `.storyboard/cache/` | AI 컨텍스트 스냅샷 | 제외 |
| `character/` | 캐릭터 카드 + 프로필 이미지 | 추적 |
| `background/` | 배경 카드 | 추적 |
| `scene/` | 사용자가 작성하는 시드 텍스트 | 추적 |
| `draft/` | AI가 생성한 원고 마크다운 | **제외** (재생성 가능) |

## 4. 파일 포맷 명세

### 4.1 `.storyboard/project.json`

```json
{
  "version": "1.0.0",
  "id": "uuid-v4",
  "name": "MagicBoy",
  "format": "novel",
  "language": "ko",
  "createdAt": "2026-05-03T...",
  "editor": {
    "scenePrefixDigits": 2,
    "trackDraft": false
  }
}
```

- `format`: `novel` | `screenplay` | `play` | `essay` | `poem`
- `scenePrefixDigits`: 씬 파일명 prefix 자릿수 (기본 2 → `01-...`)
- `trackDraft`: `true`로 바꾸면 `draft/`도 Git에 포함 (기본 false)

### 4.2 `.card` (YAML)

`.card`의 실제 텍스트 포맷은 YAML이다. VSCode에서는 `CustomTextEditorProvider`로 등록된 커스텀 에디터가 이 YAML을 카드 폼(이미지 + key/value 영역)으로 렌더링한다. 사용자가 텍스트로 직접 편집하고 싶으면 "Open With…"로 일반 텍스트 에디터를 선택할 수도 있다.

캐릭터 예시 (`character/elia.card`):

```yaml
type: character
id: elia
name: 엘리아
profile: profile/elia.png
role: main
attributes:
  age: 17
  sex: female
  mbti: ENFJ
tags:
  - 용감한
  - 결단력
traits:
  - 활발하게 움직임
  - 결단력 있는 발언
description: |
  주인공. 학교에 첫 등교한 17세 여학생.
relations:
  - target: jihoon
    type: 친구
arc:
  - stage: 발단
    summary: 학교에 도착해 새 친구를 만남
    sceneRef: 01-prologue
recentDialogues:
  - "이건 우리가 해낼 수 있어!"
```

배경 예시 (`background/school.card`):

```yaml
type: location
id: school
name: 학교 정문
locationKind: place
characterIds:
  - elia
tags:
  - 학교
  - 도시
description: |
  주인공이 처음 등교하는 고등학교 정문. ...
```

#### 카드 렌더링 (커스텀 에디터)

- 좌측: 캐릭터 프로필 이미지(PNG, 캐릭터 카드 한정)
- 우측: key/value 영역
  - 고정 키(`name`, `role`, `attributes.*`)는 폼 입력
  - 자유 배열(`tags`, `traits`, `recentDialogues`, `relations`, `arc`)은 동적 리스트 편집기
  - `description`은 멀티라인 텍스트 영역
- 모든 변경은 즉시 YAML 텍스트로 직렬화되어 디스크 반영 (양방향 sync)

### 4.3 `.png`

- 캐릭터 프로필: `character/profile/<id>.png`
- 카드의 `profile` 필드가 상대 경로로 참조 (캐릭터 카드 한정)

### 4.4 `.txt` (씬 시드)

씬은 raw 텍스트 파일이다. 옵셔널 frontmatter 사용 가능.

최소 형태:
```
주인공이 학교에 도착했다. 정문 앞에서 깊게 숨을 들이쉬고,
친구 지훈을 발견한다.
```

명시적 메타가 필요한 경우:
```
---
title: 학교에 도착하다
characters: [elia, jihoon]
location: school
mood: 설렘
---
주인공이 학교에 도착했다...
```

#### 파일명 규칙 (강제)

- 패턴: `NN-<slug>.txt`
- `NN`: zero-pad 2자리 정수 (예: `01`, `02`, ..., `99`)
- `<slug>`: 영소문자, 숫자, 하이픈만 허용
- 잘못된 형식의 파일은 사이드바에 ⚠️ 표시 + 경고 진단 표시
- `Storyboard: New Scene` 명령은 항상 다음 사용 가능 번호로 자동 생성

### 4.5 `.md` (출력 원고, `draft/`)

`draft/<scene>.md`는 AI가 생성한다. 사용자가 직접 손볼 수 있고, `Re-generate`를 누르면 덮어써진다.

- `format=novel`: 일반 산문 마크다운
- `format=screenplay`: Fountain 스타일 또는 `**캐릭터:** 대사`
- `format=play`: 희곡 형식 (지문 + 대사)
- `format=essay` / `format=poem`: 자유 형식

### 4.6 `.storyboard/cache/scenes/<scene>.json` (씬별 컨텍스트)

Picktion 웹앱의 단일 아카이브(`.picktion`)와 달리, Storyboard는 **워크스페이스 폴더의 파일**과 이 JSON으로 씬별 파이프라인 컨텍스트를 나누어 저장한다. 위치는 **`.storyboard/cache/scenes/`로 제한**되며 사용자가 직접 만들거나 옮길 수 없다.

```json
{
  "sceneId": "01-prologue",
  "generatedAt": "2026-05-03T...",
  "input": "주인공이 학교에 도착했다...",
  "extractedSituations": [
    { "summary": "학교 도착", "characters": ["elia"] },
    { "summary": "지훈과 첫 만남", "characters": ["elia", "jihoon"] }
  ],
  "personasUsed": {
    "elia": "<페르소나 텍스트>",
    "jihoon": "<페르소나 텍스트>"
  },
  "backgroundSnapshot": { "id": "school", "name": "학교 정문" },
  "previousContext": "...",
  "providers": { "situationExtraction": "openai", "personaDialogue": "claude" },
  "inputHash": "sha256:..."
}
```

용도:
- 같은 씬 재생성 시 입력 hash 비교로 캐시 hit 판정
- "왜 이렇게 나왔는가" 디버깅
- 추후 회귀 테스트 자료

## 5. 명령어 (확정)

| 명령어 ID | 표시 이름 | 동작 |
|---|---|---|
| `storyboard.init` | `Storyboard: Initialize Project` | 빈 폴더에 디렉토리·`.storyboard/project.json`·.gitignore·README 생성 |
| `storyboard.character.create` | `Storyboard: Create Character` | 새 `.card` + 빈 프로필 placeholder |
| `storyboard.background.create` | `Storyboard: Create Background` | 새 `.card` (location 기본) 생성 후 열기 |
| `storyboard.scene.new` | `Storyboard: New Scene` | 다음 번호로 `scene/NN-<slug>.txt` 생성 후 열기 |
| `storyboard.draft.generate` | `Storyboard: Generate Draft (Current Scene)` | 활성/지정 씬 → `draft/<scene>.md` 생성 |
| `storyboard.draft.generateAll` | `Storyboard: Generate All Drafts` | scene 일괄 처리 |
| `storyboard.apiKey.set` | `Storyboard: Set API Key…` | provider 선택 → 키 입력 → `SecretStorage` |
| `storyboard.relationGraph.open` | `Storyboard: Open Relation Graph` | 관계 그래프 webview Panel |
| `storyboard.draft.export` | `Storyboard: Export Draft…` | TXT/PDF/DOCX export |
| `storyboard.seed.createFromFile` | `Storyboard: Create Project from Seed...` | 암호화 `.seed` → 새 워크스페이스 폴더 |
| `storyboard.seed.syncFromFile` | `Storyboard: Sync Project from Seed...` | 암호화 `.seed` → 기존 프로젝트 동기화 |
| `storyboard.seed.exportToFile` | `Storyboard: Export Project to Seed...` | 워크스페이스 → 암호화 `.seed` |

디스크 교환용 `.seed` 컨테이너 명세는 [seedcoat](https://github.com/maroomir/seedcoat)가 단일 진실원이다. Storyboard·Seeds 공통 정책은 [`STORYBOARD_ALIGNMENT.md`](STORYBOARD_ALIGNMENT.md)를 따른다.

### 5.1 활성화 조건

```json
"activationEvents": [
  "onCommand:storyboard.init",
  "workspaceContains:.storyboard/project.json"
]
```

## 6. 설정 키

`package.json#contributes.configuration`에 다음을 노출한다.

- `storyboard.defaultProvider`: `"openai" | "claude" | "google" | "ollama" | "mock"`
- `storyboard.providers.openai.model`
- `storyboard.providers.claude.model`
- `storyboard.providers.google.model`
- `storyboard.providers.ollama.baseUrl`
- `storyboard.providers.ollama.model`
- `storyboard.tasks.<taskName>.provider`: 작업별 provider 오버라이드
- `storyboard.grammar.realtimeEnabled`: 기본 `false`
- `storyboard.scene.prefixDigits`: 기본 `2`
- (Phase 7 예정) 확장 UI 다국어: **`ko` 기본**, **`en`은 설정 또는 locale 스위치로 선택(옵션)** — 소설 본문 언어와 별개이며, 세부 키 이름은 구현 시 `package.json#contributes.configuration`과 맞춘다.

API 키는 설정에 노출하지 않고 `vscode.SecretStorage`에만 저장한다.

## 7. 비목표 (Non-Goals)

- 멀티 프로젝트 / 프로젝트 선택 화면
- 자체 텍스트 에디터, 자체 자동완성 UI, 자체 toaster — VSCode 네이티브 사용
- 자체 버전 히스토리·스냅샷 — Git 사용
- 클라우드 동기화·로그인·계정 — 로컬 우선
- 모바일/태블릿 사용 시나리오
- 웹앱 병행 운영 (확장 안정화 후 재고)
- `.picktion` 파일 import 및 Picktion 브라우저 저장 포맷과의 **자동 호환·변환**

## 8. 환경

- VSCode `^1.90.0` 이상
- Node.js 18+ (extension host)
- Repository: `maroomir/storyboard` (신규)
- License: Apache-2.0

## 9. 참고

- 상세 마이그레이션 계획은 로컬 `.doc/plan/storyboard-plan.md`(비추적)에 있다.
- 기존 Picktion 저장소 (`maroomir/picktion`)는 그대로 유지(archive 예정)되며, 본 컨셉/계획 문서는 새 `maroomir/storyboard` 저장소의 출발점이 된다.