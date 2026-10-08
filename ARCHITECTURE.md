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

따라서 현재 구현은 기존 `scene/*.card → draft/*.md` 수동 흐름을 유지하면서, 작품 계약에서 outline, 씬 시드, 장별 초안·검수·재작성, 조립 원고, 최종 검사·요약까지 이어지는 초기 원클릭 파이프라인을 함께 제공한다. 아직 카드/바이블 자동 생성, 긴 원고의 고급 export, 더 정교한 배치 검수는 후속 확장 대상이다.

## 2. 멘탈 모델

- **워크스페이스 폴더 = 1 프로젝트 = 1 소설**.
  - 사용자가 `~/novels/MagicBoy/`를 VSCode로 열면, `MagicBoy` 라는 이름의 소설을 그곳에 적는다는 의미.
  - 멀티 프로젝트, 프로젝트 선택 화면은 존재하지 않는다.
- **프로젝트 설정 = 생성 계약**.
  - 장르, 국가, 컨셉, 태그, 설명, 독자층, 금지 조건, 목표 분량은 자동 생성 파이프라인의 입력 계약이다.
  - Storyboard는 계약을 바탕으로 outline, cards, bible, scene seed, draft를 차례로 만든다.
- **씬 = 파일**.
  - `scene/01-prologue.card` 한 파일이 한 씬.
  - 인라인 마커, 가상의 ID 시스템 없음. 파일명이 정렬과 식별을 동시에 책임진다.
  - 사용자가 직접 쓸 수도 있고, 장편 자동 생성 파이프라인이 outline에서 파생해 만들 수도 있다.
- **카드 = 자료**.
  - 캐릭터·배경 정보는 `.card` 파일 한 개에 한 자료. 내부는 YAML, VSCode에서는 커스텀 에디터가 카드 형태로 렌더링.
  - Characters / Backgrounds 사이드바 목록은 각 자료를 이미지 없는 컴팩트 카드 항목으로 보여 주며, 항목에서 열기와 삭제를 수행할 수 있다.
- **원고는 생성·검수·재작성되는 산출물**.
  - `project setting` → outline/card/bible/scene seed → AI 파이프라인 → `draft/*.md` → 검사/재작성 → 조립 원고.
  - `draft/`는 재생성 가능한 산출물이므로 기본적으로 Git에서 제외한다.
- **생성 = 에이전트 협업**.
  - 파이프라인은 역할이 다른 여러 에이전트(콘티·페르소나·드로잉·서술자·설정 키퍼·검수자)를 **결정적 코드**가 순서대로 호출해 진행한다. 자율적으로 도구를 부르는 LLM 루프가 아니라, 각 에이전트는 (역할 + 전용 provider/model + 메모리 + 입출력 계약)을 가진 모듈이다.
  - **카드 = 에이전트**. 캐릭터·배경 카드는 자료이자 그 카드를 연기·묘사하는 에이전트의 정체성이며, 결과는 디스크에 캐싱되어 씬 진행에 따라 진화한다.
  - 검수자가 이슈를 리포트하면 감독이 이슈를 **해당 서브 에이전트로 라우팅**해 부분만 재생성한 뒤 재검수한다. 상세는 §8.

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
│   ├── memory/                   # 재생성 불가능한 AI 기억 (git 추적)
│   │   ├── personas/             # 캐릭터별 페르소나 기억
│   │   │   └── elia.json
│   │   ├── backgrounds/          # 배경별 분위기 기억
│   │   │   └── school.json
│   │   ├── dialogue/             # 씬별 대사 사이드카
│   │   │   └── 01-prologue.json
│   │   ├── storyState.md         # 씬 간 이야기 상태 원장
│   │   └── summaries.md          # 장별 롤링 요약
│   └── cache/                    # AI 컨텍스트 캐시 (.gitignore)
│       ├── bible/                # 자동 추출된 설정 사실 후보 (candidate)
│       │   └── 01-prologue.json
│       ├── scenes/               # 씬별 생성 컨텍스트 스냅샷
│       │   └── 01-prologue.json
│       ├── grounding-gaps.json   # 사실 시트 제안에서 모델이 비워 둔 칸 (씬 본문·사실 시트·인물이 같으면 다시 묻지 않음)
│       ├── novel-run.json        # 원클릭 장편 생성 진행/재개 상태
│       └── run.lock              # 작업 잠금: 지금 이 작품을 고치고 있는 앱 (10초마다 갱신, 45초 끊기면 버려진 잠금)
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
│   ├── 01-prologue.card
│   ├── 02-chapter-01.card
│   └── 03-chapter-02.card
│
├── draft/                        # AI 생성 최종 원고 (추적)
│   ├── 01-prologue.md
│   ├── 02-chapter-01.md
│   └── 03-chapter-02.md
│
├── .draft/                       # 이전 초안 히스토리 (editor.draft.keepHistory, .gitignore)
│   └── 01-prologue/
│       └── 2026-06-07-09-03-rev-01.md
│
├── manuscript/                   # chapter/volume 조립 원고 (.gitignore)
│   ├── 01-prologue.md
│   └── manuscript.md
│
├── .gitignore                    # .storyboard/cache/, .draft/, manuscript/
├── README.md                     # 프로젝트 자유 노트
├── AGENTS.md                     # 코딩 에이전트 지침 (본문은 CLI로만, 없을 때만 생성)
└── CLAUDE.md                     # `@AGENTS.md` 한 줄 (Claude Code가 읽는 입구)
```

### 3.1 폴더 역할 요약

| 폴더 | 역할 | Git 추적 |
|---|---|---|
| `.storyboard/` | 프로젝트 메타 + 내부 저장소 | 하위 폴더별 정책 적용 |
| `.storyboard/bible/` | 스토리 바이블 정전 설정 | 추적 (사람이 확정한 설정) |
| `.storyboard/outline/` | 장편 시놉시스·챕터·씬 계획·재작성 계획 | 추적 |
| `.storyboard/memory/` | 재생성 불가능한 AI 기억 (이야기 상태, 페르소나·배경, 대사 사이드카, 장별 요약) | 추적 |
| `.storyboard/cache/` | 커밋된 입력으로 다시 만들 수 있는 AI 컨텍스트 스냅샷 | 제외 |
| `character/` | 캐릭터 카드 + 프로필 이미지 | 추적 |
| `background/` | 배경 카드 | 추적 |
| `scene/` | 사용자가 작성하는 시드 텍스트 | 추적 |
| `draft/` | AI가 생성한 원고 마크다운 | **제외** (재생성 가능) |
| `.draft/` | 덮어쓰기 전 이전 초안 히스토리 (`editor.draft.keepHistory` 활성 시) | **제외** (재생성 가능) |
| `manuscript/` | chapter/volume로 조립한 원고 | **제외** (재생성 가능) |
| `AGENTS.md`, `CLAUDE.md` | 작품 저장소에서 도는 코딩 에이전트가 본문을 직접 쓰지 않고 `storyboard` CLI를 거치게 하는 지침. 세 앱의 init이 없을 때만 쓰고 `storyboard init --repair`가 빠진 것만 채운다. 작가가 «작품 메모» 절을 채운다 | 추적 |

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

`setting.craftContract`는 생성 프롬프트에 항상 주입되는 작법 규칙이다. 설정하지 않아도 기본 계약이
걸리고, 넣은 항목만 덮어쓴다.

```jsonc
"craftContract": {
  "banTelling": true,            // 대사로 드러난 의미를 뒤이은 서술로 다시 설명하지 않기
  "motifRepeatLimit": 3,         // 같은 심상(예: "흐릿한 길") 반복 상한
  "stockGestureBlacklist": ["어깨가 떨렸다", "눈물이 뺨을 타고 흘렀다"],
  "requireCharacterInterior": true, // 조언·위로하는 인물도 자기 목적이나 결점을 드러내기
  "actionClarity": true,            // 동작·전투 대목의 인과를 한 번에 읽히게 쓰기
  "modulateDensity": true,          // 대목의 기능에 따라 문장 밀도를 조절하기
  "sceneLengthMultiplier": 12       // 목표 분량이 없는 씬의 기본 예산 = 씬 시드 길이 × 배수
}
```

`motifRepeatLimit`은 심상뿐 아니라 **같은 대사·후렴구**에도 걸린다. 제목 후렴이 반복되는 씬에서
심상만 제한하면 후렴이 규제 밖으로 새어 몇 배로 늘어나기 때문이다.

`actionClarity`·`modulateDensity`는 **밀도 축만 있고 명료성 축이 없던 문제**에 대응한다. 밀도 지시가
장면 유형과 무관하게 최대치로 걸리면 동작 장면까지 장식으로 덮여, 승패를 가른 한 수가 추상어로
처리되고 평범한 대화에도 대사 한 줄마다 내면·회상이 붙는다. `actionClarity`는 한 동작과 그 결과를
붙여 쓰게 하되 **건조한 중계가 되지 않도록** 무엇이 걸려 있는지도 함께 요구하고(명료성만 요구하면
긴장을 만드는 재료까지 함께 막힌다), `modulateDensity`는 위기가 조여드는 대목과 정서가 쌓이는
대목의 문장 길이를 다르게 가져가도록 지시한다. 이 계약은 생성 단계뿐 아니라 «카드 기반
보충»(`draftAugment`) 경로에도 주입된다 — 보충이 계약 밖에 있으면 동작 대목까지 장식을 늘린다.

시제와 따옴표는 계약이 아니라 **고정 산문 규약**(`proseConventionLines`)이다. 서술은 과거형, 대사는
곡선 큰따옴표(`“ ”`)로 못박아 뼈대·대사 다듬기·구간 살붙임 세 프롬프트에 모두 주입한다. 한 작품
안에서 갈리면 안 되는 규약이라 프로젝트가 끄지 못한다.

씬 목표 분량은 `frontmatter.targetWordCount` → 본문의 `[목표 분량] N자` 마커 →
`sceneLengthMultiplier` 기반 파생(2,000–20,000자로 클램프) 순으로 정해진다. 파생 단계가 없으면
목표가 없는 씬은 프롬프트에 분량 제약이 전혀 걸리지 않아 원고가 무한정 늘어난다.
`sceneLengthMultiplier: 0`으로 두면 종전처럼 제한하지 않는다.

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

#### 시점과 구성 (`pov`·`composition`·`threads`)

`pov`는 `first` | `first-retrospective` | `second` | `third-limited` | `third-omniscient` 다섯 값
가운데 하나이고, 이 값 하나에서 **암묵 서술자**(인칭 + 지식 경계)를 파생한다. 파일은 만들어지지
않는다. 값이 아예 없으면 프롬프트에 시점 지시가 나가지 않는다 — 시점을 설정한 적 없는 기존 작품의
결과가 달라지지 않게 하려는 의도다.

`composition`은 `linear` | `omnibus` | `alternating-pov` | `frame`이며, 고르면 프리셋이 연속성
줄기(`threads`)와 서술자 카드(§4.2a)를 만든다. `threads`는 `{ "<id>": { "title": string,
"wraps"?: string[] } }` 모양이고, `wraps`는 액자식에서 외화가 감싸는 내화 줄기다.
`narration.defaultNarrator`는 이름 붙인 기본 서술자다.

```jsonc
"setting": {
  "pov": "first",
  "composition": "omnibus",
  "threads": { "ep1": { "title": "나룻배" }, "ep2": { "title": "등불" } },
  "narration": { "defaultNarrator": "hana-first" }
}
```

줄기는 **연속성의 스코프**다. 이야기 상태 원장(§4.10)·장 요약·직전 씬 맥락·페르소나/배경 기억이
줄기 안에서만 이어지고, 캐넌(§4.7)만 전역으로 공유된다. 기본 줄기 `main`은 종전 경로를 그대로
쓰고, 나머지 줄기는 `.storyboard/memory/threads/<id>/` 아래로 내려간다. 씬 번호는 전역으로
유지되고 원고 조립도 번호순이다.

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
description:
  - 주인공. 학교에 첫 등교한 17세 여학생.
voice:
  - 밝고 또렷한 1인칭으로 말한다
  - 긴장해도 말끝을 흐리지 않는다
catchphrases:            # 반복돼야 하는 입버릇·러닝개그. voice 의 예시 대사와 달리 복사 금지·반복 제한의 예외
  - 이 몸이 말이야
desire:
  - 새 학교에서 진짜 친구를 만들고 싶다
relations:
  - target: jihoon
    type: 친구
    speech: 반말          # 이 상대에게 쓰는 말투. 인물별 대사 다듬기와 검수가 읽는다
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
aliases:
  - 학교
  - 교문
locationKind: place
characterIds:
  - elia
tags:
  - 학교
  - 도시
time: 아침
weather: 맑음
senses:
  - 멀리서 울리는 등교 종소리
  - 갓 자른 잔디 냄새
description:
  - 주인공이 처음 등교하는 고등학교 정문. ...
```

