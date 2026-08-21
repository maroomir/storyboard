# 카드 파라미터 영향도 리포트 (draft 생성 기준)

작성일: 2026-06-23
대상: `CharacterCard` / `BackgroundCard`의 각 필드가 **draft 생성**에 실제로 얼마나 기여하는가
배경: guerrila `01-first-meeting` 씬을 gt 수준으로 끌어올리는 9차 반복 튜닝 과정에서, 어떤 카드 파라미터가 결과를 움직이고 어떤 것이 무의미했는지 코드로 검증한 결과.

## TL;DR

- **카드 데이터를 draft 생성에 쓰는 핵심 프롬프트는 `PersonaGenerationPrompt`**이며, 거기서 읽는 character 필드는 `name` · `voice` · `description` · `desire` · `role` · `attributes` · `traits`(앞 10개) **7개**다. 배경은 `BackgroundDescriptionPrompt`(드로잉)가 `name`·`description`·`time`·`weather`·`senses`·`tags`를 읽는다. (2026-06-25: `attributes`(`속성:`)·`desire`(`목표:`)·배경 `time`/`weather`/`senses` 주입 추가 — 이전 character는 5개였다.)
- `aliases`는 인물 **탐지/스코핑**에만, `background.description` / `background.tags`는 **씬에 `frontmatter.location`이 있어 배경이 부착될 때만** 쓰인다.
- guerrila의 씬은 frontmatter가 비어 있어(`---\n---`) 배경이 부착되지 않았다 → 당시 **모든 background 필드는 생성에 0의 영향**이었다. **(2026-06-25 갱신: 배경 `name`/`aliases` 자동 탐지가 추가되어, 본문에 배경 표기형이 등장하면 frontmatter 없이도 부착된다. `aliases`를 채운 배경은 더 이상 dead가 아니다.)**
- `relations` · `arc` · `recentDialogues` · `profile` · character `tags`는 **어떤 생성 프롬프트에서도 참조되지 않는다**(UI·그래프·hover·스냅샷 전용).

## 검증 방법

데이터 흐름: `card 파일 → buildSceneContext → PersonaGenerationPrompt → 페르소나 문자열 → PersonaDialoguePrompt → GenreFormatting`.
카드 필드가 텍스트로 들어가는 지점은 **persona 생성 한 곳**뿐이다.

핵심 근거 (코드 위치):

- `packages/story-ai/src/ai/prompts/personaGeneration.ts` — character에서 **`name`, `voice`, `description`, `role`, `attributes`(키 정렬), `traits`(slice 0,10)** 사용.
- `packages/story-ai/src/ai/prompts/personaDialogue.ts` — `background.description`, `background.tags`만 사용.
- `packages/story-format/src/sceneContext.ts` — `name` + `aliases`로 인물 **탐지**.
- `packages/story-pipeline/src/sceneGenerationPipeline.ts` — `name` + `aliases`로 상황별 페르소나 **스코핑**.
- `packages/story-format/src/sceneContext.ts` (`resolveSceneBackground`/`detectSceneBackground`) — `scene.frontmatter.location`이 있으면 그 id로, 없으면 본문에서 `name`+`aliases` 자동 탐지(가장 긴 일치 토큰 1개)로 부착(2026-06-25 추가). 어느 쪽으로도 매칭이 없으면 `createEmptyBackground` → 배경 필드 무시.

## 영향력 높은 파라미터

카드 필드 중 생성에 닿는 것은 사실상 8개다(배경 부착 필드는 조건부).

