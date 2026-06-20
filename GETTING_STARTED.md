# Storyboard 시작 가이드 (작가용)

처음 쓰는 작가를 위한 **끝까지 따라 하는** 안내서입니다. 코드를 몰라도 됩니다.
명령은 모두 명령 팔레트(`Cmd/Ctrl + Shift + P`)에서 이름으로 검색해 실행할 수 있고,
자주 쓰는 것은 사이드바 버튼으로도 있습니다.

> 더 자세한 초안 편집 기능은 [`GUIDE.md`](GUIDE.md), 내부 구조·파일 포맷은 [`ARCHITECTURE.md`](ARCHITECTURE.md)를 보세요.

---

## 1. Storyboard는 무엇인가요?

Storyboard는 **소설을 "작품 계약 → outline → 씬 → 초안 → 원고"의 흐름으로 쓰도록 돕는 VSCode 확장**입니다. 핵심 사고방식:

- **작품 계약(generation contract)** = 장르·독자층·시점·목표 분량·금지 조건·문체/품질 기준. 자동 생성의 입력입니다.
- **outline** = 시놉시스, 장/씬 계획, 목표 분량, 갈등·반전·필요 설정. (`.storyboard/outline/`)
- **카드(card)** = 등장인물·배경 같은 *설정 자료*. (`character/`, `background/`)
- **씬(scene)** = 작가가 직접 쓰는 *장면 시드*. "여기서 무슨 일이 일어나는가"를 짧게 적습니다. (`scene/`)
- **초안(draft)** = AI가 씬과 카드를 읽고 만들어 주는 *원고*. (`draft/`)
- **스토리 바이블(bible)** = "엘리아의 눈은 녹색" 같은 *확정 설정*. 장편에서 앞뒤 일관성을 지켜 줍니다.
- **조립 원고(manuscript)** = 장별 파일, 전체 원고, 최종 검사·요약 보고서. (`manuscript/`)

즉 작가는 **작품 목표와 검토·수정 판단**에 집중하고, AI가 outline, 씬 시드, 초안, 검수 보고서, 조립 원고를 차례로 만듭니다.

---

## 2. 처음 10분 (빠른 시작)

1. VSCode에서 **빈 폴더 하나를 엽니다.** (이 폴더 = 소설 한 편)
2. 명령 팔레트에서 **`Storyboard: Initialize Project`** 실행.
   → `character/ background/ scene/ draft/` 폴더와 샘플 파일, `.storyboard/project.json`이 생깁니다.
   → 왼쪽 활동 막대에 **Characters / Backgrounds / Scenes** 패널 3개가 나타납니다.
3. (선택) AI를 진짜로 쓰려면 **`Storyboard: Set API Key...`** 로 키를 넣습니다.
   키가 없어도 됩니다 — 기본 제공자는 `mock`이라 **키 없이 가짜 초안으로 전체 흐름을 연습**할 수 있습니다.
4. **`Storyboard: Open Settings`** → **작품 계약** 탭에서 장르, 독자층, 시점, 목표 분량을 채웁니다.
5. 빠른 자동 흐름을 보려면 **`Storyboard: Generate Novel`** 실행 → 실행 모드 선택.
   - 전체 자동: outline부터 원고 조립·검사·요약까지 한 번에 진행.
   - 아웃라인 승인 후 진행: `synopsis.md` / `chapters.yaml`을 검토한 뒤 계속.
   - 장별 승인 후 진행: 각 장 초안·검수 뒤 다음 장 진행 여부 확인.
6. 수동 흐름을 쓰려면 **Characters 패널의 `+`** 로 카드 작성 → **Scenes 패널의 `+`** 로 씬 작성 → 씬 파일 위쪽의 **`Generate Draft`** 실행.

여기까지가 한 바퀴입니다. 아래는 각 단계를 자세히 설명합니다.

---

## 3. 단계별 작업 흐름

### 0) 프로젝트 초기화

`Storyboard: Initialize Project` 한 번이면 끝입니다. 만들어지는 것:

