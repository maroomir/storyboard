# 카드 진술 영향도 리포트 (draft 생성 기준)

대상: 번들 카드(`character/<slug>.card/`, `background/<slug>.card/`, `scene/NNN-slug.card/`)의 머리말과 진술 facet이 **draft 생성**에 어디로 닿는가.
기준: 0.16 형식. 0.15의 카드 필드(`recentDialogues`, `tags`, `locationKind`, `characterIds` 등)는 없어졌고, 카드는 `card.yaml`(머리말)과 `statements.yaml`(진술)로 갈립니다.

## TL;DR

- 카드의 내용은 **진술**입니다. 한 줄이 `{facet, value, about?, key?, source}` 이고, facet이 어디에 쓰일지를 정합니다.
- 생성 프롬프트로 가는 길은 둘입니다. 인물 페르소나(`PersonaGenerationPrompt`)와 배경 묘사(`BackgroundDescriptionPrompt`)가 카드를 한 덩어리로 읽고, 뼈대·대사 다듬기·구간 살붙임은 입버릇·상대별 말투·배경의 배치·규칙을 따로 받습니다.
- 인물의 `relation`(관계)과 `arc`(변화)는 생성 프롬프트에 들어가지 않습니다. 관계 그래프·뷰어·인터뷰용입니다. 관계 중 상대별 말투(`speech`)만 대사 다듬기에 들어갑니다.
- 인물·배경이 씬에 붙는 방식: 인물은 씬의 출연(`cast`)과 비트의 `cast`, 본문에 나온 이름·별칭으로 찾고, 배경은 씬의 장소(`place`)가 가리키는 카드를 쓰되 없으면 본문에 나온 이름·별칭으로 찾습니다.
- 씬의 설계 facet(목적·갈등·반전·감정 변화)이 생성 프롬프트에 닿는 길은 확인하지 못했습니다(아래 «씬»). 확인된 것은 종료 지점(`endState`)이 뼈대에 들어간다는 것입니다.

## 머리말과 진술

| 종류 | 머리말(`card.yaml`) | 진술 facet (섹션) |
|---|---|---|
| 인물 | `id` `slug` `kind` `name` `role`(주연/조연/단역) `attributes`(`sex` `age` `job`) `aliases` | `traits`(성격) `desire`(성격) `catchphrases`(말투) `voice`(말투) `relation`(관계) `speech`(관계) `arc`(변화) `description`(묘사) `fact`(사실) |
| 배경 | `id` `slug` `kind` `name` `aliases` `within` | `tags` `time` `weather`(분위기) `senses`(감각) `layout`(배치) `rules`(규칙) `description`(묘사) `fact`(사실) |
| 씬 | `id` `slug` `kind` `title` `cast` `place` `time` `targetWordCount` | `purpose` `conflict` `twist` `emotionalShift` `endState`(설계) `foreshadowing`(복선) |
| 서술자 | `id` `slug` `kind` `name` `person` `knowledge` `tense` `focal` | `voice`(말투) `description`(묘사) `fact`(사실) |

- `relation`과 `speech`는 상대를 `about`(카드 uuid)로 가리킵니다. 상대 카드를 개명해도 고칠 곳이 없습니다.
- `fact`는 `key`가 붙을 수 있는 사실 줄이고, 카드끼리만이 아니라 작품 전체가 공유합니다.
- 진술마다 `source`(`author` / `agent` / `studio` / `interview`)가 남고, 작가의 줄(`author`)은 에이전트가 덮지 못합니다. 줄과 출처는 `storyboard card show <slug> --sources`로 봅니다.
- 그림은 인물·배경 번들 안의 `profile.png` 하나입니다. 페르소나·배경 기억은 번들의 `memory/<줄기>.yaml`입니다.

각 facet의 소비자(`consumers`)는 `packages/story-model/src/element/` 의 `character.ts` `background.ts` `scene.ts` `commonFacets.ts` 가 적어 둡니다.