씬에 배경을 붙이는 방법은 두 가지다. `scene` frontmatter의 `location: <id>`로 명시하거나, 명시가 없으면 본문에서 배경의 `name`·`aliases`가 등장하는지로 자동 탐지한다(캐릭터 탐지와 동일한 방식). 자동 탐지는 가장 구체적인(가장 긴 일치 토큰) 배경 하나를 부착한다. 배경 이름이 "학교 정문"처럼 본문에 그대로 나오지 않을 수 있으므로 `aliases`에 본문 표기형("학교", "교문")을 넣어 두면 탐지가 안정된다.

#### 카드 렌더링 (커스텀 에디터)

- 좌측: 미리보기(캐릭터 프로필 이미지 + 역할/유형 배지)
- 우측: 탭으로 구성된 편집 영역
  - **`편집` 탭**: 사용자가 수기로 작성하는 필드만 단일 목록형으로 모은다.
    - 캐릭터: `name`·`aliases`·`role`·`voice`·`catchphrases`·`desire`·`description`·`tags`·`profile` (`id`는 읽기 전용)
    - 배경: `name`·`aliases`·`description`·`tags`·`time`·`weather`·`senses`·`locationKind`(location 한정) (`id`는 읽기 전용)
  - **`AI 기록` 탭(캐릭터 한정, 읽기 전용)**: draft 생성 중 AI가 자동 갱신하는 값을 시각화한다(아크 곡선·관계 미리보기). 직접 입력하지 않는다.
  - **`YAML` 탭**: 전체 필드의 raw 확인/편집 escape hatch.
- 모든 변경은 즉시 YAML 텍스트로 직렬화되어 디스크 반영 (양방향 sync)
- 캐릭터 `voice`·`description`과 배경 `description`은 긴 산문 대신 **항목 목록(`string[]`)**으로 입력한다. `편집` 탭에서 항목 추가/삭제로 관리하고, YAML에는 시퀀스로 저장된다.

#### 파라미터 입력 주체 (수기 vs AI 자동)

카드 필드는 출처에 따라 입력 주체가 나뉜다. 자세한 영향도 분석은 `apps/vscode/docs/card-parameter-impact.md`.

- **수기 입력(작가 의도·정체성)**: 캐릭터 `id`·`name`·`voice`·`catchphrases`·`aliases`·`role`·`description`·`tags`·`profile`, 배경 `type`·`id`·`name`·`description`·`tags`·`locationKind`.
- **AI 자동 갱신(이야기 진행으로 누적되는 값)**: 캐릭터 `traits`·`recentDialogues`·`attributes`·`arc`·`relations`, 배경 `characterIds`. 스키마/YAML에는 유지되지만 `편집` 탭에 입력란을 두지 않는다.
  - `traits`·`recentDialogues`는 `apps/vscode/src/infrastructure/ai/traitsUpdater.ts`가 draft 생성 후 카드에 직접 기록한다.
  - 배경 `characterIds`는 씬에 부착된 배경 카드에 등장 인물 id를 결정적으로 append한다(`apps/vscode/src/infrastructure/ai/backgroundCharacterUpdater.ts`).
  - `attributes`·`arc`·`relations`는 환각 위험이 있어 **직접 기록하지 않는다**. draft에서 AI가 추출해 `.storyboard/cache/cards/<scene>.json`에 후보로 적재(`apps/vscode/src/infrastructure/ai/cardCandidateUpdater.ts`)하고, `Storyboard: Promote Card Candidates` 명령으로 사용자가 고른 항목만 카드에 병합한다. relation `target`은 실제 카드 id로 해석되는 경우만, attributes는 카드에 없는 key만 제안된다(기존 값 비파괴).
  - 적재 전 자기검증: `cards.candidates.verify` 설정(기본 on)이 켜지면 각 후보가 본문에 명시되었는지 인물별 1회 재확인(`cardFactVerification`)해 명시된 항목만 캐시에 남긴다(검증 실패 시 추출 결과 유지).
  - 승격 후 정리: 카드에 반영된 후보는 캐시 파일에서 제거하고, 남은 후보가 없는 파일은 삭제한다(`packages/story-model/src/domain/cardCandidatePromotion.ts`의 `pruneRecordByPromotedKeys`). bible 후보(감사 목적 보존)와 달리 카드 후보는 재노출을 막기 위해 정리한다.
  - 위 후처리는 모두 `cards.candidates.updateAfterGenerate` 설정(기본 off)이 켜진 경우에만 실행된다.

### 4.2a `.card` (서술자 카드, `narrator/`)

시점에 이름을 붙인 카드다. 씬 카드의 `narrator`나 `chapters.yaml` 장의 `narrator`가 이 id를 고른다.
만들지 않아도 되며, 없으면 `setting.pov` 하나가 모든 씬에 적용된다.

```yaml
type: narrator
id: hana-first
name: 하나의 목소리
person: first          # first | second | third
knowledge: witnessed   # witnessed | omniscient | retrospective
tense: past            # past | present (생략 시 past)
focal: hana            # 초점 인물 카드 id
voice:
  - 건조한 단문
  - 자기 비하 섞인 유머
```

- `knowledge`가 `witnessed`면 서술자는 초점 인물이 보거나 듣거나 겪은 것만 서술한다. 이 경계는
  프롬프트 지시, 검수 항목, 그리고 이야기 상태 원장의 목격자 필터(§4.10) 세 곳에서 강제된다.
- `retrospective`는 결말을 이미 아는 자리에서 회고하는 화자다.
- `tense`는 `proseConventionLines`가 고정하는 시제를 정한다. 지정하지 않으면 과거형이다.
- `voice`는 서술 문장의 목소리이며, 검수의 «서술자 목소리 이탈» 항목이 이 값을 기준으로 삼는다.

**해석 순서는 씬 카드 > 장(`chapters.yaml`) > 프로젝트 기본**이다. 초점 인물은 서술자 카드의
`focal` → 씬의 `povCharacter` 순으로 정해진다. 참조한 서술자 카드가 없으면 조용히 기본값으로
떨어지지 않고 `NarrationError`로 거절한다 — 잘못된 시점으로 초안을 덮어쓰는 것보다 멈추는 편이
낫기 때문이다. CLI `doctor`가 이 참조를 생성 전에 검사한다.

### 4.3 `.png`

- 캐릭터 프로필: `character/profile/<id>.png`
- 카드의 `profile` 필드가 상대 경로로 참조 (캐릭터 카드 한정)

### 4.4 `.card` (씬 카드, `scene/`)

씬도 카드다. 캐릭터·배경과 같은 `.card` 캐리어를 쓰지만 스키마는 `type: scene`으로 구분되며,
파일명이 순서를 인코딩한다는 점만 다르다.

최소 형태 (`scene/01-arrival.card` + `scene/01-arrival.summary.md`):
```yaml
type: scene
id: 01-arrival
summary: 01-arrival.summary.md
```
```text
주인공이 학교에 도착했다. 정문 앞에서 깊게 숨을 들이쉬고,
친구 지훈을 발견한다.
```

전체 형태:
```yaml
type: scene
id: 01-arrival
title: 학교에 도착하다
characters:
  - elia
  - jihoon
location: school
mood: 설렘
relationStage: 첫 만남, 어색한 거리
povCharacter: elia
targetWordCount: 3000
grounding:
  incident: ...
purpose: 주인공을 소개하고 지훈과의 첫 접촉을 만든다
conflict: 지훈은 아는 척하지 않으려 한다
twist: 지훈이 먼저 이름을 부른다
emotionalShift: 긴장 → 안도
endState: 지훈과 나란히 교문을 통과하는 지점
foreshadowing:
  - 전학 이유
neededCanon:
  - 학교는 3월에 학기를 시작한다
beats:
  - 정문 앞에서 숨을 고르다 지훈을 발견한다
  - text: 지훈이 먼저 이름을 부르고, 둘은 나란히 교문을 지난다
    cast: [elia, jihoon]     # 이 비트에 있는 인물(카드 id 또는 이름)
    place: 교문 앞
    time: 등교 직전
summary: 01-arrival.summary.md
```

- **직렬화는 canonical**이다(고정 키 순서, block sequence). 카드와 같은 규칙이라 손으로 쓴 씬은
  첫 프로그램적 저장에서 정규화된다.
- 구조 필드는 프롬프트에 넣을 때 기존 씬 시드와 같은 `[목적]`/`[갈등]` 라벨 블록으로 렌더링되므로
  (`renderSceneCardBody`), 생성 프롬프트 계약은 형식 전환과 무관하게 유지된다.
- `summary`는 해석 없이 그대로 프롬프트에 붙는 창작자의 자유 메모다. 산문은 카드 옆
  `scene/<stem>.summary.md`에 두고 카드에는 그 파일명만 적는다 — 창작자가 쓴 사건과 기계가 펼친
  비트를 파일 단위로 구별하기 위해서다. `parseScene`은 카드와 파일 본문을 함께 받고, 카드 에디터의
  Summary 칸이 이 파일을 읽고 쓴다. 인라인 산문도 읽히지만
  새 카드는 파일로 둔다(`scene complete`가 새로 제안하는 씬만 아직 인라인으로 나온다).
  비어 있는 구조 필드는 카드 에디터의 **Summary에서 구조화** 버튼으로 AI 제안을 받아 검토 후 채울
  수 있고, 반영은 비어 있는 필드에만 적용된다(사용자가 적어 둔 값이 항상 이긴다).
