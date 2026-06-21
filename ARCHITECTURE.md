# Storyboard — Architecture

> 작성일: 2026-05-03  
> 상태: 제품 방향 재정렬 (원클릭 장편 생성 IDE; 출시·i18n 정책은 로컬 `.doc/plan/storyboard-plan.md` Phase 7–8과 동기)

## 1. 한 줄 정의

**Storyboard는 VSCode에서 장편 소설 한 권을 기획, 집필, 검수, 수정, 조립까지 자동 수행하는 원클릭 장편 생성 IDE이다.**

기존 Picktion 웹앱을 폐기하고, 동일한 AI 핵심을 VSCode Extension으로 옮긴다. 제품 방향은 Scrivener류의 보조형 창작 도구가 아니라, **Novel Factory / Autonomous Fiction Studio**에 가깝다. 사용자는 작품 목표와 제약을 지정하고, Storyboard는 장편을 작은 검증 가능한 산출물로 나누어 생성·검수·재작성·조립한다.

이 문서는 사용자 멘탈 모델, 워크스페이스 구조, 파일 포맷, 명령어 체계, 장편 자동 생성 로드맵의 합의된 정의를 담는다.

## 1.1 제품 목표

최종 사용 경험은 **버튼 한 번으로 사람이 쓴 것처럼 일관된 장편 초고를 얻는 것**이다. 단, 기술적으로는 한 번의 거대 프롬프트로 장편 전체를 뽑지 않는다. Storyboard는 다음 단계를 파이프라인으로 실행한다.

1. 작품 컨셉, 장르, 독자층, 금지 조건을 바탕으로 프로젝트 설계를 만든다.
2. 로그라인, 시놉시스, 주요 갈등, 결말, 톤, 시점, 문체 규칙을 확정한다.
3. 캐릭터, 배경, 세계관, 장기 떡밥을 `.card`와 story bible 후보로 만든다.
4. 전체 플롯을 act/chapter/scene 단위로 분해하고 각 씬 목표를 생성한다.
5. 씬별 초안을 생성하되, 이전 본문·canon·캐릭터 상태·미해결 복선을 주입한다.
6. 장거리 연속성, 캐릭터 음성, 문체, 장면 목적, 중복, 설정 모순을 검사한다.
7. 문제 구간을 재작성하고 chapter/volume 단위 원고로 조립한다.

따라서 현재 구현은 기존 `scene/*.txt → draft/*.md` 수동 흐름을 유지하면서, 작품 계약에서 outline, 씬 시드, 장별 초안·검수·재작성, 조립 원고, 최종 검사·요약까지 이어지는 초기 원클릭 파이프라인을 함께 제공한다. 아직 카드/바이블 자동 생성, 긴 원고의 고급 export, 더 정교한 배치 검수는 후속 확장 대상이다.

## 2. 멘탈 모델

- **워크스페이스 폴더 = 1 프로젝트 = 1 소설**.
  - 사용자가 `/Users/maroomir/MagicBoy/`를 VSCode로 열면, `MagicBoy` 라는 이름의 소설을 그곳에 적는다는 의미.
  - 멀티 프로젝트, 프로젝트 선택 화면은 존재하지 않는다.
- **프로젝트 설정 = 생성 계약**.
  - 장르, 국가, 컨셉, 태그, 설명, 독자층, 금지 조건, 목표 분량은 자동 생성 파이프라인의 입력 계약이다.
  - Storyboard는 계약을 바탕으로 outline, cards, bible, scene seed, draft를 차례로 만든다.
- **씬 = 파일**.
  - `scene/01-prologue.txt` 한 파일이 한 씬.
  - 인라인 마커, 가상의 ID 시스템 없음. 파일명이 정렬과 식별을 동시에 책임진다.
  - 사용자가 직접 쓸 수도 있고, 장편 자동 생성 파이프라인이 outline에서 파생해 만들 수도 있다.
- **카드 = 자료**.
  - 캐릭터·배경 정보는 `.card` 파일 한 개에 한 자료. 내부는 YAML, VSCode에서는 커스텀 에디터가 카드 형태로 렌더링.
  - Characters / Backgrounds 사이드바 목록은 각 자료를 이미지 없는 컴팩트 카드 항목으로 보여 주며, 항목에서 열기와 삭제를 수행할 수 있다.
- **원고는 생성·검수·재작성되는 산출물**.
  - `project setting` → outline/card/bible/scene seed → AI 파이프라인 → `draft/*.md` → 검사/재작성 → 조립 원고.
  - `draft/`는 재생성 가능한 산출물이므로 기본적으로 Git에서 제외한다.