| 순위 | 파라미터 | 경로 | 영향 |
|---|---|---|---|
| 1 | **`voice`** | personaGeneration "목소리·말투" | 최대 레버. 화자의 화법·어조 전체를 좌우(만재 허세체, 은하 직설). |
| 2 | **`aliases`** | 탐지 + 스코핑 | 임계. 없으면 인물이 씬에 아예 포함되지 않음(소스가 약칭만 쓸 때). |
| 3 | **`name`** | 탐지 · 대사 화자 귀속 | 정체성. |
| 4 | **`traits`** | personaGeneration "특징"(앞 10개) | 행동 패턴. |
| 5 | **`description`** | personaGeneration "설명" | 인물 한 줄 맥락. |
| 6 | **`role`** | personaGeneration "역할" | 약함(한 줄). |
| 7 | **`attributes`** | personaGeneration "속성"(키 정렬) | 성별·나이·MBTI 등 압축 프라이어(2026-06-25 추가). |
| 8 | **`desire`** | personaGeneration "목표" | 인물 동기·목표(2026-06-25 추가). |
| 9 | `background.description` | backgroundDescription/personaDialogue | location/자동탐지 부착 시에만. |
| 10 | **`background.time`·`weather`·`senses`** | backgroundDescription "시간/날씨/감각" | 드로잉 감각 묘사 입력(2026-06-25 추가), 부착 시에만. |
| 11 | `background.tags` | personaDialogue "태그" | 부착 시에만, 미미. |

> 참고 — 실제로 가장 큰 생성 레버는 **카드 밖**에 있다: `setting.pov`, `setting.styleConstraints`, `setting.genre`(→ styleDirective), `scene.frontmatter.relationStage` / `characters` / `location`. 카드 슬림화와 별개로 이쪽이 품질에 더 크게 작용한다.

## 영향력 없는 파라미터 (생성 경로에서 참조 0)

| 파라미터 | 생성 | 다른 기능에서의 사용처(삭제 시 영향) |
|---|---|---|
| **`relations`** | 0 | 관계 그래프(`relationGraphData`), hover, id 리네임(`cardReferenceRewriter`) |
| **`arc`** | 0 | 카드 에디터 UI(`CardEditor.tsx`, `ArcField.tsx`) |
| **`recentDialogues`** | 0 | hover, **traits-updater가 자동 기록**(생성은 안 읽음) |
| **`profile`** | 0 | 캐릭터 이미지(`CardCustomEditorProvider`), hover |
| character **`tags`** | 0 | `sceneCache` 스냅샷, UI (persona엔 `traits`만 들어감) |
| `background.characterIds` | 0 | — |
| `background.locationKind` | 0 | 구조용 |
| `arc.sceneRef` / `relations.type` (하위필드) | 0 | 그래프 · UI |
| (이 프로젝트) **모든 background 필드** | 0→조건부 | 과거 `frontmatter.location` 부재로 미부착. 2026-06-25 자동 탐지 추가 후, 본문에 `name`/`aliases` 등장 시 부착 |

## 권고

1. **생성 품질 투자처는 좁다**: `voice` · `aliases` · `traits` · `description`(+`name`/`role`)에만 집중하면 된다. 나머지 카드 필드를 채우는 것은 draft 품질에 무의미하다.
2. **삭제는 노이즈 제거가 아니다**: 위 "영향력 없는" 필드는 애초에 프롬프트에 주입되지 않으므로, 채워도 생성에 노이즈를 더하지 않는다. 즉 *지운다고 draft가 좋아지지 않는다*. 지우는 동기는 "스키마/입력 작업 단순화"여야 한다.
3. **하드 삭제 비용**: `relations`(그래프) · `arc`(에디터) · `recentDialogues`(hover/자동기록) · `attributes`/`profile`/`tags`(UI/스냅샷)는 다른 코드가 읽는다. 스키마에서 제거하려면 그 UI/그래프/hover/sceneCache 코드도 함께 정리해야 한다.
4. **무비용 축소**: 생성 목적의 채움을 중단하는 것은 즉시 무비용(draft 영향 0). 진짜 스키마 슬림화는 별도 리팩터링 과제로 분리할 것.
5. **background 자동 탐지(2026-06-25 구현됨)**: 이제 `frontmatter.location`이 없어도 본문에서 배경 `name`/`aliases`를 탐지해 부착한다. 배경 `aliases`에 본문 표기형을 넣으면 `description`/`tags`가 생성에 닿는다. 소스 씬을 고치지 않고도 배경을 살릴 수 있다.