```
내소설/
├── .storyboard/project.json   # 프로젝트 설정 (제목, 형식, 언어)
├── character/  background/  scene/  draft/
├── .gitignore                 # 초안·캐시·샘플은 버전관리 제외
└── README.md
```

- 기본 형식은 **소설(novel)**, 언어는 **한국어(ko)** 입니다. 시나리오·희곡·에세이·시로 바꾸려면
  `.storyboard/project.json`의 `format`을 `screenplay | play | essay | poem`으로 수정하세요.
- 샘플 카드/씬(`.sample.*`)은 예시용이며 실제 작업에는 영향을 주지 않습니다.

### 1) AI 준비

- **`Storyboard: Set API Key...`** → 제공자(OpenAI / Claude / Google / Ollama) 선택 → 키 입력.
  키는 VSCode 비밀 저장소에만 저장되고 설정 파일에 노출되지 않습니다.
- **`Storyboard: Open Settings`**(사이드바 톱니바퀴) → 기본 제공자와 **작업별 모델**을 고를 수 있습니다.
  예: 대사는 Claude, 문법 검사는 OpenAI처럼 작업마다 다른 모델을 쓸 수 있습니다.
- **처음엔 `mock`으로 연습**하세요. 키·비용 없이 모든 버튼이 동작합니다(초안 내용은 자리표시자).
- Ollama를 쓰면 로컬에서 무료로 돌릴 수도 있습니다(설정에서 `baseUrl`/모델 지정).

### 2) 작품 계약과 장편 자동 생성

- **`Storyboard: Open Settings`** → **작품 계약** 탭에서 아래 필드를 채웁니다.
  - 필수: 장르, 독자층, 시점, 목표 분량
  - 선택: 컨셉, 설명, 태그, 금지 조건, 문체 제약, 품질 기준
- **`Storyboard: Generate Novel Outline`** 은 `.storyboard/outline/synopsis.md`와 `chapters.yaml`을 만듭니다.
- **`Storyboard: Generate Scene Seeds`** 는 `chapters.yaml`에서 `scene/NN-slug.txt`를 생성합니다.
  생성된 시드에는 목적, 갈등, 반전, 감정 변화, 회수할 복선, 필요 설정, 목표 분량이 들어갑니다.
- **`Storyboard: Generate Novel`** 은 outline 생성, 씬 시드 생성, 장별 초안·검수·재작성, 원고 조립, 최종 검사, 장별 요약까지 이어서 실행합니다.
  중간에 취소하거나 실패하면 `.storyboard/cache/novel-run.json`에 진행 상태가 남고, 다시 실행하면 이어서 진행할 수 있습니다.
- `chapters.yaml`을 수정하면 Scenes 사이드바가 해당 씬에 **outline** 배지를 표시해 outline보다 오래된 씬임을 알려 줍니다.

자동 생성 산출물:

```text
.storyboard/outline/synopsis.md
.storyboard/outline/chapters.yaml
.storyboard/outline/revision-plan.yaml
scene/NN-slug.txt
draft/NN-slug.md
manuscript/NN-chapter.md
manuscript/manuscript.md
manuscript/REVIEW.md
manuscript/SUMMARY.md
manuscript/FORESHADOWING.md
```

### 3) 캐릭터·배경 카드 만들기

- **Characters / Backgrounds 패널의 `+`** 버튼으로 카드를 추가하면 **카드 에디터**가 열립니다.
  - 탭: 캐릭터는 **Overview / Story / Relations / YAML**, 배경은 **Overview / YAML**. 폼으로 채우거나
    YAML을 직접 편집할 수 있습니다.
  - 캐릭터: 이름, 역할(주연/조연/단역), 프로필(성격), **특성**(Story 탭의 traits), 설명,
    **관계**(Relations 탭에서 다른 인물과의 관계) 등.
  - 배경: 종류(장소/시간/사회), 설명, **관련 인물**(Overview에서 캐릭터 목록으로 선택) 등.