## 3. 디렉토리 구조

```
MagicBoy/                         # 사용자가 VSCode로 여는 폴더 (= 1 프로젝트)
├── .storyboard/
│   ├── project.json              # 프로젝트 메타 (id, name, format, version)
│   ├── settings.json             # 프로젝트 단위 설정 (선택, git 추적)
│   ├── bible/                    # 스토리 바이블 정전 설정 (git 추적)
│   │   └── canon.yaml
│   ├── outline/                  # 장편 구조 계획 (git 추적)
│   │   ├── synopsis.md
│   │   ├── chapters.yaml
│   │   └── revision-plan.yaml     # 검수·재작성 이력 (scene 단위)
│   └── cache/                    # AI 컨텍스트 캐시 (.gitignore)
│       ├── personas/             # 캐릭터별 페르소나 캐시
│       │   └── elia.json
│       ├── bible/                # 자동 추출된 설정 사실 후보 (candidate)
│       │   └── 01-prologue.json
│       ├── scenes/               # 씬별 생성 컨텍스트 스냅샷
│       │   └── 01-prologue.json
│       └── novel-run.json        # 원클릭 장편 생성 진행/재개 상태
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
├── manuscript/                   # chapter/volume 조립 원고 (.gitignore)
│   ├── 01-prologue.md
│   └── manuscript.md
│
├── .gitignore                    # .storyboard/cache/, draft/, manuscript/
└── README.md                     # 프로젝트 자유 노트
```

### 3.1 폴더 역할 요약

| 폴더 | 역할 | Git 추적 |
|---|---|---|
| `.storyboard/` | 프로젝트 메타 + 내부 저장소 | 하위 폴더별 정책 적용 |
| `.storyboard/bible/` | 스토리 바이블 정전 설정 | 추적 (사람이 확정한 설정) |
| `.storyboard/outline/` | 장편 시놉시스·챕터·씬 계획·재작성 계획 | 추적 |
| `.storyboard/cache/` | AI 컨텍스트 스냅샷 | 제외 |
| `character/` | 캐릭터 카드 + 프로필 이미지 | 추적 |
| `background/` | 배경 카드 | 추적 |
| `scene/` | 사용자가 작성하는 시드 텍스트 | 추적 |
| `draft/` | AI가 생성한 원고 마크다운 | **제외** (재생성 가능) |
| `manuscript/` | chapter/volume로 조립한 원고 | **제외** (재생성 가능) |

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

작품 단위 자동 생성 입력은 `setting`에 둔다. genre/country/concept/tags/description에 더해, **Phase A(생성 계약)**로 독자층(`audience`), 목표 분량(`targetWordCount`), 시점(`pov`: `first` | `third-limited` | `third-omniscient`), 금지 조건(`prohibitions`), 문체 제약(`styleConstraints`), 품질 기준(`qualityCriteria`)을 추가했다. 이 계약 필드는 `Storyboard: Open Settings`의 **작품 계약** 탭에서 편집하며, 원클릭 생성 전 누락·위험 조합을 검증한다. chapter/scene 단위 목표 분량은 `chapters.yaml`의 `targetWordCount`로 둔다.

```jsonc
"setting": {
  "genre": "성장 판타지",
  "audience": "10대 후반",
  "targetWordCount": 120000,
  "pov": "third-limited",
  "prohibitions": ["과도한 폭력"],
  "tags": ["학원"]
}
```

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

씬 입력 hash에는 주입된 정전 설정(아래 4.7)도 포함되어, canon이 바뀌면 하위 씬 캐시가 무효화된다.

### 4.7 `.storyboard/bible/canon.yaml` (스토리 바이블)

장편의 장거리 일관성을 위한 **정전(canon) 설정 저장소**다. 사람이 확정한 사실만 담으며 git으로 추적한다.
씬 생성 시 등장 인물/배경에 해당하는 canon 사실만 골라 파이프라인 컨텍스트(`previousContext`)에 주입하고,
초안의 `연속성 검사`는 이 설정과 본문이 모순되는 구간을 진단한다.

```yaml
version: 1.0.0
facts:
  - id: elia-eye-color
    subject: { kind: character, id: elia }   # character | background
    key: 눈동자 색
    value: 녹색
    status: canon                            # canon | candidate (candidate는 주입/검사 제외)
    sourceScene: 01-prologue                 # 선택
```

**candidate → canon 흐름**: 초안 생성 시 설정 사실 추출(`factExtraction`)이 등장 인물의 고정 설정을
`.storyboard/cache/bible/<scene>.json`에 **candidate**로 자동 저장한다. `Storyboard: Promote Bible
Candidates to Canon` 명령으로 작가가 후보를 골라 `canon.yaml`로 승격하면, 그때부터 주입·연속성 검사 대상이 된다.

