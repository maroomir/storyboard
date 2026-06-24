# 카드 파라미터 영향도 리포트 (draft 생성 기준)

작성일: 2026-06-23
대상: `CharacterCard` / `BackgroundCard`의 각 필드가 **draft 생성**에 실제로 얼마나 기여하는가
배경: guerrila `01-first-meeting` 씬을 gt 수준으로 끌어올리는 9차 반복 튜닝 과정에서, 어떤 카드 파라미터가 결과를 움직이고 어떤 것이 무의미했는지 코드로 검증한 결과.

## TL;DR

- **카드 데이터를 draft 생성에 쓰는 프롬프트는 `PersonaGenerationPrompt` 하나뿐**이다. 거기서 읽는 character 필드는 `name` · `voice` · `description` · `role` · `traits`(앞 10개) **5개**가 전부다.
- `aliases`는 인물 **탐지/스코핑**에만, `background.description` / `background.tags`는 **씬에 `frontmatter.location`이 있어 배경이 부착될 때만** 쓰인다.
- guerrila의 씬은 frontmatter가 비어 있어(`---\n---`) 배경이 부착되지 않는다 → **모든 background 필드는 현재 생성에 0의 영향**.
- `relations` · `arc` · `recentDialogues` · `attributes` · `profile` · character `tags`는 **어떤 생성 프롬프트에서도 참조되지 않는다**(UI·그래프·hover·스냅샷 전용).

## 검증 방법

데이터 흐름: `card 파일 → buildSceneContext → PersonaGenerationPrompt → 페르소나 문자열 → PersonaDialoguePrompt → GenreFormatting`.
카드 필드가 텍스트로 들어가는 지점은 **persona 생성 한 곳**뿐이다.

핵심 근거 (코드 위치):

- `src/services/ai/prompts/personaGeneration.ts:11-17` — character에서 **`name`, `voice`, `description`, `role`, `traits`(slice 0,10)만** 사용.
- `src/services/ai/prompts/personaDialogue.ts:37-38` — `background.description`, `background.tags`만 사용.
- `src/core/sceneContext.ts:285-289` — `name` + `aliases`로 인물 **탐지**.
- `src/services/ai/pipelines/sceneGenerationPipeline.ts:152` — `name` + `aliases`로 상황별 페르소나 **스코핑**.
- `src/core/sceneContext.ts:297-301` — 배경은 `scene.frontmatter.location === bg.id`일 때만 부착. 없으면 `createEmptyBackground`(파이프라인 288행) → 배경 필드 전부 무시.

## 영향력 높은 파라미터

카드 필드 중 생성에 닿는 것은 사실상 6개뿐이다(7·8은 조건부).

| 순위 | 파라미터 | 경로 | 영향 |
|---|---|---|---|
| 1 | **`voice`** | personaGeneration "목소리·말투" | 최대 레버. 화자의 화법·어조 전체를 좌우(만재 허세체, 은하 직설). |
| 2 | **`aliases`** | 탐지 + 스코핑 | 임계. 없으면 인물이 씬에 아예 포함되지 않음(소스가 약칭만 쓸 때). |
| 3 | **`name`** | 탐지 · 대사 화자 귀속 | 정체성. |
| 4 | **`traits`** | personaGeneration "특징"(앞 10개) | 행동 패턴. |
| 5 | **`description`** | personaGeneration "설명" | 인물 한 줄 맥락. |
| 6 | **`role`** | personaGeneration "역할" | 약함(한 줄). |
| 7 | `background.description` | personaDialogue "배경 설명" | **location 부착 시에만**(guerrila 현재 0). |
| 8 | `background.tags` | personaDialogue "태그" | location 부착 시에만, 미미. |

> 참고 — 실제로 가장 큰 생성 레버는 **카드 밖**에 있다: `setting.pov`, `setting.styleConstraints`, `setting.genre`(→ styleDirective), `scene.frontmatter.relationStage` / `characters` / `location`. 카드 슬림화와 별개로 이쪽이 품질에 더 크게 작용한다.

## 영향력 없는 파라미터 (생성 경로에서 참조 0)