- `beats`는 초안이 따라갈 시간 순 사건 목록이다. 초안 분량의 실질 상한은 씬의 사건 밀도이므로,
  `draft generate`는 `beats`가 비어 있으면 카드 재료·grounding·summary로 먼저
  `max(generation.beats.minimum, ceil(targetWordCount / generation.beats.charsPerBeat))`개를 뽑아 카드에 쓴다
  (`GenerateSceneBeatsUseCase`; summary가 있으면 그 범위 안에서만, `generation.beats.auto`로 끔).
  `scene plot` verb와 확장 명령은 같은 사용 사례를 미리 돌리는 입구이고, 이미 있는
  비트는 `--force`로만 덮어쓴다. 프롬프트 본문(`renderSceneCardBody`)에서는 `beats`가 사건 재료이고
  `summary`는 `[창작자 요약]` 설계 블록으로 함께 간다.
- 비트는 문자열이거나 좌표를 단 객체(`text`·`cast`·`place`·`time`)다. 좌표는 사건 줄 아래
  `(출연: … / 장소: … / 시각: …)` 한 줄로 프롬프트에 실리고(출연의 카드 id는 이름으로 바뀐다),
  뼈대는 그 인물만 그 자리에 두고 그 장소·시각에서 사건을 벌인다 — 인물의 등장·퇴장을 뼈대가
  추론하지 않게 하고, 뒤에 오는 «이 비트에서 누가 무엇을 아는가»의 좌표가 된다. 기계가 뽑는 비트와
  `scene plot`은 문자열만 쓴다.

#### 서술자와 줄기 (`narrator`·`thread`)

`narrator`는 이 씬이 쓸 서술자 카드 id, `thread`는 이 씬이 속한 연속성 줄기다. 둘 다 생략할 수 있고,
생략하면 장 → 프로젝트 기본으로 내려간다(`thread`의 기본은 `main`). 아웃라인에서 씬 시드를 만들 때
장의 `narrator`·`thread`가 씬 카드로 **복사**되므로, 시점 교차는 `chapters.yaml`의 장에 한 줄만
적으면 표현된다.

#### 장면의 경계 (`endState`·`povCharacter`)

씬 카드가 **어디서 멈추는지**와 **누구의 시점인지**를 담지 못하면, 한 씬이 다음 씬 영역까지 진행해
같은 사건이 두 번 결말나고 한 씬 안에서 여러 인물의 내면이 교차한다.

- `endState`는 `[이 장면의 종료 지점]` 블록으로 렌더링되며, **그 뒤는 다음 장면의 몫**이라는 문장이
  함께 붙는다. 뼈대 단계가 이 값을 직접 받아 사건 배치의 끝을 정한다.
- `povCharacter`는 `StyleDirective`로 옮겨져 대사·포맷 단계까지 시점 인물 지시로 전달된다. 프로젝트
  계약의 `pov`(1인칭/3인칭 제한/3인칭 전지)가 **서술의 종류**를 정하면, 이 필드는 그 씬에서 **누구의
  내면에 들어갈지**를 정한다.
- 둘 다 비어 있어도 생성은 진행된다(종료 지점이 없으면 뼈대가 요약의 마지막 사건에서 자연히 멈춘다).
- `endState`는 씬 폼의 **종료 지점** 입력란과 **Summary에서 구조화** 제안 항목에 함께 들어 있다.
  `povCharacter`는 현재 카드 YAML을 직접 편집해 넣는다(폼 입력란·AI 제안 미노출).

#### 서사 시간 (`storyTime`)

회상·액자 구성·시간 점프가 있으면 **씬 순번(서술 순서)과 사건 시점(서사 시간)이 어긋난다.** 캐넌의
`validFrom`/`validUntil`을 씬 순번으로 재면, 20화에서 죽은 인물이 25화 회상에서도 죽은 상태로
주입된다. 씬 카드의 정수 `storyTime`이 그 씬의 사건 시점이고, 유효 구간은 이 축으로 잰다.

```yaml
type: scene
id: 25-memory
storyTime: 3        # 25화지만 사건은 3화 시점이다
```

- **적지 않은 씬은 순번을 서사 시간으로 쓴다.** 순차 전개만 하는 작품은 아무것도 바뀌지 않는다.
- 구간의 경계(`validFrom: 20-fall`)도 **그 씬의 서사 시간**으로 풀린다. 경계가 회상 씬을 가리켜도
  뜻이 유지된다.
- **공개 시점(`revealFrom`)은 여전히 씬 순번으로 잰다.** 회상이라고 독자가 이미 읽은 반전이 다시
  덮이지는 않기 때문이다. 두 축을 다른 자로 재는 것이 이 설계의 핵심이다.
- 시간축을 쓰는 사실이 하나도 없으면 씬을 읽지 않는다. 비용은 구간을 실제로 쓰는 워크스페이스만 낸다.

#### 사실 시트 (`grounding`)

씬이 가사·분위기 스케치처럼 추상적이면 생성물도 은유만 남는다. 이를 막기 위해 생성 직전에 씬을 구체적
사건으로 못박는 4개 사실을 확정하고, 그 결과를 씬 카드에 남긴다.

```yaml
type: scene
id: 07-tonight
title: 수고했어, 오늘도
characters:
  - seoha
  - doyoon
grounding:
  incident: 3년 준비한 임용시험 최종 면접에서 떨어졌다
  place: 서하의 옥탑방 현관문 앞
  relation: 반년째 계단에서 인사만 하던 아랫집 이웃
  time: 11월 말 자정 무렵
```

- 비어 있는 필드만 AI가 제안하고, **사용자가 적어 둔 값은 절대 덮어쓰지 않는다.**
- 4개가 모두 차 있으면 제안 호출 자체를 건너뛴다(추가 비용 없음).
- 제안을 받았는데도 모델이 비워 둔 칸은 `.storyboard/cache/grounding-gaps.json`에 남긴다. 씬 본문,
  사실 시트, 인물이 그대로면 다음 실행은 그 칸을 다시 묻지 않는다. 제안 호출이 실패한 경우는 남기지 않는다.
- 기본값은 제안을 보여 주고 승인·수정을 받는 것이다. `generation.grounding.autoApprove`를 켜면
  제안을 자동 수락해 원클릭 생성을 유지한다.
- 확정된 사실은 대사 생성 프롬프트에 주입되고 `inputHash`에도 반영되므로, 사실 시트를 고치면 캐시가
  무효화되어 다음 생성에 그대로 반영된다.
- 씬 카드 직렬화가 canonical이므로 grounding만 바뀌어도 카드 전체가 다시 직렬화된다.

#### 파일명 규칙 (강제)

- 패턴: `NN-<slug>.card`
- `NN`: zero-pad 2자리 정수 (예: `01`, `02`, ..., `99`)
- `<slug>`: 영소문자, 숫자, 하이픈만 허용
- 카드의 `id`는 파일명 stem(`NN-<slug>`)과 같아야 한다
- 잘못된 형식의 파일은 사이드바에 ⚠️ 표시 + 경고 진단 표시
- `Storyboard: New Scene` 명령은 항상 다음 사용 가능 번호로 자동 생성
- 이름·번호 변경은 `Storyboard: Rename Scene...` / `storyboard scene rename <stem> --to <stem>`만 지원한다. stem을 이름으로 쓰는 파일(초안, `.draft/` 이력, 요약, 씬·캐넌·카드 후보 캐시, 대사 기억, Studio 세션)을 옮기고, stem이나 번호로 가리키는 참조(이야기 상태 원장, 캐넌의 `sourceScene`·`validFrom`·`validUntil`·`revealFrom`, `revision-plan.yaml`, 사용량 원장, 인물 `arc[].sceneRef`, 페르소나·배경 기억)를 고친다. 다른 씬이 쓰는 번호는 거부한다. 아웃라인은 번호의 위치로 씬과 짝지어지므로 번호가 바뀌면 그 씬의 아웃라인 자리와 장도 바뀐다

#### 구형 `.txt` 씬

v0.6.x 이전 워크스페이스의 `scene/*.txt`는 읽지 않고, 변환 명령도 0.11.5 를 끝으로 없앴다. 그런
작품은 0.11.5 이하에서 `storyboard scene migrate`로 먼저 `.card`로 옮긴 뒤 올린다.

### 4.5 `.md` (출력 원고, `draft/`)

`draft/<scene>.md`는 AI가 생성한다. 사용자가 직접 손볼 수 있고, `Re-generate`를 누르면 덮어써진다.

파일 머리에는 YAML frontmatter가 붙는다. `sceneStem`·`format`·`generatedAt`에 더해, 어떤 도구·AI가 만든 초안인지 추적할 수 있도록 생성 주체를 기록한다(옵셔널 — 없는 구버전 초안도 그대로 읽힌다).

```yaml
---
sceneStem: 01-prologue
format: novel
generatedAt: '2026-08-22T12:00:00.000Z'
generator: storyboard@0.6.1
providerId: claude
model: claude-sonnet-5
warnings:                     # 생성 검증이 잡았으나 재시도로 못 고친 항목 (선택)
  - '2구간: 뼈대의 대사가 사라졌습니다 ("망치질이 평소와 달랐습니다")'
---
```

`warnings`는 씬 생성의 기계 검증(§8.0)이 남기는 흔적이다. 재시도로도 위반이 남으면 **결과를 버리지
않고 채택하되** 사유를 헤더로 올려, 원고를 여는 사람이 어느 구간을 먼저 봐야 할지 즉시 알게 한다.
경고가 없으면 키 자체가 나오지 않으며, 구버전 초안처럼 키가 없어도 그대로 읽힌다.

- `format=novel`: 일반 산문 마크다운
- `format=screenplay`: Fountain 스타일 또는 `**캐릭터:** 대사`
- `format=play`: 희곡 형식 (지문 + 대사)
- `format=essay` / `format=poem`: 자유 형식

#### 이전 초안 히스토리 (`.draft/`)

`editor.draft.keepHistory`를 켜면, Generate/Regenerate가 `draft/<scene>.md`를 덮어쓰기 직전에 기존 초안을 `.draft/<scene>/<yyyy-mm-dd-hh-mm>-rev-NN.md`로 보관한다. 시간값은 보관 시점의 로컬 시간이고 `rev-NN`은 해당 씬 폴더에서 1부터 증가한다. 기본값은 꺼짐이며, `.draft/`는 초고에서 다시 만들 수 있는 산출물이라 `.gitignore`로 제외한다(`draft/` 자체는 읽는 결과물이라 추적한다). 보관 실패는 비치명적이라 생성 자체를 막지 않는다(경고 로그만 남김).

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
씬 생성 시 등장 인물/배경에 해당하는 canon 사실을 골라 파이프라인 컨텍스트(`previousContext`)에 주입하고,
초안의 `연속성 검사`는 이 설정과 본문이 모순되는 구간을 진단한다. 사실이 선택적 `keywords`를 선언하면, 씬 시드 본문에
그 키워드가 등장할 때 해당 사실의 subject가 씬 등장 엔티티가 아니어도 추가로 활성화된다(결정적 소문자 부분일치, AI 없음).
`keywords`가 없으면 기존 등장 엔티티 멤버십 동작과 동일하다.