### 4.8 `.storyboard/outline/` (장편 구조 계획)

장편 자동 생성은 outline을 명시적 산출물로 저장해야 재시도와 검수가 가능하다.

- `synopsis.md`: 로그라인, 장르 약속, 주요 갈등, 결말, 주제, 톤, 시점, 문체 규칙. (`storyboard.outline.generate`가 생성)
- `chapters.yaml`: act/chapter/scene 구조, chapter/scene 목표 분량, 각 씬의 목적, 등장 인물, 배경, 갈등, 반전, 감정 변화, 회수할 복선, 필요한 설정 사실. (`storyboard.outline.generate`가 생성)
- `revision-plan.yaml`: 검사 결과와 재작성 지시를 scene 단위로 누적. (`storyboard.draft.reviseLoop`·`storyboard.novel.generate`가 기록)

이 파일들은 사람이 검토할 수 있는 계획이면서, `scene/*.txt`와 `draft/*.md`를 생성하는 입력이다. `synopsis.md`·`chapters.yaml`는 `storyboard.outline.generate`로 생성하며, 사용자가 VSCode에서 직접 편집한다. `chapters.yaml`에서 `scene/NN-slug.txt` 시드를 파생하는 흐름은 `storyboard.scene.generateAllSeeds`가 담당하고, 생성된 시드는 기존 `Generate All Drafts`가 그대로 처리한다.

## 5. 명령어 (확정)

| 명령어 ID | 표시 이름 | 동작 |
|---|---|---|
| `storyboard.init` | `Storyboard: Initialize Project` | 빈 폴더에 디렉토리·`.storyboard/project.json`·.gitignore·README 생성 |
| `storyboard.character.create` | `Storyboard: Create Character` | 새 `.card` + 빈 프로필 placeholder |
| `storyboard.background.create` | `Storyboard: Create Background` | 새 `.card` (location 기본) 생성 후 열기 |
| `storyboard.scene.create` | `Storyboard: New Scene` | 다음 번호로 `scene/NN-<slug>.txt` 생성 후 열기 |
| `storyboard.draft.generate` | `Storyboard: Generate Draft (Current Scene)` | 활성/지정 씬 → `draft/<scene>.md` 생성 |
| `storyboard.draft.generateAll` | `Storyboard: Generate All Drafts` | scene 일괄 처리 |
| `storyboard.novel.generate` | `Storyboard: Generate Novel` | 작품 설정 → outline→seeds→장별 draft/검수→조립→검사→요약 전체 실행(모드 선택·재개) |
| `storyboard.outline.generate` | `Storyboard: Generate Novel Outline` | 작품 설정 → `.storyboard/outline/synopsis.md`·`chapters.yaml` 생성 |
| `storyboard.scene.generateAllSeeds` | `Storyboard: Generate Scene Seeds` | `chapters.yaml` → `scene/NN-slug.txt` 생성 |
| `storyboard.manuscript.assemble` | `Storyboard: Assemble Manuscript` | `chapters.yaml` 순서로 `draft/*.md`를 `manuscript/` 챕터·볼륨 파일로 조립 |
| `storyboard.manuscript.review` | `Storyboard: Review Manuscript` | 조립한 전체 원고를 continuity·비평으로 검사해 `manuscript/REVIEW.md` 보고서 생성 |
| `storyboard.manuscript.summaries` | `Storyboard: Summarize Chapters` | 장별 AI 요약과 이전 장 recap을 `manuscript/SUMMARY.md`로 생성 |
| `storyboard.draft.continuityCheck` | `Storyboard: Continuity Check (Draft)` | 초안을 `.storyboard/bible/canon.yaml`과 대조해 설정 모순 진단 |
| `storyboard.draft.reviseLoop` | `Storyboard: Review & Revise Draft (Current Scene)` | 초안을 연속성·비평으로 검사하고 차단 이슈를 재작성으로 고치는 루프 |
| `storyboard.bible.promoteCandidates` | `Storyboard: Promote Bible Candidates to Canon` | 자동 추출된 설정 후보를 골라 `canon.yaml`로 승격 |
| `storyboard.bible.canonDiff` | `Storyboard: Canon Diff Report` | 미승격 설정 후보를 `canon.yaml`과 대조해 `manuscript/CANON.md` 보고서 생성 |
| `storyboard.apiKey.set` | `Storyboard: Set API Key…` | provider 선택 → 키 입력 → `SecretStorage` |
| `storyboard.relationGraph.open` | `Storyboard: Open Character Relation Graph` | 관계 그래프 webview Panel |
| `storyboard.draft.export` | `Storyboard: Export Draft…` | 조립 원고(`manuscript/manuscript.md`)를 Markdown/TXT로 내보내기 (PDF/DOCX 후속) |
| `storyboard.seed.createFromFile` | `Storyboard: Create Project from Seed...` | `.seed` 아카이브 → 새 워크스페이스 폴더 |
| `storyboard.seed.syncFromFile` | `Storyboard: Sync Project from Seed...` | `.seed` 아카이브 → 기존 프로젝트 동기화 |
| `storyboard.seed.exportToFile` | `Storyboard: Export Project to Seed...` | 워크스페이스 → `.seed` 아카이브 |