- 카드 이름(id)을 바꾸려면 사이드바 항목의 **이름 변경 아이콘**(또는 `.card` 우클릭 → Rename)을 쓰세요.
  참조도 함께 갱신됩니다.

> 팁: 초안에 등장하는 인물 이름 위에 마우스를 올리면 **카드 미리보기**가 뜹니다.

### 4) 씬 쓰기

- **Scenes 패널의 `+`** → 슬러그 입력 → `scene/NN-slug.txt` 생성.
- 씬 파일은 **앞머리(frontmatter) + 본문**으로 구성됩니다:

```text
---
title: 학교에 도착하다
characters: [elia, jihoon]   # 등장인물 카드 id
location: school             # 배경 카드 id
mood: 설렘
---
엘리아가 학교 정문 앞에 선다. 깊게 숨을 들이쉬고, 친구 지훈을 발견한다.
```

- 본문에는 **"무슨 일이 일어나는지"를 짧게** 적으면 됩니다. 완성된 문장이 아니어도 됩니다.
- `characters`를 적지 않으면 본문에서 인물 이름을 자동으로 찾아냅니다.
- 파일명 앞 번호(`01-`, `02-`)가 **읽는 순서**입니다.

### 5) 초안 생성

- 씬 파일을 연 상태에서 상단 **`Generate Draft`**(또는 Scenes 패널의 생성 버튼)를 누르면
  `draft/NN-slug.md`가 만들어집니다.
- 내부적으로 **상황 추출 → 페르소나 준비 → 대화 생성 → 장르 포맷 적용**의 4단계를 거칩니다(서술 정리는 마지막 포맷 단계에 포함).
- **`Generate All Drafts`** 로 모든 씬을 한 번에 처리할 수 있습니다.
- 같은 입력이면 **캐시된 초안**을 재사용합니다. 강제로 다시 만들려면 **`Re-generate`** 를 누르세요.

### 6) 초안 다듬기

`draft/*.md`를 열면 문서 맨 위에 버튼(CodeLens)이 보입니다:

| 버튼 | 하는 일 |
|---|---|
| 🔁 Re-generate Draft | 연결된 씬 기준으로 초안 다시 생성 |
| 🩹 Grammar Check | 문법·맞춤법 진단(밑줄) + Quick Fix |
| 🧭 Continuity Check | **설정 바이블과 모순되는 부분** 진단 (아래 7번) |
| 🌿 Expand | 선택한 문장을 문체를 유지한 채 확장 |

명령 팔레트의 **`Storyboard: Review & Revise Draft (Current Scene)`** 을 실행하면 연속성·비평 검수 후 차단 이슈를 재작성하고 결과를 기록합니다.

이 밖에 타이핑 중 **자동 완성(Ghost Text)** 제안, 인물 이름 **Hover 카드**도 동작합니다.
자세한 내용은 [`GUIDE.md`](GUIDE.md).

### 7) 설정 일관성 — 스토리 바이블 루프 ⭐

장편(여러 권)에서 가장 어려운 건 **앞뒤 설정이 어긋나지 않게** 하는 것입니다. Storyboard는 이걸
"AI가 제안하고 작가가 확정하는" 루프로 돕습니다.

```
①초안 생성 → ②설정 사실 후보 자동 추출 → ③작가가 canon 승격 → ④이후 생성에 주입 + 연속성 검사
```

1. **자동 추출**: 초안을 만들 때마다 AI가 인물의 *고정 설정*(눈동자 색, 나이, 능력 등)을 **후보(candidate)** 로
   뽑아 둡니다. (아직 본문에 영향 없음)
2. **승격(확정)**: **`Storyboard: Promote Bible Candidates to Canon`** 명령을 실행하면 후보 목록이 뜹니다.
   맞는 것만 골라 **canon으로 승격**하면 `.storyboard/bible/canon.yaml`에 저장됩니다.
