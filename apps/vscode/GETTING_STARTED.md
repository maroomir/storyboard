# Storyboard 시작 가이드 (작가용)

처음 쓰는 작가를 위한 **끝까지 따라 하는** 안내서입니다. 코드를 몰라도 됩니다.
명령은 모두 명령 팔레트(`Cmd/Ctrl + Shift + P`)에서 이름으로 검색해 실행할 수 있고,
자주 쓰는 것은 사이드바 버튼으로도 있습니다.

> 더 자세한 초안 편집 기능은 [`GUIDE.md`](GUIDE.md), 내부 구조·파일 포맷은 [`ARCHITECTURE.md`](../../ARCHITECTURE.md)를 보세요.

---

## 1. Storyboard는 무엇인가요?

Storyboard는 **소설을 "작품 계약 → outline → 씬 → 초안 → 원고"의 흐름으로 쓰도록 돕는 VSCode 확장**입니다. 핵심 사고방식:

- **작품 계약(generation contract)** = 장르·독자층·시점·목표 분량·금지 조건·문체/품질 기준. 자동 생성의 입력입니다.
- **outline** = 시놉시스와 장 계획. (`.storyboard/outline/`)
- **카드(card)** = 등장인물·배경 같은 *설정 자료*. 폴더 하나(번들)에 머리말과 진술이 들어 있습니다. (`character/<slug>.card/`, `background/<slug>.card/`)
- **씬(scene)** = "여기서 무슨 일이 일어나는가"를 적은 *장면 시드*. 이것도 번들입니다. (`scene/NNN-slug.card/`)
- **초안(draft)** = AI가 씬과 카드를 읽고 만들어 주는 *원고*. (`draft/NNN-slug.md`)
- **사실(fact)** = "엘리아의 눈은 녹색" 같은 *확정 설정*. 인물·장소 카드의 `fact` 진술로 적고, 장편에서 앞뒤 일관성을 지켜 줍니다.
- **스튜디오(Storyboard · Studio)** = 카드와 씬을 말로 만들고 고치는 사이드바 패널.
- **조립 원고(manuscript)** = 장별 파일, 전체 원고, 최종 검사·요약 보고서. (`manuscript/`)

즉 작가는 **작품 목표와 검토·수정 판단**에 집중하고, AI가 outline, 씬 시드, 초안, 검수 보고서, 조립 원고를 차례로 만듭니다.

---

## 2. 처음 10분 (빠른 시작)

1. VSCode에서 **빈 폴더 하나를 엽니다.** (이 폴더 = 소설 한 편)
2. 명령 팔레트에서 **`Storyboard: Initialize Project`** 실행.
   → `character/ background/ scene/ draft/` 폴더와 `.storyboard/project.json`이 생깁니다.
   → 왼쪽 활동 막대에 **Characters / Backgrounds / Scenes** 패널과 **Storyboard · Studio** 패널이 나타납니다.
3. AI 제공자를 고릅니다. 처음에는 아무것도 고르지 않은 상태라 **고르기 전에는 생성이 실행되지 않습니다.**
   상태바의 제공자 항목이나 알림의 버튼으로 고르세요. 연습만 하려면 `Mock`을 고르면 키 없이 가짜 초안으로 전체 흐름을 돌려 볼 수 있습니다.
   실제 제공자를 고르면 API 키를 묻습니다(**`Storyboard: Set API Key...`** 로 나중에 바꿀 수 있습니다).
4. **`Storyboard: Open Settings`** → **작품 계약** 탭에서 장르, 독자층, 시점, 목표 분량을 채웁니다.
5. 빠른 자동 흐름을 보려면 **`Storyboard: Generate Novel`** 실행 → 실행 모드 선택.
   - 전체 자동: outline부터 원고 조립·검사·요약까지 한 번에 진행.
   - 아웃라인 승인 후 진행: `synopsis.md` / `chapters.yaml`을 검토한 뒤 계속.
   - 장별 승인 후 진행: 각 장 초안·검수 뒤 다음 장 진행 여부 확인.
   - 최종 검사 후 재작성 승인: 전권 검사가 찾은 high 이슈를 재작성하기 전에 대상 씬을 보여 주고 확인.
6. 수동 흐름을 쓰려면 **Characters 패널의 `+`** 로 카드 만들기 → **Scenes 패널의 `+`** 로 씬 만들기 → 씬을 연 채 **`Generate Draft`** 실행.

여기까지가 한 바퀴입니다. 아래는 각 단계를 자세히 설명합니다.

---

## 3. 단계별 작업 흐름