디스크 교환용 `.seed` 저장소 아카이브 명세는 [seedcoat](https://github.com/maroomir/seedcoat)가 단일 진실원이다. Storyboard·Seeds 공통 정책은 [`STORYBOARD_ALIGNMENT.md`](STORYBOARD_ALIGNMENT.md)를 따른다.

### 5.1 활성화 조건

```json
"activationEvents": [
  "workspaceContains:.storyboard/project.json",
  "onCommand:storyboard.seed.createFromFile",
  "onCommand:storyboard.seed.syncFromFile",
  "onCommand:storyboard.seed.exportToFile"
]
```

그 외 contributed command는 VSCode의 command activation 동작으로 실행된다.

## 6. 설정 키

`package.json#contributes.configuration`에 다음을 노출한다.

- `storyboard.defaultProvider`: `"openai" | "claude" | "google" | "ollama" | "claude-code" | "codex" | "mock"`
- `storyboard.providers.openai.model`
- `storyboard.providers.claude.model`
- `storyboard.providers.google.model`
- `storyboard.providers.ollama.baseUrl`
- `storyboard.providers.ollama.model`
- `storyboard.providers.claude-code.command` / `storyboard.providers.claude-code.model`
- `storyboard.providers.codex.command` / `storyboard.providers.codex.model`
- `storyboard.tasks.<taskName>.provider`: 작업별 provider 오버라이드
- `storyboard.grammar.realtimeEnabled`: 기본 `false`
- `storyboard.scene.prefixDigits`: 기본 `2`
- `storyboard.draft.reviseMaxIterations`: 검수·재작성 루프 최대 재작성 횟수, 기본 `2`
- 확장 UI 다국어(i18n): `package.nls.json`(기본/영어) + `package.nls.<locale>.json`(예: `package.nls.ko.json`) 메커니즘을 사용한다. `displayName`·`description`과 **모든 명령 제목**을 외부화했다. 설정 설명, 런타임 문자열(`vscode.l10n`), webview 문자열은 점진적으로 이관한다. 소설 본문 언어와는 별개다.

API 키는 설정에 노출하지 않고 `vscode.SecretStorage`에만 저장한다.

`claude-code`·`codex` provider는 클라우드 API를 직접 호출하는 대신 로컬에 설치된 `claude`·`codex` CLI를
헤드리스 모드로 실행해 생성 결과를 가져온다. 인증은 각 CLI의 자체 로그인(구독)이 처리하므로 API 키가
필요 없고(keyless), CLI는 셸 보간 없이(`shell:false`) 임시 디렉터리에서 읽기 전용으로 실행하며 프롬프트는
stdin으로만 전달한다. `claude-code`는 `--output-format json` 출력에서 토큰 사용량과 비용을 그대로 기록한다.

## 7. 비목표 (Non-Goals)

- 멀티 프로젝트 / 프로젝트 선택 화면
- 자체 텍스트 에디터, 자체 자동완성 UI, 자체 toaster — VSCode 네이티브 사용
- 자체 버전 히스토리·스냅샷 — Git 사용
- 클라우드 동기화·로그인·계정 — 로컬 우선
- 모바일/태블릿 사용 시나리오
- 웹앱 병행 운영 (확장 안정화 후 재고)
- `.picktion` 파일 import 및 Picktion 브라우저 저장 포맷과의 **자동 호환·변환**
- “완성 품질 보장”을 검수 없이 한 번의 모델 응답에 맡기는 방식

## 8. 로드맵

현재 구현은 Phase A~F의 초기 세로 절편을 갖췄다. 아래는 구현된 범위와 남은 확장 방향을 함께 기록한다.

### Phase A: Generation Contract (초기 구현)

- 프로젝트 설정을 작품 생성 계약으로 정리한다.
- 장르, 독자층, 목표 분량, 시점, 금지 조건, 문체 제약, 품질 기준을 저장한다(설정 «작품 계약» 탭).
- 설정 패널에서 원클릭 생성 전에 입력 누락과 위험한 조합을 검증한다.
- 현재 상태: 계약 필드(독자층·목표 분량·시점·금지 조건·문체 제약·품질 기준)와 검증·**작품 계약** 설정 탭을 구현. chapter/scene 목표 분량은 `chapters.yaml`에서 관리.

### Phase B: Story Planning (초기 구현)

- 작품 설정에서 로그라인, 시놉시스, 결말, 주요 갈등, 캐릭터 기능, 세계관 규칙을 생성한다.
- `.storyboard/outline/`을 도입해 계획을 사람이 읽고 수정할 수 있게 저장한다.
- `chapters.yaml`가 씬보다 최신이면 Scenes 사이드바에 "outline" stale 배지로 표시한다.
- chapter/scene 단위 목표 분량을 `chapters.yaml`에 저장한다.

### Phase C: Scene Seed Factory (초기 구현)

- outline을 chapter/scene 단위로 분해해 `scene/*.txt`를 자동 생성한다.
- 씬마다 목적, 갈등(`conflict`), 반전(`twist`), 감정 변화, 회수할 복선, 필요한 설정 사실(`neededCanon`)을 `chapters.yaml`에 담고 시드 본문에 반영한다.
- 기존 `Generate All Drafts`는 자동 생성된 씬 시드도 그대로 처리한다.

### Phase D: Autonomous Draft Loop (초기 구현)

- 단일 씬 초안에 대해 continuity와 통합 비평(character voice, plot purpose, repetition) 검사를 묶어 실행한다(`storyboard.draft.reviseLoop`).
- 검사 결과를 재작성 지시로 변환해 초안을 다시 쓰고, 차단 이슈가 없거나 최대 횟수에 도달할 때까지 review→revise→re-review를 반복한다.
- 작품 계약의 문체 제약(`styleConstraints`)과 품질 기준(`qualityCriteria`)을 비평 프롬프트에 반영한다.
- 비용, 토큰, provider, 모델 선택을 작업별로(`draftCritique`/`draftRevision`/`continuityCheck`) 사용량 원장에 기록한다.
- 전체 씬 배치 검수와 grammar 통합, 생성 직후 자동 체이닝은 Phase F에서 다룬다.

### Phase E: Manuscript Assembly (초기 구현)

- `chapters.yaml` 순서로 `draft/*.md`를 chapter별 파일과 전체 volume 파일(`manuscript/`)로 결정적으로 조립한다(`storyboard.manuscript.assemble`).
- 초안이 없는 계획 씬은 자리표시·집계, 계획 밖 초안은 "기타" 챕터로 보존한다.
- 조립한 전체 원고를 canon 연속성·비평(보이스/목적/반복)으로 검사해 `manuscript/REVIEW.md` 보고서를 남긴다(`storyboard.manuscript.review`).
- 조립 시 `chapters.yaml`의 회수 대상 복선을 장별 체크리스트(`manuscript/FORESHADOWING.md`)로 정리한다.
- 장별 AI 요약과 이전 장 recap을 `manuscript/SUMMARY.md`로 생성한다(`storyboard.manuscript.summaries`).
- 미승격 설정 후보(candidate)를 canon과 대조해 `manuscript/CANON.md`로 정리한다(`storyboard.bible.canonDiff`).

### Phase F: One-Click Novel (초기 구현)

- `Storyboard: Generate Novel`(`storyboard.novel.generate`) 명령이 validate(A)→outline(B)→seeds(C)→장별 draft/검수(D)→assemble/review/summaries(E)를 한 진행 상태로 실행한다.
- 실패·중단 시 단계·장 진행 상태를 `.storyboard/cache/novel-run.json`(재시작 가능한 작업 큐)에 남기고, 다시 실행하면 중단 지점부터 재개한다.
- 사용자는 전체 자동 실행, outline 승인 후 실행, chapter별 승인 실행 중 하나를 고를 수 있다.
- 문서 export(PDF/DOCX)와 매우 긴 원고의 분할 검사는 후속에서 다룬다.

## 9. 환경

- VSCode `^1.90.0` 이상
- Node.js 18+ (extension host)
- Repository: `maroomir/storyboard` (신규)
- License: Apache-2.0

## 10. 참고

- 상세 마이그레이션 계획은 로컬 `.doc/plan/storyboard-plan.md`(비추적)에 있다.
- 기존 Picktion 저장소 (`maroomir/picktion`)는 그대로 유지(archive 예정)되며, 본 컨셉/계획 문서는 새 `maroomir/storyboard` 저장소의 출발점이 된다.