```yaml
version: 1.0.0
facts:
  - id: elia-eye-color
    subject: { kind: character, id: elia }   # character | background
    key: 눈동자 색
    value: 녹색
    status: canon                            # canon | candidate (candidate는 주입/검사 제외)
    sourceScene: 01-prologue                 # 선택
    validFrom: 05-awakening                  # 선택: 사실이 '참'이 되는 시점 (NN-slug 또는 씬 번호)
    validUntil: 20-fall                      # 선택: 사실이 더 이상 참이 아니게 되는 시점
    revealFrom: 28-reveal                    # 선택: 사실이 '밝혀지는' 시점 — 그 전 씬에는 주입 안 함
    # revealFrom: { scene: 28-reveal, knownBy: [elia] }   # 인물별 인지: 나머지 등장 인물은 '아직 모름'으로 표시
    keywords: [붉은 제국, Crimson Empire]      # 선택: 씬 본문에 등장 시 비-엔티티 사실도 활성화
```

**`validFrom`과 `revealFrom`은 다른 축이다.** `validFrom`은 사실이 참이 되는 시점이므로, 1화부터 참인
결말 반전(예: "레벨 0은 관리자 키가 봉인된 상태")을 가릴 수 없다. 공개 시점 축이 없으면 그 반전이
공개 여부와 무관하게 모든 씬 프롬프트에 주입되어 초반 본문에 그대로 누설된다. `revealFrom`은 밝혀지는
시점을 따로 선언해, `selectInjectedFacts`가 **엔티티 경로와 키워드 경로 양쪽에서** 미도달 사실을
제외하게 한다. `revealFrom`이 없는 사실은 종전대로 항상 주입된다.
**인물별 인지 격차**는 `revealFrom: { scene, knownBy }`로 적는다. 독자에게 공개된 뒤에는 사실을 주입하되,
`knownBy`에 없는 등장 인물을 `(아직 모름: 지훈)`으로 표시한다 — 빼 버리면 서술자까지 모르는 것이 되어
"A는 알고 B는 모르는" 장면을 쓸 수 없다. `validFrom`/`validUntil`은 씬 카드의 `storyTime`(§4.4)으로,
`revealFrom`은 씬 순번으로 잰다.

**candidate → canon 흐름**: 초안 생성 시 설정 사실 추출(`factExtraction`)이 등장 인물의 고정 설정을
`.storyboard/cache/bible/<scene>.json`에 **candidate**로 자동 저장한다. `Storyboard: Promote Bible
Candidates to Canon` 명령으로 작가가 후보를 골라 `canon.yaml`로 승격하면, 그때부터 주입·연속성 검사 대상이 된다.

### 4.8 `.storyboard/outline/` (장편 구조 계획)

장편 자동 생성은 outline을 명시적 산출물로 저장해야 재시도와 검수가 가능하다.

- `synopsis.md`: 로그라인, 장르 약속, 주요 갈등, 결말, 주제, 톤, 시점, 문체 규칙. (`storyboard.outline.generate`가 생성)
- `chapters.yaml`: act/chapter/scene 구조, chapter/scene 목표 분량, 각 씬의 목적, 등장 인물, 배경, 갈등, 반전, 감정 변화, 회수할 복선, 필요한 설정 사실. 장에는 `narrator`·`thread`를 둘 수 있고, 씬 시드를 만들 때 씬 카드로 복사된다. (`storyboard.outline.generate`가 생성)
- `revision-plan.yaml`: 검사 결과와 재작성 지시를 scene 단위로 누적. (`storyboard.draft.reviseLoop`·`storyboard.novel.generate`가 기록)

이 파일들은 사람이 검토할 수 있는 계획이면서, `scene/*.card`와 `draft/*.md`를 생성하는 입력이다. `synopsis.md`·`chapters.yaml`는 `storyboard.outline.generate`로 생성하며, 사용자가 VSCode에서 직접 편집한다. `chapters.yaml`에서 `scene/NN-slug.card` 시드를 파생하는 흐름은 `storyboard.scene.generateAllSeeds`가 담당하고, 생성된 시드는 기존 `Generate All Drafts`가 그대로 처리한다.

### 4.8a `.storyboard/cache/cards/<scene>.json` (카드 필드 후보)

bible candidate와 같은 결을 가지는, **캐릭터 카드 필드용** 후보 캐시다. 초안 생성 시 등장 인물별로
`relations`·`arc`·`attributes`를 AI가 추출(`cardFactExtraction`)해 여기에 적재한다(`apps/vscode/src/infrastructure/ai/cardCandidateUpdater.ts`).
`Storyboard: Promote Card Candidates` 명령으로 작가가 고른 항목만 해당 캐릭터 카드에 병합한다.
relation `target`은 실제 카드 id로 해석되는 경우만 후보화하고, attributes는 카드에 없는 key만 제안한다(기존 값 비파괴).
배경 `characterIds`는 후보를 거치지 않고 배경 카드에 결정적으로 직접 기록된다.

### 4.8b `.storyboard/cache/notes/` (노트 흡수)

`storyboard notes absorb`·`init --from-notes`가 Obsidian 볼트나 Notion 페이지에서 읽은 것을 둔다. 모두 git 밖의
캐시이며, 워크스페이스에 들어가는 것은 카드·씬·시놉시스뿐이다.

- `source.json`: 수집한 노트 원문과 출처(트리에서 읽었는지 링크로 따라왔는지), 읽지 못한 노트.
- `plan.json`: 마지막 정리 계획 — 새 카드, 기존 카드에 대한 변경, 번호를 붙인 씬, 계약·시놉시스 제안, 분류 못한 노트, 원고로 분류된 노트. 씬은 노트 한 장에 하나이고 노트 속 사건은 그 씬의 `beats`가 된다. 이미 문장으로 쓴 원고(`draft`)에서는 인물·배경·작품 정보만 옮기고 씬은 만들지 않는다.
- `responses.json`: 마지막 정리에서 묶음마다 모델이 돌려준 원문 응답과 그 묶음의 노트 id. 출력 한도에서 잘렸거나(`truncated`) 정리 결과를 찾지 못한(`unparsed`) 묶음은 `failure`로 표시되고, 그 묶음은 경고로 보고된다. 모든 묶음이 실패하면 흡수는 실패(exit 1)로 끝난다.
- 인물의 성격(`traits`)·태그(`tags`)가 두 묶음 이상에서 읽혔거나 기존 카드에 이미 있으면, 계획을 저장하기 전에 요청 하나로 같은 뜻의 항목을 하나로 줄인다. 모델은 후보 중에서 고르기만 하고 문구를 고치지 못하며, 이 요청이 실패하면 합친 목록 그대로 두고 경고한다. 띄어쓰기·문장부호만 다른 항목은 요청 없이 하나로 본다.
- `candidates.json`: 이미 있던 카드에 대한 노트의 변경. 흡수 한 번이 출처(`sources[]`: `id`·`location`·`absorbedAt`·`candidates`) 하나이고, 같은 위치를 다시 흡수하면 그 출처만 바뀐다(`--replace-candidates`면 전부). Notion 페이지의 위치는 링크 표기와 관계없이 `https://www.notion.so/<페이지 id>`로 적는다. 이 파일을 읽을 수 없으면 흡수는 AI 요청 전에 파일 경로를 알리며 실패한다. `card promote`는 카드마다 출처를 합쳐 초안 후보(§4.8a)와 함께 반영하고 반영한 항목을 지운다. 노트끼리 값이 다른 칸은 반영하지 않고 남기며, `card discard <id> --change <출처 id>:<변경 id>`로 하나를 버린다. 0.12 형식(최상위 `location`)은 읽지 않는다.
- `synopsis.candidate.md`: `outline/synopsis.md`가 이미 있을 때 노트에서 만든 시놉시스. `<!-- note-source: <위치> -->` 표시 아래 위치마다 한 단락이고, 같은 위치는 그 단락만 바뀐다.

### 4.9 `.storyboard/memory/personas/`·`backgrounds/` (에이전트 영속 메모리)

> 페르소나 메모리(`personas/`)와 배경 메모리(`backgrounds/`) 모두 구현됨(Phase G-2·G-4).

카드 = 에이전트의 메모리를 카드 단위로 영속화해 씬 진행에 따라 진화시킨다. 페르소나/배경 묘사를 매 씬 새로 생성하지 않고 재사용·갱신한다. 페르소나 캐시는 draft 생성 시 `buildPersonas` 단계가, 배경 분위기 묘사 캐시는 대화 생성 직전 드로잉 단계가 카드 단위로 먼저 조회하고, 캐시가 없거나 `cardHash`가 어긋날 때만 새로 생성·저장한다.

```json
// .storyboard/memory/personas/<character-id>.json
{ "cardId": "elia", "persona": "<1인칭 페르소나>", "updatedThroughScene": "03-...", "cardHash": "sha256:..." }
// .storyboard/memory/backgrounds/<background-id>.json
{ "cardId": "school", "atmosphere": "<장소·시대 분위기 묘사>", "updatedThroughScene": "03-...", "cardHash": "sha256:..." }
```

`cardHash`로 카드가 바뀌면 무효화하고, `updatedThroughScene`이 지금 만드는 씬과 같거나 뒤면 **되감아 버린다** — 아직 오지 않은 씬의 정보를 담고 있고, 그 씬을 다시 만든다면 기억이 전제한 판본이 폐기되기 때문이다(원장 §4.10의 되감기와 같은 판정). 씬 번호를 읽을 수 없는 기억은 근거가 없으므로 그대로 쓴다. 씬 단위 캐시(4.6)는 그대로 두고, 이 캐시는 **카드 단위**로 분리해 부분 재생성(§8 라우팅)의 입력으로 쓴다.

### 4.10 `.storyboard/memory/storyState.md` (이야기 상태 원장)

항목은 `- [<씬 번호>|<목격자 id들>] <사실>` 형태로 적힌다. 목격자는 그 사실이 확립된 씬에 있던
인물이며, `witnessed` 서술자의 초점 인물이 목격자에 없으면 그 항목은 프롬프트 주입에서 빠진다 —
화자가 없던 자리의 일을 아는 것이 시점 이탈이기 때문이다. 목격자가 적히지 않은 구 버전 항목
(`- [12] …`, `- …`)은 판정할 수 없으므로 그대로 통과시킨다. 줄기가 여럿이면 이 파일은 줄기별로
`.storyboard/memory/threads/<id>/storyState.md`에 놓인다.

씬 사이의 기억이 직전 드래프트 꼬리 1,000자뿐이면, 앞 화가 확립한 사실·관계·공개된 정보가 다음 씬에
전달되지 않고 **씬 경계마다 상태가 리셋된다.** 그 결과 인물의 상태가 역전되고(정지 여부), 이미 공개한
정보가 다시 처음처럼 공개되며(같은 로그의 3중 공개), 같은 사건이 두 번 결말난다. 이 원장은 그 리셋을
막기 위한 **씬 간 누적 상태**다.

```markdown
# 이야기 상태
<!-- through-scene: 7 -->
<!-- scene-input: 2 sha256:… -->
<!-- scene-input: 3 sha256:… -->
## 확정 사실
- [2] 브로크의 대장간은 광장 북쪽 골목 끝에 있다
## 인물 관계와 말투
- [1] 브로크는 이준을 «손님»이라 부르고 반말을 쓴다
## 공개된 정보
- [3] 이준은 NPC가 반 박자 멈춘 것을 자신만 봤다는 사실을 알았다
## 살아 있는 모티프
- [1] 물웅덩이에 비친 상
```

- **네 항목**(확정 사실 / 인물 관계와 말투 / 공개된 정보 / 살아 있는 모티프)으로 나뉘고, 섹션당 24개로
  상한을 둔다. 무한정 늘어나면 프롬프트 예산을 잠식한다.