### 0) 프로젝트 초기화

`Storyboard: Initialize Project` 한 번이면 끝입니다. 만들어지는 것:

```
내소설/
├── .storyboard/project.json   # 작품 계약 (제목, 형식, 언어, 장르 …)
├── character/  background/  scene/  draft/
├── .gitignore                 # 캐시는 버전관리 제외
├── README.md                  # 폴더 구조 설명
└── AGENTS.md  CLAUDE.md       # 다른 AI 에이전트가 이 작품을 다룰 때의 규칙
```

- 기본 형식은 **소설(novel)**, 언어는 **한국어(ko)** 입니다. 시나리오·희곡·에세이·시로 바꾸려면
  `.storyboard/project.json`의 `format`을 `screenplay | play | essay | poem`으로 수정하세요.
- 씬을 만들면 `.storyboard/structure.yaml`(씬 순서와 줄기)이 생기고, 생성이 돌면 `.storyboard/cache/`(캐시 DB 등)가 생깁니다.
- 0.15 이전 형식의 작품은 «0.15 형식»이라는 안내와 함께 열리지 않습니다. 그 작품은 0.15.x로 계속 쓰세요.

### 1) AI 준비

- **`Storyboard: Set API Key...`** → 제공자(OpenAI / Claude / Google / Grok) 선택 → 키 입력.
  키는 `~/.storyboard/secrets.json`(본인만 읽을 수 있는 권한)에 저장되어 CLI와 공유되고, 작품 폴더에는 남지 않습니다.
- **`Storyboard: Open Settings`**(사이드바 톱니바퀴) → 기본 제공자와 **작업별 모델**을 고를 수 있습니다.
  예: 대사는 Claude, 문법 검사는 OpenAI처럼 작업마다 다른 모델을 쓸 수 있습니다.
- **처음엔 `mock`으로 연습**하세요. 키·비용 없이 모든 버튼이 동작합니다(초안 내용은 자리표시자).
- Ollama를 쓰면 로컬에서 무료로 돌릴 수도 있습니다(설정에서 `baseUrl`/모델 지정).

### 2) 작품 계약과 장편 자동 생성

- **`Storyboard: Open Settings`** → **작품 계약** 탭에서 아래 필드를 채웁니다.
  - 필수: 장르, 독자층, 시점, 목표 분량
  - 선택: 컨셉, 설명, 태그, 금지 조건, 문체 제약, 품질 기준
- **`Storyboard: Generate Novel Outline`** 은 `.storyboard/outline/synopsis.md`와 `chapters.yaml`을 만듭니다.
- **`Storyboard: Generate Scene Seeds`** 는 outline의 장 계획에서 `scene/NNN-slug.card/` 씬 번들을 만듭니다.
  씬 번들에는 목적, 갈등, 반전, 감정 변화, 종료 지점, 회수할 복선 같은 설계 진술과 비트가 들어갑니다.
- **`Storyboard: Generate Novel`** 은 outline 생성, 씬 시드 생성, 장별 초안·검수·재작성, 원고 조립, 최종 검사, 검사 결과 재작성, 재검사, 장별 요약까지 이어서 실행합니다.
  최종 검사는 전권을 한 번에 읽으므로 씬 단위 검사가 못 보는 장거리 모순을 찾습니다. high 이슈가 나오면 해당 씬만 재작성한 뒤 전권을 다시 검사해 `REVIEW.md`를 다시 쓰고, high 가 남으면 `revise.loop.maxIterations` 회까지 되풀이합니다.
  중간에 취소하거나 실패하면 진행 상태가 캐시 DB(`.storyboard/cache/storyboard.db`)에 남고, 다시 실행하면 이어서 진행할 수 있습니다.
- `chapters.yaml`을 수정하면 Scenes 사이드바가 해당 씬에 **outline** 배지를 표시해 outline보다 오래된 씬임을 알려 줍니다.

자동 생성 산출물:

```text
.storyboard/outline/synopsis.md
.storyboard/outline/chapters.yaml
.storyboard/structure.yaml
scene/NNN-slug.card/            # card.yaml · statements.yaml · beats.yaml · dialogue.json · state.yaml
draft/NNN-slug.md
manuscript/NN-chapter.md
manuscript/manuscript.md
manuscript/REVIEW.md
manuscript/FORESHADOWING.md
```

수정 계획과 장별 요약은 캐시 DB에 들어가므로 파일로 보이지 않습니다.

### 3) 캐릭터·배경 카드 만들기