## 인물 진술이 닿는 곳

| facet | 생성 | 그 밖의 사용처 |
|---|---|---|
| `voice` | 페르소나 «목소리·말투», 대사 다듬기 | 인터뷰 |
| `description` | 페르소나 «설명» | 인터뷰 |
| `desire` | 페르소나 «목표» | 인터뷰 |
| `traits` | 페르소나 «특징»(앞 10개) | 인터뷰 |
| 머리말 `role` · `attributes` | 페르소나 «역할»·«속성» | 뷰어 머리말 |
| `catchphrases` | 뼈대·대사 다듬기·살붙임에서 «입버릇 — 대목 하나에 통틀어 한 번까지», 반복 제한에서 제외 | — |
| `speech` | 대사 다듬기·뼈대·살붙임의 «상대별 말투» | 인터뷰(상대별 말투 질문) |
| `relation` | 0 | 관계 그래프, 뷰어, 카드 삭제 시 참조 정리 |
| `arc` | 0 | 뷰어 |
| `fact` | 그 씬의 인물 사실로 주입, 연속성 검사 | 지식 경계 |
| 머리말 `aliases` | 인물 탐지와 상황별 페르소나 스코핑 | — |

- 인물이 씬에 붙으려면 출연(`cast`)이나 비트의 `cast`에 있거나 본문에 이름·별칭이 나와야 합니다. 별칭이 약칭을 덮지 않으면 그 인물은 씬에서 빠질 수 있습니다.
- 상태 필드(`traits` `desire` `description` `voice`)는 모든 씬 프롬프트에 함께 읽힙니다. 뒷부분 줄거리가 거기에 적히면 앞 씬이 결말을 흘립니다. 변하는 것은 `arc`에 적습니다(생성에 들어가지 않아 안전합니다).
- `voice`는 말투의 설명입니다. 예시 대사는 복사되지 않습니다. 반복돼야 하는 입버릇은 `catchphrases`에 적습니다.

## 배경 진술이 닿는 곳

배경은 씬에 붙었을 때만 생성에 닿습니다. 씬의 장소(`place`)가 그 카드를 가리키거나, 본문에 이름·별칭이 나오면(가장 긴 일치 하나) 붙습니다.

| facet | 생성 |
|---|---|
| `description` `time` `weather` `senses` `tags` | 배경 묘사(`BackgroundDescriptionPrompt`)의 입력. 그 결과가 뼈대에 들어갑니다 |
| `layout` `rules` | 뼈대 프롬프트의 «배치»·«규칙» |
| `fact` | 그 씬의 장소 사실로 주입, 연속성 검사 |
| 머리말 `aliases` | 본문에서 배경을 찾는 표기형 |
| 머리말 `within` | 생성에는 쓰이지 않고, 뷰어 머리말에 «<상위 장소> 안»으로 보입니다 |

0.15의 `locationKind`는 없어졌고, `characterIds`는 저장하지 않고 씬에서 계산합니다(그 배경이 장소인 씬의 출연과, 그 배경에 놓인 비트의 출연). 노트 내보내기의 «속한 인물»과 스튜디오가 배경을 볼 때 이 값이 쓰입니다. 어느 씬의 장소도 아닌 배경은 `doctor`가 안내로 알립니다.

## 씬

씬은 번들 하나에 파일이 여럿입니다.

| 파일 | 내용 |
|---|---|
| `card.yaml` | 제목·출연(`cast`)·장소(`place`)·시간·목표 분량 |
| `statements.yaml` | 설계 진술(목적·갈등·반전·감정 변화·종료 지점·회수할 복선) |
| `beats.yaml` | 비트 `{text, cast?, place?, time?}` (출연·장소는 카드 참조) |
| `dialogue.json` | 씬 대사 |
| `state.yaml` | 이 씬에서 확정된 이야기 상태(`event` `relationShift` `reveal` `motif`)와 입력 해시 |
| `summary.md` | 씬 요약 |