## 입력 주체 분류 (수기 vs AI 자동)

생성 영향도와 별개로, 각 필드를 **누가 채우는가**로 나눈다. 카드 에디터(`webview-ui`)는 이 분류를 따른다:
수기 필드는 `편집` 탭에 단일 목록형으로 노출하고, AI 자동 필드는 스키마/YAML에 유지하되 입력란을 두지 않는다.

| 구분 | 캐릭터 | 배경 |
|---|---|---|
| **수기 입력** (작가 의도·정체성) | `id`(읽기전용)·`name`·`voice`·`aliases`·`role`·`description`·`tags`·`profile` | `type`·`id`(읽기전용)·`name`·`description`·`tags`·`locationKind`(location) |
| **AI 자동 갱신** (이야기 진행 누적) | `traits`·`recentDialogues`·`attributes`·`arc`·`relations` | `characterIds` |

`voice`·`description`(캐릭터)와 `description`(배경)은 긴 산문 대신 **항목 목록(`string[]`)**으로 입력한다. 프롬프트·해시 등 텍스트가 필요한 경계에서는 `joinCardText`로 결합하므로 하류 계약은 문자열을 유지한다. 산문으로 작성된 기존 카드는 `storyboard.cards.migrateTextToList` 명령으로 줄 단위 목록으로 변환한다.

자동 갱신은 `storyboard.draft.updateCardsAfterGenerate`(기본 off)가 켜진 경우에만 동작하며, 방식은 두 가지다.

| 필드 | 자동화 방식 | 코드 |
|---|---|---|
| `traits`·`recentDialogues` | 카드에 직접 기록(append) | `src/infrastructure/ai/traitsUpdater.ts` |
| 배경 `characterIds` | 부착 배경 카드에 등장 인물 id를 결정적 append | `src/infrastructure/ai/backgroundCharacterUpdater.ts` |
| `attributes`·`arc`·`relations` | AI 추출 → `.storyboard/cache/cards/<scene>.json` 후보 → `Promote Card Candidates`로 승격 | `src/infrastructure/ai/cardCandidateUpdater.ts`, `src/domain/cardCandidatePromotion.ts` |

- `arc`·`relations`는 카드 에디터 `AI 기록` 탭에서 **읽기 전용 시각화**(아크 곡선·관계 미리보기)로 표시된다.
- 환각 완화: 후보는 승격 게이트를 거치고, relation `target`은 실제 카드 id로 해석되는 경우만, attributes는 카드에 없는 key만 제안된다(기존 값 비파괴).
- 추출 후 자기검증: `storyboard.draft.verifyCardCandidates`(기본 on)가 켜지면, 캐시에 적재하기 전에 각 후보가 본문에 명시되었는지 인물별 1회 재확인해 명시된 항목만 남긴다(검증 호출 실패 시에는 추출 결과를 그대로 유지). 인물당 검증 호출 1회가 추가된다.
- 승격 후 정리: `Promote Card Candidates`로 카드에 반영된 후보는 캐시(`.storyboard/cache/cards/<scene>.json`)에서 제거되고, 남은 후보가 없는 파일은 삭제된다. 같은 항목이 다음 승격 목록에 다시 뜨지 않는다(bible 후보는 보존되는 것과 대비된다).

## 부록: 필드별 코드 사용처 요약

- 생성(persona): `personaGeneration.ts` → `name`, `voice`, `description`, `desire`, `role`, `attributes`, `traits`
- 생성(배경, 조건부): `backgroundDescription.ts` → `name`, `description`, `time`, `weather`, `senses`, `tags`; 결과 분위기는 `personaDialogue.ts`에 주입
- 탐지/스코핑: `sceneContext.ts`, `sceneGenerationPipeline.ts` → `name`, `aliases`
- UI/그래프/hover/스냅샷 전용(생성 무관): `relations`, `arc`, `recentDialogues`, `profile`, character `tags`, `background.characterIds`, `background.locationKind`