- **Characters / Backgrounds 패널의 `+`** 를 누르면 **스튜디오**가 «어떤 캐릭터를 만드시겠어요?»로 열립니다.
  설명을 한 번 적어 보내면 번들(`character/<slug>.card/`)이 만들어지고, 스튜디오가 설명으로 빈 칸을 채운 뒤 카드가 열립니다.
  이름과 slug는 설명에서 읽습니다(못 읽으면 «새 인물»·«새 배경», 겹치면 번호가 붙습니다).
- **카드 뷰어**는 읽기 전용입니다. 머리말 한 줄(비중·나이·별칭)과 진술을 섹션(성격·말투·관계·변화·묘사·사실, 배경은 분위기·감각·배치·규칙)으로 묶어 보여 줍니다.
  - **«스튜디오에서 고치기»**: 스튜디오로 가서 "말투를 더 거칠게" 같은 지시로 고칩니다. 제안이 바뀔 줄을 보여 주고, **«적용»**해야 카드에 반영됩니다.
  - **«텍스트로 열기»**: `card.yaml`과 `statements.yaml`을 일반 편집기로 엽니다. 손으로 고치면 «엔진 밖에서 바뀐 카드» 경고가 붙을 수 있으니, 되도록 스튜디오를 쓰세요.
- **인터뷰**: 카드를 연 채 스튜디오 머리의 «인터뷰»를 누르면 다가올 씬의 사건마다 이 인물(장소)이 어떻게 하는지 세 안 중에서 고르게 합니다. 고른 선택의 패턴이 카드의 제안으로 쌓이고, **«기다리는 제안»** 띠에서 **«적용»**하거나 **«버림»**합니다.
- 카드 이름(slug)을 바꾸려면 사이드바 항목의 **이름 변경 아이콘**(또는 번들 폴더 이름 바꾸기)을 쓰세요. 카드끼리의 참조는 uuid라 따로 고칠 곳이 없습니다.
- 카드를 지우려면 사이드바 항목의 휴지통을 누릅니다. 그 카드를 가리키는 곳의 수와 함께 지울 줄을 먼저 보여 주고, «삭제하고 함께 정리»를 누르면 번들과 참조가 함께 정리됩니다.

> 팁: 초안에 등장하는 인물 이름 위에 마우스를 올리면 **카드 미리보기**가 뜹니다.

### 4) 씬 쓰기

- **Scenes 패널의 `+`** → 스튜디오가 «어떤 씬을 만드시겠어요?»로 열립니다. 설명을 보내면 맨 뒤 번호로 `scene/NNN-slug.card/` 씬 번들이 만들어집니다.
- 씬 번들은 파일 여럿으로 이루어집니다.
  - `card.yaml`: 제목, 출연(인물 카드), 장소(배경 카드), 시간, 목표 분량
  - `statements.yaml`: 목적·갈등·반전·감정 변화·종료 지점·회수할 복선
  - `beats.yaml`: 비트(사건 단위) 목록. 비트마다 출연·장소·시간을 달 수 있습니다.
  - 그 밖에 `dialogue.json`, `state.yaml`, `summary.md`는 생성이 채웁니다.
- 씬 `card.yaml`을 열면 읽기 전용 뷰어에 설계가 보입니다. 고치려면 «스튜디오에서 고치기»로 가서 "종료 지점을 …로" 처럼 지시하세요.
- 본문에는 **"무슨 일이 일어나는지"를 짧게** 적으면 됩니다. 완성된 문장이 아니어도 됩니다.
- 번호(`001-`, `002-`)가 **읽는 순서**이고 `.storyboard/structure.yaml`의 순서에서 나옵니다. 이름(slug)을 바꾸려면 **`Storyboard: Rename Scene...`** 을 쓰세요. 번호는 이름 바꾸기로 바뀌지 않습니다.

### 5) 초안 생성

- 씬을 연 상태에서 **`Generate Draft`**(또는 Scenes 패널의 생성 버튼)를 누르면
  `draft/NNN-slug.md`가 만들어집니다.
- 내부적으로 **뼈대 → 대사 다듬기 → 구간 살붙임 → 기계 검증**의 4단계를 거칩니다.
- **`Generate All Drafts`** 로 모든 씬을 한 번에 처리할 수 있습니다.
- 같은 입력이면 **캐시된 초안**을 재사용합니다. 강제로 다시 만들려면 **`Re-generate`** 를 누르세요.
- 덮어쓰기 직전의 초안은 캐시(`.storyboard/cache/revisions/`)에 씬마다 최근 10판까지 남습니다.

### 6) 초안 다듬기