- 항목마다 **확립된 씬 번호**를 `- [N] 내용`으로 기록한다. 번호가 없는 구버전 항목은 항상 유효한 것으로
  본다.
- 프롬프트 주입과 연속성 검사 기준 **모두 현재 씬보다 앞선 항목만** 본다. 번호가 없으면 32씬 중 5화를
  재생성할 때 결말까지의 전개가 통째로 주입되는 스포일러 누출이 생긴다.
- 같은 씬을 다시 생성하면 **그 씬이 앞서 남긴 항목만 걷어내고** 새로 쌓는다. 재생성이 멱등해지고,
  폐기된 옛 판본의 항목이 뒤 씬으로 계속 전달되지 않는다.
- 갱신은 백그라운드 큐가 아니라 **씬 저장 경로에서 `await`한다** — 다음 씬이 곧바로 읽기 때문이다.
  갱신 실패는 경고로만 처리하고 저장 자체를 막지 않는다.
- 원장은 `[이야기 상태]`로 `[설정 메모]`(canon)보다 **앞에** 주입되며, 자기 상태를 되먹지 않도록 첫
  씬에는 주입하지 않는다.
- 항목이 오염되면 이후 모든 씬 프롬프트로 퍼지므로, 다른 문자 체계가 섞인 항목은 원장에 들어가기 전에
  거부한다(§4.5의 초안 검증과 같은 판별기).

#### 무효화 (낡은 항목 판정)

원장 항목은 **그것을 낳은 씬의 입력**(씬 본문·인물/배경 카드·확정 사실·format·구분자·grounding)에
매여 있다. 카드나 씬을 고친 뒤 그 씬을 다시 생성하지 않으면 원장만 옛 전제를 붙들고 있게 되고, 그
사실이 다음 씬 프롬프트로 들어가 새 설정과 충돌한다. 페르소나 기억에는 `cardHash` 게이트가 있으나
원장에는 없던 비대칭을 메우는 장치다.

- 씬마다 `<!-- scene-input: N <씬 캐시와 같은 computeSceneInputHash> -->`를 기록한다.
- **두 가지로 낡음을 판정한다.** ① 기록된 해시가 지금 계산한 해시와 다르면(카드·씬을 고쳤거나 씬
  파일이 사라졌으면) 그 씬의 항목이 낡는다. ② 씬 N을 다시 생성하면 **N보다 뒤 항목이 낡는다**(되감기)
  — 폐기된 판본을 전제로 뽑힌 것이기 때문이다.
- 낡은 항목은 **지우지 않고 `- [22!] 내용`으로 표시**한다. 사람이 원장에서 무엇이 버려졌는지 볼 수
  있어야 하고, 그 씬을 다시 생성하면 통째로 갈아 끼워지며 표시도 사라진다.
- 표시된 항목은 **프롬프트에서만 빠진다.** 생성 결과 warnings에 `씬 22~32`처럼 범위로 보고하되,
  **현재 씬보다 앞의 것만** 보고한다 — 뒤 항목은 어차피 주입되지 않으므로, 32씬을 순서대로 다시 만드는
  동안 매 씬 경고가 뜨면 진짜 경고가 묻힌다.
- **해시가 없는 씬(0.8 이전 원장)은 유효로 본다.** 대조할 근거가 없다고 사실을 버리는 쪽이 더 나쁘다.
  `storyboard doctor`가 봉인 대상으로 보고하고 `storyboard init --repair`가 그 시점의 카드·씬으로
  봉인한다 — 그 뒤에 고친 것부터 낡음으로 잡힌다.
- 감사는 생성 경로(`sceneGenerationInputs`)에서 서사 컨텍스트를 만들기 **전에** 돈다. 표시를 먼저
  원장에 써야 곧이어 원장을 읽는 `buildNarrativeContext`가 그 항목을 뺀다. 수정(revise)은 원장을 읽기만
  하므로 파일에 남은 표시를 그대로 따른다.

## 5. 명령어 (확정)

| 명령어 ID | 표시 이름 | 동작 |
|---|---|---|
| `storyboard.init` | `Storyboard: Initialize Project` | 빈 폴더에 디렉토리·`.storyboard/project.json`·.gitignore·README 생성 |
| `storyboard.character.create` | `Storyboard: Create Character` | 새 `.card` + 빈 프로필 placeholder |
| `storyboard.background.create` | `Storyboard: Create Background` | 새 `.card` (location 기본) 생성 후 열기 |
| `storyboard.scene.create` | `Storyboard: New Scene` | 다음 번호로 `scene/NN-<slug>.card` 생성 후 열기 |
| `storyboard.scene.rename` | `Storyboard: Rename Scene...` | 씬 stem·번호를 바꾸고 파생 파일과 참조를 함께 옮김 |
| `storyboard.draft.generate` | `Storyboard: Generate Draft (Current Scene)` | 활성/지정 씬 → `draft/<scene>.md` 생성 |
| `storyboard.draft.generateAll` | `Storyboard: Generate All Drafts` | scene 일괄 처리 |
| `storyboard.novel.generate` | `Storyboard: Generate Novel` | 작품 설정 → outline→characters→seeds→장별 draft/검수→조립→검사→요약 전체 실행(모드 선택·재개) |
| `storyboard.outline.generate` | `Storyboard: Generate Novel Outline` | 작품 설정 → `.storyboard/outline/synopsis.md`·`chapters.yaml` 생성 |
| `storyboard.scene.generateAllSeeds` | `Storyboard: Generate Scene Seeds` | `chapters.yaml` → `scene/NN-slug.card` 생성 |
| `storyboard.manuscript.assemble` | `Storyboard: Assemble Manuscript` | `chapters.yaml` 순서로 `draft/*.md`를 `manuscript/` 챕터·볼륨 파일로 조립 |
| `storyboard.manuscript.review` | `Storyboard: Review Manuscript` | 조립한 원고를 장 단위 창으로 continuity·비평 검사해 `manuscript/REVIEW.md` 보고서 생성 |
| `storyboard.manuscript.summaries` | `Storyboard: Summarize Chapters` | 장별 AI 요약과 이전 장 recap을 `.storyboard/memory/summaries.md`로 생성 |
| `storyboard.draft.continuityCheck` | `Storyboard: Continuity Check (Draft)` | 초안을 `.storyboard/bible/canon.yaml`과 대조해 설정 모순 진단 |
| `storyboard.draft.reviseLoop` | `Storyboard: Review & Revise Draft (Current Scene)` | 초안을 연속성·비평으로 검사하고 차단 이슈를 재작성으로 고치는 루프 |
| `storyboard.bible.promoteCandidates` | `Storyboard: Promote Bible Candidates to Canon` | 자동 추출된 설정 후보를 골라 `canon.yaml`로 승격 |
| `storyboard.cards.promoteCandidates` | `Storyboard: Promote Card Candidates` | 자동 추출된 카드 후보(관계·아크·속성)를 골라 캐릭터 카드에 병합 |
| `storyboard.bible.canonDiff` | `Storyboard: Canon Diff Report` | 미승격 설정 후보를 `canon.yaml`과 대조해 `manuscript/CANON.md` 보고서 생성 |
| `storyboard.apiKey.set` | `Storyboard: Set API Key…` | provider 선택 → 키 입력 → `SecretStorage` |
| `storyboard.relationGraph.open` | `Storyboard: Open Character Relation Graph` | 관계 그래프 webview Panel |
| `storyboard.draft.export` | `Storyboard: Export Draft…` | 조립 원고(`manuscript/manuscript.md`)를 Markdown/TXT로 내보내기 (PDF/DOCX 후속) |

Storyboard 워크스페이스는 git 저장소 그 자체이며, 교환용 아카이브 포맷은 두지 않는다.

### 5.1 활성화 조건

```json
"activationEvents": [
  "workspaceContains:.storyboard/project.json"
]
```

그 외 contributed command는 VSCode의 command activation 동작으로 실행된다.

## 6. 설정 키

설정은 VSCode `contributes.configuration`이 아니라 두 앱이 함께 쓰는 파일에 있다. 공통값은
`~/.storyboard/config.json`, 작품별 재정의는 `<워크스페이스>/.storyboard/config.json`이며, 키 이름은 아래에서
`영역.대상.속성` 세 단이다(예: `ai.provider.default`, `providers.claude.model`, `revise.loop.maxIterations`).
두 파일은 읽을 때마다 `packages/story-config/src/configSchema.ts`의 스키마로 검증한다 — 스키마가 거부하는 값은
`ConfigFileError('invalid-value')`로 실행이 멈추고, 아무도 읽지 않는 키(옛 이름 포함)는 경고만 남기고 무시된다.
옛 이름을 대신 읽어 주는 표는 두지 않는다.

- `ai.provider.default`: `"openai" | "claude" | "google" | "grok" | "ollama" | "mock"`. 설치 직후에는 비어 있고, 고르기 전까지 생성은 `missing-provider`로 거부된다. 0.9.2 이전의 `claude-code`·`codex`·`gemini-cli`는 카탈로그에 없으므로 «고르지 않음»으로 떨어져 생성이 거부된다 — 요금이 다른 provider 를 대신 골라 주지 않는다.
- `providers.openai.model`: 기본 `gpt-6-sol`
- `providers.claude.model`: 기본 `claude-sonnet-5`
- `providers.google.model`: 기본 `gemini-3.8-flash`
- `providers.grok.model`: xAI OpenAI 호환 API(`https://api.x.ai/v1`), 기본 `grok-4.7`
- `providers.ollama.baseUrl`
- `providers.ollama.model`: 기본 `gemma4:12b`(카탈로그는 제안일 뿐, 받아 둔 어떤 태그든 받는다)

모델 목록·요금·기본 모델은 `packages/story-model/src/contracts/providerCatalog.ts` 한 곳이 갖는다. 기본값이 아닌
`temperature`를 거부하는 모델(Claude 4.7 이후, GPT-6, Gemini 3.x)은 그 행에 `acceptsTemperature: false`를 적고,
프로바이더는 그 모델에 `temperature`를 보내지 않는다.
- `tasks.<taskName>.provider`·`tasks.<taskName>.model`: 작업별 provider·모델 오버라이드. 모델만 있고 provider가 없는 항목은 무시된다. CLI는 `config set|unset`으로 다룬다.
- `revise.loop.afterGenerate`: 생성(Generate / Regenerate / Generate All) 직후 검수·재작성 루프를 자동 실행해 한 동작으로 검수된 초안을 만든다. 기본 `true`(품질 우선); 끄면 AI 호출·비용을 줄인다.
- `editor.grammar.realtime`: 기본 `false`
- `editor.scene.prefixDigits`: 기본 `2`
- `revise.loop.maxIterations`: 검수·재작성 루프 최대 재작성 횟수, 기본 `2`
- `budget.run.limitUsd`: 장편 생성 1회 실행의 AI 비용 상한(USD, 0.01 단위), 기본 `0`(제한 없음). 넘으면 파이프라인의 `shouldPause`가 켜져 진행 중인 씬까지 마치고 `paused`로 멈추며, 다시 실행하면 이어 간다. 요금이 없는 호출(로컬 모델)은 상한에 걸리지 않는다. 호스트마다 컴포지션 루트에서 사용량 싱크를 `UsageMeter`로 한 번 감싸고, 실행마다 세션을 열어 쓴 비용을 잰다.
- `generation.section.outputLimit`: 한 번의 살붙임 호출이 낼 수 있는 최대 글자 수, 기본 `7000`. 목표 분량을 이 값으로 나눠 구간 수가 정해지므로, **낮추면 호출이 늘고 분량이 늘어난다.** 프롬프트의 목표 글자 수 지시는 실측에서 무력했고(비단조), 분량을 실제로 움직이는 손잡이는 호출 수다. 모델·목표 분량에 따라 최적값이 다르므로 설정으로 열어 둔다.
- `revise.loop.scoreThreshold`: 비평 루브릭 점수(0–100)가 이 값 이상이면 검수·재작성 루프를 조기 통과시키는 선택적 품질 기준, 기본 `0`(비활성, AI 호출 수·중단 동작은 기존과 동일). 연속성 high 이슈는 점수와 무관하게 계속 차단한다.
- 확장 UI 다국어(i18n): `package.nls.json`(기본/영어) + `package.nls.<locale>.json`(예: `package.nls.ko.json`) 메커니즘을 사용한다. `displayName`·`description`과 **모든 명령 제목**을 외부화했다. 설정 설명, 런타임 문자열(`vscode.l10n`), webview 문자열은 점진적으로 이관한다. 소설 본문 언어와는 별개다.