3. **주입**: 이후 씬을 생성하면, 그 씬에 나오는 인물·배경의 **확정 설정만 골라** AI에게 함께 전달합니다.
   → 7권에서도 1권의 "녹색 눈"이 유지됩니다.
4. **연속성 검사**: 초안에서 **`🧭 Continuity Check`** 를 누르면 본문이 확정 설정과 어긋나는 구간을
   경고로 표시합니다(예: 설정은 "녹색"인데 본문에 "파란 눈").

> **중요**: 작가가 **승격한 설정(canon)만** 생성·검사에 쓰입니다. AI의 후보는 제안일 뿐이라, 검토 전에는
> 본문에 영향을 주지 않습니다. 설정을 손으로 직접 적고 싶으면 `.storyboard/bible/canon.yaml`을 편집해도 됩니다.

설정 바이블을 직접 적는 형식 예시는 [`ARCHITECTURE.md`](ARCHITECTURE.md)의 4.7절을 참고하세요.

### 8) 원고 조립·검사·내보내기

원클릭 생성을 쓰지 않고 수동으로 초안을 만든 경우에도 원고 단계 명령을 따로 실행할 수 있습니다.

- **`Storyboard: Assemble Manuscript`**: `chapters.yaml` 순서로 `draft/*.md`를 장별 파일과 `manuscript/manuscript.md`로 조립합니다.
- **`Storyboard: Review Manuscript`**: 전체 조립 원고를 canon 연속성·캐릭터 보이스·장면 목적·반복 기준으로 검사해 `manuscript/REVIEW.md`를 만듭니다.
- **`Storyboard: Summarize Chapters`**: 장별 요약과 이전 장 recap을 `manuscript/SUMMARY.md`로 만듭니다.
- **`Storyboard: Canon Diff Report`**: 아직 canon으로 승격하지 않은 설정 후보를 `manuscript/CANON.md`에 정리합니다.
- **`Storyboard: Export Draft…`**: `manuscript/manuscript.md`를 Markdown 또는 일반 텍스트로 내보냅니다.

### 9) 인물 관계 보기

- **`Storyboard: Open Character Relation Graph`** → 인물 관계를 그래프로 시각화합니다.
  노드를 더블클릭하면 해당 카드가 열립니다. (관계는 캐릭터 카드의 Relations 탭에서 입력)

### 10) 백업·공유 (.seed)

- **`Storyboard: Export Project to Seed...`** → 프로젝트를 `.seed` 아카이브 한 파일로 내보냅니다(변경 이력 포함).
- 받은 `.seed`는 **`Create Project from Seed...`**(새 프로젝트) 또는 **`Sync Project from Seed...`**
  (기존에 병합, 탐색기에서 `.seed` 우클릭)로 가져옵니다.
- 초안·캐시·후보는 재생성 가능하므로 `.seed`에 포함되지 않습니다. 정책: [`STORYBOARD_ALIGNMENT.md`](STORYBOARD_ALIGNMENT.md).

---

## 4. 추천 작업 순서 (한 권 쓰기)

```
1. Initialize Project
2. (mock으로 먼저 연습 → 익숙해지면) Set API Key
3. Open Settings → 작품 계약 채우기
4. 주요 인물·배경 카드 작성
5. Generate Novel Outline → synopsis.md / chapters.yaml 검토
6. Generate Novel 또는 Generate Scene Seeds + Generate All Drafts
7. Review & Revise / Promote Bible Candidates로 초안과 canon 정리
8. Assemble / Review / Summarize Manuscript
9. Export Draft 또는 Export to Seed로 내보내기·공유
```

---

## 5. 명령어 한눈에

한국어 VS Code에서는 명령 제목이 한국어로 보일 수 있습니다.