`draft/*.md`를 열면 **Storyboard · Studio** 패널(액티비티바, 우측 패널로 이동 가능)에서 항상 보이는 버튼으로 다음을 실행할 수 있습니다:

| 버튼 | 하는 일 |
|---|---|
| Regenerate | 연결된 씬 기준으로 초안 다시 생성 |
| Grammar Check | 문법·맞춤법 진단(밑줄) + Quick Fix |
| Continuity Check | **카드의 사실(`fact`)과 모순되는 부분** 진단 (아래 7번) |
| Expand / Update Selection | 선택한 영역을 문체 유지한 채 확장/보충 |
| Edit Selection | 입력란에 지시문을 적어 선택 영역 수정 |

명령 팔레트의 **`Storyboard: Review & Revise Draft (Current Scene)`** 을 실행하면 연속성·비평 검수 후 차단 이슈를 재작성하고 결과를 기록합니다.

이 밖에 타이핑 중 **자동 완성(Ghost Text)** 제안, 인물 이름 **Hover 카드**도 동작합니다.
자세한 내용은 [`GUIDE.md`](GUIDE.md).

### 7) 설정 일관성 — 카드의 사실(`fact`) ⭐

장편에서 가장 어려운 건 **앞뒤 설정이 어긋나지 않게** 하는 것입니다. Storyboard는 확정 설정을 **인물·장소 카드의 `fact` 진술**로 둡니다. 별도의 설정집 파일은 없습니다.

```
①카드에 사실 적기 → ②씬 생성에 주입 → ③연속성 검사
```

1. **적기**: 스튜디오("엘리아의 눈은 녹색이야"), 인터뷰, 노트 흡수, 또는 CLI `card set`이 카드의 `statements.yaml`에 사실 한 줄을 씁니다.
   AI가 낸 제안은 **«기다리는 제안»** 띠에서 **«적용»**해야 카드에 들어갑니다.
2. **주입**: 이후 씬을 생성하면, 그 씬에 나오는 인물·배경 카드의 사실만 골라 AI에게 함께 전달합니다.
   → 7권에서도 1권의 "녹색 눈"이 유지됩니다. 사실에는 참이 되는 시점과 밝혀지는 시점을 따로 둘 수 있어, 결말 반전이 초반에 새지 않습니다.
3. **연속성 검사**: 초안에서 **`Continuity Check`** 를 누르면 본문이 카드의 사실과 어긋나는 구간을 경고로 표시합니다(예: 설정은 "녹색"인데 본문에 "파란 눈").

> **중요**: 카드에 **적용된 사실만** 생성·검사에 쓰입니다. AI의 제안은 적용하기 전에는 본문에 영향을 주지 않습니다.
> 초안을 만들 때 AI가 카드를 몰래 고치는 일도 없습니다.

### 8) 원고 조립·검사·내보내기

원클릭 생성을 쓰지 않고 수동으로 초안을 만든 경우에도 원고 단계 명령을 따로 실행할 수 있습니다.

- **`Storyboard: Assemble Manuscript`**: `chapters.yaml` 순서로 `draft/*.md`를 장별 파일과 `manuscript/manuscript.md`로 조립합니다.
- **`Storyboard: Review Manuscript`**: 전체 조립 원고를 카드 사실과의 연속성·캐릭터 보이스·장면 목적·반복 기준으로 검사해 `manuscript/REVIEW.md`를 만듭니다.
- **`Storyboard: Summarize Chapters`**: 장별 요약과 이전 장 recap을 만들어 새 편집기 창에 보여 줍니다(요약은 캐시 DB에 저장).
- **`Storyboard: Export Draft…`**: `manuscript/manuscript.md`를 Markdown 또는 일반 텍스트로 내보냅니다.

### 9) 인물 관계 보기

- **`Storyboard: Open Character Relation Graph`** → 인물 관계를 그래프로 시각화합니다.
  관계는 인물 카드의 `관계` 진술에서 옵니다(스튜디오나 인터뷰로 채웁니다).

---

## 4. 추천 작업 순서 (한 권 쓰기)