### 6.1 작가 리소스 계층

설정 값 말고도 작가가 고칠 수 있는 것이 넷 있고, 모두 **번들 기본값 → `~/.storyboard/` → `<워크스페이스>/.storyboard/`**
세 계층으로 덮인다(나중 계층이 이긴다). 두 루트 안의 배치는 `packages/story-app/src/resourceOverrides.ts`가 소유하고,
`StoryboardApplication.loadResourceOverrides()`가 작품 명령이 돌기 전에 읽어 못 쓰는 파일을 경고로 보고한다.

| 루트 안 경로 | 덮는 것 | 번들 원본 |
|---|---|---|
| `prompts/<key>.md` | 프롬프트 문구(`## system`·`## user`, 변형은 `## system:xs`)와 머리말(`---` 사이 `temperature`·`maxTokens`) | `packages/story-ai/src/ai/prompts/resources/<key>.md` |
| `craftContract.json` | 모든 생성 프롬프트에 붙는 작법 계약 기본값(적은 항목만 덮임; `project.json`의 `setting.craftContract`가 그 위에 마지막으로 적용) | `packages/story-model/src/format/craftContract.params.json` |
| `promptVariants.json` | xs·rich 변형 선택 규칙(압축 프로바이더·모델 패턴·작업, 출력 하한·장문 작업·상위 모델 키워드) | `packages/story-ai/src/ai/prompts/promptVariants.params.json` |
| `compositionPresets.json` | 구성 프리셋이 만드는 줄기 이름·편 수 | `packages/story-model/src/format/compositionPresets.params.json` |
| `pipelines/scene.yaml` | 씬 초안 파이프라인의 단계 순서(`version: 1` + `stages` 목록, `{id, enabled: false}` 로 끄기) — 필수 단계는 뺄 수 없고 앞선 단계가 있어야 하는 단계는 순서를 검사 | `sceneStageCatalog`(`packages/story-engine/src/pipeline/sceneStageCatalog.ts`)의 순서 |
| `pipelines/novel.yaml` | 장편 파이프라인의 단계 순서 | `novelStageCatalog`(`packages/story-engine/src/application/novel/novelStageCatalog.ts`)의 순서 |

프롬프트 문구는 Mustache 부분집합(`{{name}}`·`{{#name}}…{{/name}}`·`{{^name}}`·`{{> partial}}`·`{{! }}`)으로 쓰고,
복합 블록(작법 계약·목소리·시점 지시)은 TS partial로 넘긴다. 번들 문구는 `scripts/build-prompt-resources.mjs`가
`resources.generated.ts`로 접어 앱이 번들하며, 골든 스냅샷 테스트가 이식 전후 바이트 동일을 지킨다.

두 파이프라인은 단계 객체(`ISceneStage`·`INovelStage`)의 목록이고, 실행기는 계획이 이름한 순서대로 단계를 부른다.
명세 파일은 이 계획을 바꿀 뿐 단계 자체는 코드다. `storyboard doctor`가 적용 중인 리소스 파일과 쓸 수 없는 파일을 보고한다.

작가가 움직일 수 있는 값 전부(설정·생성 손잡이·프롬프트 온도)와 그 출처는 `packages/story-app/src/parameterRegistry.ts`의
`describeParameters`가 한 목록으로 만들고, CLI `storyboard params show`가 그것을 보인다. 조정 가능한 숫자 파일은
`*.params.json` 접미로 통일했으며 목록은 `.claude/rules/coding-standards.md`의 파라미터 맵에 있다.

API 키는 설정 파일이 아니라 `~/.storyboard/secrets.json`(모드 0600)에만 저장하며, 두 앱이 같은 파일을 읽는다.
키가 필요한 provider는 `openai`·`claude`·`google`·`grok`이고, `mock`·`ollama`는 키가 없다.

**구독 CLI provider 제외(0.9.2)**: `claude-code`·`codex`·`gemini-cli`는 로컬 CLI를 헤드리스로 띄워
각 제공자의 구독·계정 로그인으로 생성하던 경로였다. 세 제공자 모두 구독·계정 로그인을 «대화형 개인
사용», 프로그램적·대량 호출을 «API 키»로 나눠 안내한다. Storyboard 의 장편 생성은 후자에 해당하고
CLI 앱은 다른 에이전트가 무인으로 모는 것이 주용도이므로, 경계를 코드로 지키는 대신 경계 자체를
없앴다. 함께 사라진 것들: CLI 실행 명령·타임아웃·추론 강도 설정, `settings.updateProviderCommand`
RPC, «CLI 미설치» 연결 상태, 사용 한도 폴백(`--fallback`), 그리고 CLI provider 에서 인라인 완성을
끄던 분기. 남은 provider 는 전부 종량제이거나 로컬이므로 모델 행마다 단가가 반드시 있다.
옛 이름을 대신 골라 주는 표는 두지 않는다. 요금이 다른 곳으로 말없이 옮기는 것보다 한 번 거부하고
사람이 다시 고르게 하는 편이 낫다.

## 7. 비목표 (Non-Goals)

- 멀티 프로젝트 / 프로젝트 선택 화면
- 자체 텍스트 에디터, 자체 자동완성 UI, 자체 toaster — VSCode 네이티브 사용
- 자체 버전 히스토리·스냅샷 — Git 사용
- 클라우드 동기화·로그인·계정 — 로컬 우선
- 모바일/태블릿 사용 시나리오
- 웹앱 병행 운영 (확장 안정화 후 재고)
- `.picktion` 파일 import 및 Picktion 브라우저 저장 포맷과의 **자동 호환·변환**
- “완성 품질 보장”을 검수 없이 한 번의 모델 응답에 맡기는 방식

## 8. 에이전트 협업 모델

장편 생성은 역할이 다른 에이전트들의 협업이다. **감독(Director) 에이전트가 결정적 코드로 서브 에이전트를 순서대로 호출**하고, 검수자 피드백을 해당 서브 에이전트로 라우팅한다. 현재 구현 상당 부분이 이 모델과 1:1 대응하므로, 아래 카탈로그는 **기존 단계를 에이전트로 명명·격상**한 것이다.

### 8.0 씬 생성 파이프라인 (뼈대 → 다듬기 → 살붙임 → 기계 검증)

한 씬을 만드는 흐름이다. 이전에는 씬을 카드 요약의 문장 단위 **비트로 쪼개 각각 독립된 AI 호출**로
만들고 이어 붙였다. 각 호출이 자기 비트만 보므로 "이미 나온 인물", "이미 벌어진 사건", "멈춰야 할
지점"을 매번 실어 보내야 했고, 하나라도 빠지면 그 자리에서 결함이 났다 — 같은 인물이 두 번 처음
등장하고, 도입이 세 번 반복되고, 씬이 다음 씬 영역까지 진행하는 결함이 모두 여기서 나왔다.

지금은 **씬 전체를 한 문맥에서 확정한 뒤 문장만 두껍게 하는** 구조다.

```text
buildPersonas
  -> draftSkeleton     # 1. 씬 전체 뼈대 — 사건 순서·등장·종료 지점을 한 번에 확정
  -> polishDialogue    # 2. 대사만 손봄 — 말투·호칭 반영, 주고받는 말 늘리기
  -> expandSection*    # 3. 구간별 살붙임 — 뼈대 전문 + 직전 구간 완성문을 보며 확장
       -> validate     # 4. AI 없는 기계 검증 → 사유를 붙여 재시도, 남으면 warnings
```

**1. 뼈대(`sceneSkeleton`)** — 사건 순서·등장·종료 지점이 한 문맥에서 확정되므로, 뒤 단계가 상태를
실어 나를 필요 자체가 없다. 목표 분량의 **1/3**을 뼈대에 배분한다. 뼈대가 얇으면 살붙임이 15배 확장을
요구받아 모델이 감당하지 못하고 분량이 미달한다. 묘사 금지와 목표 분량은 서로 충돌하는 지시라
모델마다 다른 쪽을 택하므로(실측: sonnet은 금지를 지켜 목표의 1/3만 씀), 프롬프트가 우선순위를
못박는다 — **분량은 묘사가 아니라 사건의 밀도로 채운다.** 사건을 단계로 쪼개고 주고받는 말을 여러
턴으로 늘리며, 짧은 행동 지문과 한 줄 반응은 뼈대의 일부다. 뼈대가 목표의 절반에도 못 미치면 그
이유를 실어 한 번 더 부르고, 두 판 다 미달이면 두꺼운 쪽을 남긴다.

**2. 대사 다듬기(`sceneDialoguePolish`)** — 뼈대는 사건 배치와 대사 작성을 동시에 하느라 말투가
뭉개진다. 이 단계는 **인물 하나에 호출 하나**다: 뼈대의 따옴표 대사마다 `⟨n⟩` 번호를 달아 보내고,
각 호출은 그 인물의 페르소나·입버릇·말투 표본·상대별 말투(`relations[].speech`)·**이 씬 이전에 아는
것**(원장의 목격자 태그로 고른 항목)만 받아 자기 대사를 번호로 가리켜 돌려준다. 다른 인물의 것은 그
호출이 받지 않으므로 «아직 못 들은 사실을 말하는» 경계 위반이 지시문이 아니라 구조로 막힌다. 병합은
번호 기준이고 두 인물이 같은 번호를 가져가면 뼈대가 이긴다(경고). 새 정보·결정·인물은 금지이며, 병합
결과가 검증에 걸리면 **다듬기 이전 뼈대로 되돌리고** 그 사실을 경고로 남긴다(대사 개성보다 사건 보존이
우선). 턴 수는 구조상 뼈대와 같다 — 대화 밀도는 뼈대 단계가 책임진다.

**3. 구간 살붙임(`sceneSectionExpansion`)** — 구간 수는 목표 분량이 출력 상한(`generation.section.outputLimit`,
기본 7,000자)을 넘지 않는 최소값이라, 짧은 씬은 사실상 단일 패스로 돈다. 목표가 상한보다 작으면
살붙임이 한 번뿐이고 분량이 뼈대 목표(1/3)에 갇히므로, 분량이 모자라면 이 상한을 낮춰 구간을 늘린다. 매 호출이 **뼈대 전문과 직전 구간 완성문**을 함께 본다.
절단은 뼈대가 남긴 `---` 장면 전환 자리를 우선 쓰고(예산의 절반만 채워도 자른다), 없을 때만 문단
경계로 내려간다 — 결투 한복판에서 구간이 갈리는 것을 막기 위해서다.