| 명령 (명령 팔레트에서 검색) | 용도 |
|---|---|
| `Storyboard: Initialize Project` | 현재 폴더를 프로젝트로 초기화 |
| `Storyboard: Set API Key...` | AI 제공자 키 저장 |
| `Storyboard: Open Settings` | 기본 제공자·작업별 모델 설정 |
| `Storyboard: Generate Novel` | outline부터 조립 원고·검사·요약까지 실행 |
| `Storyboard: Generate Novel Outline` | `synopsis.md`와 `chapters.yaml` 생성 |
| `Storyboard: Generate Scene Seeds` | `chapters.yaml`에서 `scene/*.txt` 생성 |
| `Storyboard: Create Character` / `Create Background` | 카드 추가 |
| `Storyboard: Rename Character ID...` / `Rename Background ID...` | 카드 id 변경 |
| `Storyboard: New Scene` | 다음 번호로 씬 파일 생성 |
| `Storyboard: Generate Draft (Current Scene)` | 현재 씬 초안 생성 |
| `Storyboard: Regenerate Draft (Current Scene)` | 캐시 무시하고 다시 생성 |
| `Storyboard: Generate All Drafts` | 모든 씬 일괄 생성 |
| `Storyboard: Apply Format to Draft (Current Scene)` | 생성 없이 장르 포맷만 다시 적용 |
| `Storyboard: Grammar Check (Draft)` | 문법 진단 |
| `Storyboard: Continuity Check (Draft)` | 설정 일관성 진단 |
| `Storyboard: Review & Revise Draft (Current Scene)` | 초안 검수·재작성 루프 |
| `Storyboard: Expand Selection (Draft)` | 선택 영역 확장 |
| `Storyboard: Promote Bible Candidates to Canon` | 설정 후보를 canon으로 승격 |
| `Storyboard: Assemble Manuscript` | 초안을 장별·전체 원고로 조립 |
| `Storyboard: Review Manuscript` | 조립 원고 최종 검사 보고서 생성 |
| `Storyboard: Summarize Chapters` | 장별 요약과 recap 생성 |
| `Storyboard: Canon Diff Report` | 미승격 설정 후보 보고서 생성 |
| `Storyboard: Export Draft…` | 조립 원고를 Markdown/TXT로 내보내기 |
| `Storyboard: Open Character Relation Graph` | 관계 그래프 |
| `Storyboard: Create/Sync/Export ... Seed` | 프로젝트 가져오기/내보내기 |

---

## 6. 자주 묻는 질문

- **AI 키가 꼭 필요한가요?** 아니요. 기본 `mock` 제공자로 키 없이 전 과정을 연습할 수 있습니다.
  실제 글 품질이 필요할 때 키를 넣으세요.
- **초안을 직접 고쳐도 되나요?** 네. `draft/*.md`는 자유롭게 편집할 수 있습니다. 단, `Re-generate`를 누르면
  덮어써집니다. 보존하려면 별도 보관하세요.
- **Continuity Check가 아무것도 안 잡아요.** 그 씬 인물에 대한 **확정 설정(canon)** 이 없으면 검사를 건너뜁니다.
  먼저 `Promote Bible Candidates to Canon`으로 설정을 확정하세요.
- **Generate Novel이 바로 시작되지 않아요.** 작품 계약의 필수 항목(장르, 독자층, 시점, 목표 분량)이 비어 있으면 시작하지 않습니다.
  `Storyboard: Open Settings`의 **작품 계약** 탭을 먼저 채우세요.
- **사이드바가 안 보여요.** `Storyboard: Initialize Project`로 프로젝트를 만든 폴더에서만 패널이 나타납니다.
- **비용이 걱정돼요.** 사이드바에 작업별 **비용 배지**가 표시되고, 같은 입력은 캐시를 재사용합니다.
  연속성 검사는 자동이 아니라 **직접 실행할 때만** AI를 호출합니다.

---

## 7. 더 보기

- [`GUIDE.md`](GUIDE.md) — 초안 편집 기능(완성/문법/확장/연속성) 사용법
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — 폴더·파일 포맷·명령·설정 키 전체
- [`STORYBOARD_ALIGNMENT.md`](STORYBOARD_ALIGNMENT.md) — `.seed` 교환 정책
- [`EXTENSION_QA.md`](EXTENSION_QA.md) — 수동 점검 체크리스트