| 파라미터 | 생성 | 다른 기능에서의 사용처(삭제 시 영향) |
|---|---|---|
| **`relations`** | 0 | 관계 그래프(`relationGraphData`), hover, id 리네임(`cardReferenceRewriter`) |
| **`arc`** | 0 | 카드 에디터 UI(`CardEditor.tsx`, `ArcField.tsx`) |
| **`recentDialogues`** | 0 | hover, **traits-updater가 자동 기록**(생성은 안 읽음) |
| **`attributes`** | 0 | 카드 에디터 UI |
| **`profile`** | 0 | 캐릭터 이미지(`CardCustomEditorProvider`), hover |
| character **`tags`** | 0 | `sceneCache` 스냅샷, UI (persona엔 `traits`만 들어감) |
| `background.characterIds` | 0 | — |
| `background.locationKind` | 0 | 구조용 |
| `arc.sceneRef` / `relations.type` (하위필드) | 0 | 그래프 · UI |
| (이 프로젝트) **모든 background 필드** | 0 | `frontmatter.location` 부재로 미부착 |

## 권고

1. **생성 품질 투자처는 좁다**: `voice` · `aliases` · `traits` · `description`(+`name`/`role`)에만 집중하면 된다. 나머지 카드 필드를 채우는 것은 draft 품질에 무의미하다.
2. **삭제는 노이즈 제거가 아니다**: 위 "영향력 없는" 필드는 애초에 프롬프트에 주입되지 않으므로, 채워도 생성에 노이즈를 더하지 않는다. 즉 *지운다고 draft가 좋아지지 않는다*. 지우는 동기는 "스키마/입력 작업 단순화"여야 한다.
3. **하드 삭제 비용**: `relations`(그래프) · `arc`(에디터) · `recentDialogues`(hover/자동기록) · `attributes`/`profile`/`tags`(UI/스냅샷)는 다른 코드가 읽는다. 스키마에서 제거하려면 그 UI/그래프/hover/sceneCache 코드도 함께 정리해야 한다.
4. **무비용 축소**: 생성 목적의 채움을 중단하는 것은 즉시 무비용(draft 영향 0). 진짜 스키마 슬림화는 별도 리팩터링 과제로 분리할 것.
5. **background를 살리려면**: 소스 씬이 불변이라 `frontmatter.location`을 추가할 수 없으니, **배경 자동 탐지** 기능을 넣지 않는 한 background 파라미터는 이 프로젝트에서 영구 dead다.

## 입력 주체 분류 (수기 vs AI 자동)

생성 영향도와 별개로, 각 필드를 **누가 채우는가**로 나눈다. 카드 에디터(`webview-ui`)는 이 분류를 따른다:
수기 필드는 `편집` 탭에 단일 목록형으로 노출하고, AI 자동 필드는 스키마/YAML에 유지하되 입력란을 두지 않는다.

| 구분 | 캐릭터 | 배경 |
|---|---|---|
| **수기 입력** (작가 의도·정체성) | `id`(읽기전용)·`name`·`voice`·`aliases`·`role`·`description`·`tags`·`profile` | `type`·`id`(읽기전용)·`name`·`description`·`tags`·`locationKind`(location) |
| **AI 자동 갱신** (이야기 진행 누적) | `traits`·`recentDialogues`·`attributes`·`arc`·`relations` | `characterIds` |

- `traits`·`recentDialogues`는 `src/services/ai/traitsUpdater.ts`가 draft 생성 후 자동 갱신한다.
- `attributes`·`arc`·`relations`·`characterIds`는 현재 자동 갱신 코드는 없으나 입력 주체상 AI 누적값으로 분류해 입력란에서 제외한다(향후 자동화 대상). YAML에는 보존되며 `YAML` 탭에서 확인·편집할 수 있다.
- `arc`·`relations`는 `AI 기록` 탭에서 **읽기 전용 시각화**(아크 곡선·관계 미리보기)로만 표시한다.

## 부록: 필드별 코드 사용처 요약

- 생성(persona): `personaGeneration.ts` → `name`, `voice`, `description`, `role`, `traits`
- 생성(배경, 조건부): `personaDialogue.ts` → `background.description`, `background.tags`
- 탐지/스코핑: `sceneContext.ts`, `sceneGenerationPipeline.ts` → `name`, `aliases`
- UI/그래프/hover/스냅샷 전용(생성 무관): `relations`, `arc`, `recentDialogues`, `attributes`, `profile`, character `tags`, `background.characterIds`, `background.locationKind`