**4. 기계 검증** — 뼈대가 정답지 역할을 하므로 위반을 **AI 없이 결정론적으로** 가려낼 수 있다.
`cast`(뼈대에 없던 인물) · `foreign-script`(다른 문자 체계) · `lost-dialogue`(사라진 대사 — 이어진
조각을 합친 것과도 비교하므로 한 턴을 쪼개 쓴 것은 소실이 아니다) · `repetition`(뼈대 조각에 한 번
있는 대사를 두 번 쓰거나 직전 구간의 대사를 다시 쓰거나 앞 문단과 닮은 문단을 되풀이함) ·
`too-short`(목표의 절반 미만) · `too-long`(다듬기가 뼈대의 두 배 초과)를 잡아 사유를 붙여 최대 두 번
재시도하고, 그래도 남으면 결과를 **버리지 않고 채택하되** 초안 헤더 `warnings`(§4.5)로 올린다.
살붙임 프롬프트는 분량보다 되풀이 금지를 앞세운다 — 새 사건을 금지당한 모델이 분량을 채울 수단은
되풀이뿐이므로, 재료가 없으면 목표에 못 미친 채 끝내는 쪽이 낫다. 되풀이로 채운 판은 무게 3으로
짧고 깨끗한 판에 진다.
출연진 판정은 **씬 전체 뼈대**를 기준으로 하고 카드 이름으로 정규화한 뒤 센다. 구간만 보면 대명사로
가리킨 인물을 살붙임이 이름으로 부를 때마다, 별칭·게임명으로 부른 인물을 본명과 다른 사람으로 셀
때마다 오탐이 난다.

**씬 간 재료는 뼈대 단계에만 주입한다.** 이야기 상태 원장(§4.10)·캐넌(§4.7)·이전 씬 맥락은 사건을
정하는 뼈대만 본다. 살붙임이 설정을 다시 보면 묘사가 새 설정을 끌어들일 여지만 생긴다.

### 8.1 에이전트 카탈로그

| 에이전트 | 역할 | 권장 모델 | 현재 구현 |
|---|---|---|---|
| **감독(Director)** | 파이프라인 오케스트레이션, 검수 리포트 판단 → 서브 에이전트 재호출 결정 | 최상급 | `novelPipeline`·`sceneGenerationPipeline` |
| **콘티 작가(Dramaturg)** | 씬의 사건 순서·등장·종료 지점을 한 문맥에서 배치 | 중간~최상급 | `draftSceneSkeleton`(§8.0의 1단계). 비트 분해(`extractSituations`)를 대체 |
| **페르소나(Persona)** | 캐릭터 카드별 대사·내면. 카드 = 에이전트 | 중간 | `buildPersonas`·`polishSceneDialogue`(§8.0의 2단계) |
| **드로잉(Setting)** | 배경 카드별 장소·시대 분위기/감각 묘사 | 중간 | `describeBackground`(backgroundDescription 작업)로 분위기 묘사 생성→대화에 주입, `backgrounds/` 메모리 캐싱 |
| **서술자/문체(Narrator)** | 뼈대를 일관된 시점·시제·문체의 산문으로 직조 | 중간~최상급 | `expandSceneSection`(§8.0의 3단계)·`applyGenreFormat` |
| **설정 키퍼(Canon Keeper)** | 책 전체 사실 일관성. `canon.yaml`·이야기 상태 원장 소유, 후보 사실 추출/검증 | 중간 | bible/`checkContinuity`·`storyStateUpdate`(§4.10). 검수자와 분리(씬 품질 ≠ 전체 세계 일관성) |
| **검수자(Reviewer)** | draft candidate 품질 점검, Pass/Fail 판정, 이슈 리포트 | 최상급 | `reviseDraftWorkflow`·`critiqueDraft` |
| **교열(Copy Editor)** | 오탈자·맞춤법. 검수자가 직접 고치는 경량 작업 | 저가 | `grammarCheck` |

### 8.2 오케스트레이션 원칙

- **코드 주도.** 단계 순서는 결정적 TS 코드가 책임진다(restartable·inspectable). 에이전트는 자율 LLM 루프가 아니다.
- **역할별 모델 차등.** 감독·검수자는 최상급, 콘티·페르소나·드로잉·교열은 저가 모델을 쓸 수 있다. 작업별 provider/model 배정(`storyboard.tasks` 설정)을 그대로 재사용하므로 별도 인프라가 필요 없다.

### 8.3 검수 피드백 라우팅 (Phase G-3)

현재 review→revise는 draft 본문을 통째로 재작성한다. 이를 **이슈에 타깃 메타데이터**를 부여해 해당 에이전트만 부분 재생성하도록 바꾼다.

```text
ReviewIssue {
  severity: "high" | "low"
  category: "voice" | "purpose" | "repetition" | "continuity" | "grammar"
  target?: { agent: "persona" | "setting" | "narrator" | "canon", cardId?: string }
  note: string
}
```

- `category → target.agent` 매핑은 **결정적 규칙**이다(감독이 LLM으로 추론하지 않음): voice→persona(cardId), continuity→canon, repetition·purpose→narrator, grammar→copy-editor(검수자 직접 수정).
- 감독은 타깃별로 그룹핑해 해당 에이전트만 재호출하고, 다른 단계는 씬 캐시(4.6)·카드 메모리(4.9)에서 재사용한다. 타깃이 없는 전역 이슈일 때만 전체 재작성으로 폴백한다.
- 구현됨(Phase G-3). `packages/story-engine/src/pipeline/reviewRouting.ts`가 `category→agent` 결정 매핑과 `routeReviewIssues`(canon→persona→narrator 고정 순서)를 제공하고, `reviseDraftWorkflow`가 그룹별로 스코프된 지시를 만들어 `reviseDraft`를 순차 호출한다. `voice.cardId`는 `excerpt`를 등장인물 name·alias와 대조해 best-effort로 채우며(단일 매칭일 때만), 매칭 실패 시 persona 그룹을 등장 캐릭터 전체 대상으로 처리한다. grammar는 현 revise 루프에 검사 경로가 없어 라우팅 대상에서 제외하고 타입에만 둔다. setting 라우팅은 G-4 전까지 비활성이다.

### 8.4 비목표

- 에이전트 간 디베이트·합의 루프, 우선순위 큐·리소스 스케줄러, 에이전트 동적 생성. 현 성숙도에서 과설계이며, 복잡도가 정당화될 때 재고한다.

## 9. 로드맵

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

- outline을 chapter/scene 단위로 분해해 `scene/*.card`를 자동 생성한다.
- 씬마다 목적, 갈등(`conflict`), 반전(`twist`), 감정 변화, 회수할 복선, 필요한 설정 사실(`neededCanon`)을 `chapters.yaml`에 담고 시드 본문에 반영한다.
- 기존 `Generate All Drafts`는 자동 생성된 씬 시드도 그대로 처리한다.

### Phase D: Autonomous Draft Loop (초기 구현)

- 단일 씬 초안에 대해 continuity와 통합 비평(character voice, plot purpose, repetition) 검사를 묶어 실행한다(`storyboard.draft.reviseLoop`).
- 검사 결과를 재작성 지시로 변환해 초안을 다시 쓰고, 차단 이슈가 없거나 최대 횟수에 도달할 때까지 review→revise→re-review를 반복한다.
- 작품 계약의 문체 제약(`styleConstraints`)과 품질 기준(`qualityCriteria`)을 비평 프롬프트에 반영한다.
- 비용, 토큰, provider, 모델 선택을 작업별로(`draftCritique`/`draftRevision`/`continuityCheck`) 사용량 원장에 기록한다.
- 씬 생성 자체를 §8.0의 뼈대 → 다듬기 → 살붙임 → 기계 검증 구조로 재구성했다. 비트 단위 독립 생성이 만들던 재등장·재도입·경계 초과 결함을 구조에서 제거하고, 남는 위반은 초안 헤더 `warnings`로 노출한다.
- 씬 간 연속성 재료를 갖췄다: 이야기 상태 원장(§4.10), 캐넌 공개 시점 게이트(`revealFrom`), 씬 카드의 종료 지점·시점 인물. 연속성 검사 기준도 canon 단독에서 **canon + 원장의 검사 가능한 항목**으로 넓혔다(모티프는 권고이므로 제외).
- 분량 미달은 별도 보충 단계가 아니라 §8.0의 `too-short` 검증이 담당한다. 구간 결과가 목표의 절반에 못 미치면 사유를 붙여 다시 확장하고, 남으면 경고로 노출한다. 사용자가 직접 부르는 «카드 기반 보충»(`draftAugment`)은 이와 별개의 편집 경로이며, 여기에도 작법 계약이 주입된다.
- 전체 씬 배치 검수와 grammar 통합, 생성 직후 자동 체이닝은 Phase F에서 다룬다.

### Phase E: Manuscript Assembly (초기 구현)

- `chapters.yaml` 순서로 `draft/*.md`를 chapter별 파일과 전체 volume 파일(`manuscript/`)로 결정적으로 조립한다(`storyboard.manuscript.assemble`).
- 초안이 없는 계획 씬은 자리표시·집계, 계획 밖 초안은 "기타" 챕터로 보존한다.
- 조립한 원고를 canon 연속성·비평(보이스/목적/반복)으로 검사해 `manuscript/REVIEW.md` 보고서를 남긴다(`storyboard.manuscript.review`).
  검사는 **장을 창으로 삼아** 돈다 — 한 장의 본문에 앞 장들의 요약(§4.10의 낡음 표시를 제외한 것)을
  `[설정]` 줄로 실어 장마다 연속성·비평 한 쌍을 호출한다. 전권을 한 호출에 넣으면 뒤로 갈수록 모델의
  주의가 옅어져 30만 자 한복판의 모순이 검출되지 않는다. 이슈의 offset은 그 장 본문 기준이 되지만,
  보고서와 재작성 라우팅은 `<!-- scene: <stem> -->` 주석으로 씬을 짚으므로 영향이 없다.
- 조립 시 `chapters.yaml`의 회수 대상 복선을 장별 체크리스트(`manuscript/FORESHADOWING.md`)로 정리한다.
- 장별 AI 요약과 이전 장 recap을 `.storyboard/memory/summaries.md`로 생성한다(`storyboard.manuscript.summaries`). 이 파일이 있으면 이후 씬 생성(order > 1)이 이전 장면 컨텍스트로 raw 마지막 1000자 대신 이 롤링 요약(최대 8000자)을 read-only로 우선 사용한다. 파일이 없으면 기존 1000자 tail 동작과 동일하다.
- 요약은 **그 장의 초안에서 나온 것**이므로 초안이 바뀌면 낡는다. 원장(§4.10)과 같은 판정을 쓴다 —
  섹션마다 `<!-- chapter-input: sha256:… -->`로 그 장 본문의 해시를 남기고, 지금 조립한 장 본문의
  해시와 다르면 `stale`을 덧붙여 표시한다. 표시된 장은 **지우지 않고 프롬프트에서만 빠지며**, 생성
  결과 warnings와 `storyboard doctor`가 다시 요약할 장을 알린다. 모든 장이 낡으면 요약을 통째로
  건너뛰고 이전 초안 꼬리로 돌아간다 — 파일 머리말만 남은 요약은 꼬리보다 못하다. 해시가 없는 0.8
  이전 요약은 대조할 근거가 없으므로 유효로 두고 `doctor`가 다시 요약할 대상으로만 보고한다.