```
1. Initialize Project
2. AI 제공자 고르기 (mock으로 먼저 연습 → 익숙해지면 Set API Key)
3. Open Settings → 작품 계약 채우기
4. 주요 인물·배경 카드 만들기 (+ → 설명 한 번, 필요하면 인터뷰)
5. Generate Novel Outline → synopsis.md / chapters.yaml 검토
6. Generate Novel 또는 Generate Scene Seeds + Generate All Drafts
7. Review & Revise로 초안 정리, 기다리는 제안은 카드에서 적용·버림
8. Assemble / Review / Summarize Manuscript
9. Export Draft로 내보내기·공유
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
| `Storyboard: Generate Scene Seeds` | outline에서 `scene/*.card` 씬 번들 생성 |
| `Storyboard: Create Character` / `Create Background` | 스튜디오에서 설명으로 카드 만들기 |
| `Storyboard: Rename Character ID...` / `Rename Background ID...` | 카드 slug 변경 |
| `Storyboard: New Scene` | 스튜디오에서 설명으로 씬 만들기 |
| `Storyboard: Rename Scene...` | 씬 이름(slug) 변경 |
| `Storyboard: Generate Draft (Current Scene)` | 현재 씬 초안 생성 |
| `Storyboard: Regenerate Draft (Current Scene)` | 캐시 무시하고 다시 생성 |
| `Storyboard: Generate All Drafts` | 모든 씬 일괄 생성 |
| `Storyboard: Apply Format to Draft (Current Scene)` | 생성 없이 장르 포맷만 다시 적용 |
| `Storyboard: Grammar Check (Draft)` | 문법 진단 |
| `Storyboard: Continuity Check (Draft)` | 설정 일관성 진단 |
| `Storyboard: Review & Revise Draft (Current Scene)` | 초안 검수·재작성 루프 |
| `Storyboard: Expand Selection (Draft)` | 선택 영역 확장 |
| `Storyboard: Absorb Notes…` | Obsidian·Notion 노트를 카드·씬·시놉시스로 흡수 |
| `Storyboard: Build Cards from Scenes` | 씬에서 신규·보강 카드 제안 |
| `Storyboard: Complete Story Scenes` | 끝번호 뒤에 완결 씬 제안 |
| `Storyboard: Assemble Manuscript` | 초안을 장별·전체 원고로 조립 |
| `Storyboard: Review Manuscript` | 조립 원고 최종 검사 보고서 생성 |
| `Storyboard: Summarize Chapters` | 장별 요약과 recap 생성 |
| `Storyboard: Export Draft…` | 조립 원고를 Markdown/TXT로 내보내기 |
| `Storyboard: Open Character Relation Graph` | 관계 그래프 |

---

## 6. 자주 묻는 질문

- **AI 키가 꼭 필요한가요?** 아니요. `mock` 제공자를 고르면 키 없이 전 과정을 연습할 수 있습니다.
  실제 글 품질이 필요할 때 키를 넣으세요. 제공자를 하나도 고르지 않으면 생성이 실행되지 않습니다.
- **초안을 직접 고쳐도 되나요?** 네. `draft/*.md`는 자유롭게 편집할 수 있습니다. 다만 `Re-generate`를 누르면
  덮어써집니다. 덮어쓰기 직전의 초안은 씬마다 최근 10판까지 캐시에 남지만, 보존하려면 별도 보관하세요.
- **카드 파일을 직접 고쳐도 되나요?** 되도록 스튜디오를 쓰세요. 번들 파일을 손으로 고치면 엔진 밖에서 바뀐 카드로 경고하며 읽고, 폴더 이름·uuid를 건드리면 `storyboard doctor`가 알립니다.
- **Continuity Check가 아무것도 안 잡아요.** 그 씬 인물·장소 카드에 적힌 **사실(`fact`)** 이 없으면 검사를 건너뜁니다.
  카드에 사실을 먼저 적으세요(스튜디오나 «기다리는 제안»의 «적용»).
- **Generate Novel이 바로 시작되지 않아요.** 작품 계약의 필수 항목(장르, 독자층, 시점, 목표 분량)이 비어 있으면 시작하지 않습니다.
  `Storyboard: Open Settings`의 **작품 계약** 탭을 먼저 채우세요.
- **사이드바가 안 보여요.** `Storyboard: Initialize Project`로 프로젝트를 만든 폴더에서만 패널이 나타납니다.
- **비용이 걱정돼요.** 사이드바에 작업별 **비용 배지**가 표시되고, 같은 입력은 캐시를 재사용합니다.
  연속성 검사는 자동이 아니라 **직접 실행할 때만** AI를 호출합니다.

---

## 7. 더 보기

- [`GUIDE.md`](GUIDE.md) — 초안 편집 기능(완성/문법/확장/연속성) 사용법
- [`ARCHITECTURE.md`](../../ARCHITECTURE.md) — 폴더·파일 포맷·명령·설정 키 전체
- [`EXTENSION_QA.md`](EXTENSION_QA.md) — 수동 점검 체크리스트