- 생성의 중심은 **비트**입니다. 뼈대가 비트의 `text`를 서사 원천으로 받고, 비트의 `cast`·`place`·`time`이 좌표가 됩니다.
- `purpose` `conflict` `twist` `emotionalShift`는 씬 본문의 `[목적]`·`[갈등]`·`[반전]`·`[감정 변화]` 블록이 되어(`sceneProjection.ts` → `renderSceneCardBody`) 비트 전개와 초안 프롬프트에 함께 들어갑니다.
- `endState`는 뼈대(마지막 구간)에 들어가 씬이 다음 씬 영역으로 넘어가지 않게 합니다.
- `foreshadowing`은 원고 조립(`manuscriptAssembly`) 소비자로 적혀 있습니다.
- 0.15의 `summary`(→ `summary.md`), `povCharacter`, `mood`, `relationStage`(→ `state.yaml`의 `relationShift`)는 씬 필드가 아닙니다. 사실 시트(사건·장소·시점·관계)와 `neededCanon`은 저장하지 않고 카드에서 파생합니다.
- 시점은 씬 → 장(`chapters.yaml`) → 프로젝트 순으로 풀리고, 서술자와 줄기는 `.storyboard/structure.yaml`에 있습니다.

## 권고

1. **생성 품질에 닿는 칸은 좁다**: 인물은 `voice` `description` `desire` `traits`와 `catchphrases` `speech`, 배경은 `description` `senses` `layout` `rules`, 씬은 비트와 `endState`입니다.
2. **관계와 변화는 생성 밖이다**: `relation`·`arc`를 채워도 draft는 변하지 않습니다. 말투가 필요하면 `speech`에 적습니다.
3. **사실은 `fact` 진술로 한 곳에 적는다**: 따로 정전(canon) 파일은 없습니다. 장편에서 일관돼야 하는 설정은 그 인물·장소 카드의 `fact`입니다.
4. **카드는 동사로 고친다**: `card set`·`card edit`·스튜디오·인터뷰·노트 흡수가 `statements.yaml`을 씁니다. 파일을 손으로 고치면 «엔진 밖에서 바뀐 카드» 경고와 함께 읽힙니다.

## 입력 주체

진술의 `source`가 누가 채웠는지를 말합니다. 스튜디오 뷰어는 줄의 출처를 싣지 않고, 터미널의 `card show --sources`가 줄 번호와 출처를 보입니다.

| 출처 | 들어오는 길 |
|---|---|
| `author` | `card set`(사람이 답할 수 있는 실행) |
| `agent` | `card set`(에이전트 실행) |
| `studio` | 스튜디오의 만들기·고치기, «씬 기반 카드 구성», `card build` |
| `interview` | 인터뷰 증류(카드의 기다리는 제안으로 남았다가 «적용») |

생성은 카드에 쓰지 않습니다. 초안을 만든 뒤 특성·최근 대사·등장 인물을 카드에 쌓던 일과 그 후보 승격은 없어졌습니다.

## 부록: 코드 사용처

- 페르소나: `packages/story-ai/src/ai/prompts/personaGeneration.ts` → `name` `voice` `description` `desire` `role` `attributes` `traits`
- 배경 묘사: `backgroundDescription.ts` → `name` `description` `time` `weather` `senses` `tags`; 뼈대의 `layout`·`rules`는 `sceneSkeleton.ts`
- 입버릇·상대별 말투: `characterCatchphrases.ts` `sceneBeatBlocks.ts` `sceneDialoguePolish.ts`, 상대별 말투 조립은 `packages/story-engine/src/pipeline/scene/characterVoices.ts`
- 인물 탐지·스코핑: `packages/story-model/src/format/sceneContext.ts`, `packages/story-engine/src/pipeline/beatActors.ts`
- 번들 ↔ 카드 투영: `packages/story-model/src/domain/cardProjection.ts`
- facet 어휘: `packages/story-model/src/element/`