- 원클릭 실행에서는 이 요약을 **장마다** 갱신한다. 한 장의 초안·검수가 끝나면 그 장만 요약해
  기존 파일에 `## <장 제목>` 섹션 단위로 병합하므로, 다음 장은 «지금까지의 줄거리»를 받고 시작한다.
  마지막 summaries 단계는 그대로 남아 전체를 다시 요약한다. 요약이 예산을 넘으면 앞을 잘라내지 않고
  **오래된 장부터 제목+한 줄로 압축**한다 — 앞을 자르면 장거리 복선이 확립된 도입부가 통째로 사라진다.
- 미승격 설정 후보(candidate)를 canon과 대조해 `manuscript/CANON.md`로 정리한다(`storyboard.bible.canonDiff`).

### Phase F: One-Click Novel (초기 구현)

- `Storyboard: Generate Novel`(`storyboard.novel.generate`) 명령이 validate(A)→outline(B)→characters→seeds(C)→장별 draft/검수(D)→assemble/review/재작성/재검사/summaries(E)를 한 진행 상태로 실행한다. characters 단계는 장 계획이 부르는데 카드가 없는 인물만 모델 호출 한 번으로 카드를 만들고(빠진 인물이 없으면 호출하지 않음), 있는 카드는 덮어쓰지 않는다. 다시 실행하면 씬이 있는 장 계획과 이미 있는 씬 카드를 그대로 쓴다.
- 최종 검사는 조립 원고에 `<!-- scene: <stem> -->` 주석을 넣어 읽으므로, 각 이슈가 자기 씬을
  `sceneStem`으로 지목한다. high 이슈는 씬별로 모아 해당 초안을 **1회 재작성**하고, 그 뒤 전권을
  **1회 재검사**해 보고서를 다시 쓴다. 씬을 특정하지 못한 이슈는 재작성 대상이 아니며 보고서의
  «재작성 결과»에 건수로 남는다. 재작성이 넘겨받는 이슈는 씬 단위 검사가 볼 수 없는 장거리 모순이라,
  수정 루프의 첫 회차 검사 결과에 합쳐져 들어간다.
- 실패·중단 시 단계·장 진행 상태를 `.storyboard/cache/novel-run.json`(재시작 가능한 작업 큐)에 남기고, 다시 실행하면 중단 지점부터 재개한다.
- 사용자는 전체 자동 실행, outline 승인 후 실행, chapter별 승인 실행, 최종 검사 후 재작성 승인
  실행(`review-approval`) 중 하나를 고를 수 있다. CLI는 무인 실행이라 항상 `auto`다.
- 문서 export(PDF/DOCX)와 매우 긴 원고의 분할 검사는 후속에서 다룬다.

### Phase G: Multi-Agent Collaboration (계획)

§8의 협업 모델을 단계적으로 구현한다.

- **G-1 에이전트 명명·격상**: 기존 파이프라인 단계를 §8.1 카탈로그의 에이전트로 명명·정합(코드 동작 변경 없음, 문서/역할 정리).
- **G-2 카드 단위 영속 메모리**: 페르소나/배경을 `.storyboard/memory/personas/`·`backgrounds/`(4.9)에 카드 단위로 캐싱하고 `cardHash`로 무효화. 매 씬 재생성 의존 해소.
- **G-3 검수 이슈 라우팅**: `ReviewIssue.target`(§8.3)과 결정적 `category→agent` 매핑을 도입해, 검수 이슈를 해당 에이전트의 부분 재생성으로 라우팅. 전역 이슈만 전체 재작성으로 폴백.
- **G-4 드로잉 에이전트 능동 묘사**: 배경을 사실 주입에서 장소·시대 분위기 묘사 생성으로 확장. 구현됨 — `backgroundDescription` 작업으로 분위기를 생성해 대화 컨텍스트에 주입하고 `backgrounds/` 메모리(4.9)에 `cardHash` 무효화로 캐싱한다.

## 10. 환경

- VSCode `^1.90.0` 이상
- Node.js 18+ (extension host)
- Repository: `maroomir/storyboard` (신규)
- License: Apache-2.0

## 11. 참고

- 상세 마이그레이션 계획은 로컬 `.doc/plan/storyboard-plan.md`(비추적)에 있다.
- 기존 Picktion 저장소 (`maroomir/picktion`)는 그대로 유지(archive 예정)되며, 본 컨셉/계획 문서는 새 `maroomir/storyboard` 저장소의 출발점이 된다.

## 12. Implementation Structure

### 12.0 모노레포 배치

저장소 루트는 `apps/*`·`packages/*`를 워크스페이스로 두는 private npm workspaces 매니페스트(`storyboard-monorepo`)이고, 패키지 잠금 파일(`package-lock.json`)은 루트 하나만 둔다. **버전도 루트 하나**이며 `npm run version:sync`가 두 앱에 복제한다.

앱은 셋이고 서로를 모른다. 모두 `packages/story-engine`(유즈케이스·저장 계층·파이프라인)과 그 아래 `packages/story-model`(파일 포맷·계약·도메인 정책·경로 규칙)을 소비하며, 다른 것은 호스트 어댑터뿐이다 — 파일시스템, 워크스페이스 탐색, 로거, 비밀 저장소, 설정, 사용량 기록. Node 위에서 도는 앱이 똑같이 쓰는 파일시스템(`NodeFileSystem`)과 워크스페이스 탐색(`NodeWorkspaceLocator`)은 `packages/story-node`에 한 벌만 둔다. 어댑터를 받아 엔진의 객체 그래프(리포지토리·유즈케이스·NovelPipeline)를 한 번 조립하는 컴포지션 루트는 `packages/story-app`의 `StoryboardApplication`이고, 각 앱의 컨테이너는 자기 어댑터만 만들어 넘긴다. 앱은 그 위의 매니저(`drafts`·`manuscript`·`cards`·`novel`·`studio`)의 동사만 부르고, 유즈케이스는 `IUseCase<Request, Result>` 한 형태(`execute(request)`)를 구현한다.

| 앱 | 워크스페이스 | 실행 이름 |
|---|---|---|
| VSCode 확장 | `apps/vscode` (`storyboard-vscode`) | 확장 ID `maroomir.storyboard-vscode` |
| CLI | `apps/cli` (`@storyboard/cli`) | `storyboard` — 헤드라인 제품이자 레퍼런스 구현 |
| 데스크톱 | `apps/desktop` (`@storyboard/desktop`) | Storyboard 앱(Electron) — 개발자가 아닌 작가용. 원고 중심 책상 + 실행 서랍, 설정집, 자동 버전 기록 |

CLI에 없는 기능이 확장에 생기지 않도록 `apps/cli/test/parity.test.ts`가 확장의 `contributes.commands` 전 항목을 CLI 동사·에디터 전용·미구현 중 하나로 분류하도록 강제한다.

아래 12.1의 경로는 모두 `apps/vscode/` 기준이며, import alias는 `@/*` → `apps/vscode/src/*`, `@webview/*` → `apps/vscode/webview-ui/src/*`이다.

### 12.1 계층 구조

내부 계층은 `packages/story-model`과 `packages/story-engine`에 있고 모든 앱이 공유한다. 패키지 방향은
`story-model ← story-ai ← story-engine ← story-app` 한 줄이다. 앱에 남은 것은 호스트 어댑터와 그
호스트의 입출력뿐이다.

```text
packages/story-model/src/
  format/         # 워크스페이스 파일 포맷: 스키마·코덱·경로 규약
  contracts/      # AI 계약·카탈로그
  shared/         # 앱 간 RPC·카드 계약
  domain/         # runtime-agnostic policies·file records
  paths/          # 프로젝트 경로 규칙

packages/story-engine/src/
  application/    # use cases, NovelPipeline, ports 소비
  pipeline/       # 씬 생성 단계
  persistence/    # repository 구현 (IFileSystem 위)
  ports/          # IFileSystem, IWorkspaceLocator, IUsageSink, IStoryboardLogger

packages/story-app/src/
  storyboardApplication.ts   # 호스트 어댑터 6개 → 엔진 객체 그래프를 한 번 조립하는 컴포지션 루트
  managers/                  # drafts·manuscript·cards·novel·studio 파사드 — 앱이 부르는 동사
  runGate.ts                 # 작품 실행 잠금
  resourceOverrides.ts       # 작가 리소스 계층(prompts/·craftContract·promptVariants·compositionPresets) 로더
  parameterRegistry.ts       # 설정·생성 손잡이·프롬프트 온도를 출처와 함께 한 목록으로

apps/vscode/src/extension.ts
  -> bootstrap/                 # StoryboardApplication, lifecycle, DI 그래프
       -> presentation/         # commands, providers, messaging(웹뷰 RPC)
       -> infrastructure/       # VSCode 어댑터: fs·settings·secrets·usage
```

- 앱 의존 방향: `bootstrap → {presentation, infrastructure} → @storyboard/story-engine`.
- `extension.ts`는 `vscode`와 `bootstrap` 외에는 import하지 않는다(fan-out 1).
- `StoryboardApplication`은 Platform·Project·Card·Draft·Novel·Workbench module의 초기화와 역순 종료를 소유한다.
- 상태·I/O·수명주기를 가진 협력자는 생성자 주입으로 연결하고, `DisposableStore`가 feature module의 reverse dispose를 담당한다.
- 엔진은 `vscode`를 import하지 않는다(패키지 순수성 검사로 강제). 호스트 차이는 포트 구현으로만 표현한다.

**검사가 실제로 강제하는 것** — 초록불을 그 이상으로 읽지 않도록 적어 둔다.

- `apps/vscode`: `extension.ts`의 fan-out, `infrastructure → presentation/bootstrap` 금지, 순환 금지,
  공유 패키지의 `vscode`·앱 import 금지.
- `apps/cli`·`apps/desktop`: 레이어 방향과 순환 금지. 엔진의 파이프라인 조립 심볼
  (`scripts/architecture/runner.mjs`의 `refusePipelineAssembly`) import도 거부한다(생성 루프의 두 번째 사본 방지).
- `packages/story-model`: 자체 레이어 방향 — `format` 은 자기만, `contracts` 는 `contracts`/`format` 만,
  이어서 `shared`·`domain`·`paths` 는 각각 자기보다 앞선 것만 import 한다. 순환도 막는다.
- `packages/story-engine`: `pipeline`·`ports`·`ai` 는 자기 폴더(와 다른 패키지)만 import 한다. 순환도 막는다.
  `persistence` 와 `application` 은 설계상 상호 의존이라(application 이 리포지터리 포트를 선언하고
  persistence 가 구현한다) 둘 사이에는 순서를 두지 않는다.

- 350 LOC 초과 예외(근거 있는 유지): `packages/story-ai/src/ports/ConfigBridge.ts`(cohesive 어댑터, 함수 복잡도 낮음 — 길이만으로 분해하지 않음).
