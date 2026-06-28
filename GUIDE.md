# Storyboard 에디터 가이드

이 문서는 `draft/*.md` 편집 중 사용하는 기능의 실제 사용 흐름을 정리합니다.

## 1) 인라인 완성

- 대상: `draft/*.md`
- 동작: 커서 앞 문맥을 기준으로 Ghost Text 제안을 표시합니다.
- 수락: 기본 VS Code 인라인 제안 수락 키(일반적으로 `Tab`)를 사용합니다.
- 주의: 디바운스(약 700ms)와 메모리 캐시가 적용되어 즉시 반복 호출되지 않을 수 있습니다.

## 2) 문법 검사 + Quick Fix

- 실행 방법
  - 저장 시 자동 검사
  - 명령: `Storyboard: Grammar Check (Draft)`
  - CodeLens: `🩹 Grammar Check`
- 결과: 경고 진단(`squiggle`)이 표시됩니다.
- 수정: 문제 구간에서 Quick Fix를 실행하면 제안 교정문을 적용할 수 있습니다.
- 실시간 검사: `storyboard.grammar.realtimeEnabled`가 `true`일 때만 입력 중 검사합니다.

## 3) 연속성 검사

- 대상: `draft/*.md` (프로젝트에 `.storyboard/bible/canon.yaml` 정전 설정이 있을 때)
- 실행 방법
  - 명령: `Storyboard: Continuity Check (Draft)`
  - CodeLens: `🧭 Continuity Check`
- 동작: 초안 본문을 등장 인물/배경의 정전(canon) 설정과 대조해 모순되는 구간을 경고 진단으로 표시합니다.
- 주의: 해당 씬에 적용되는 canon 사실이 없으면 모델을 호출하지 않고 건너뜁니다.
- canon 채우기: 초안을 생성하면 설정 사실 후보가 자동 추출됩니다. `Storyboard: Promote Bible Candidates to Canon` 명령으로 후보를 골라 canon으로 승격하면 주입·검사 대상이 됩니다.

## 4) 선택 영역 확장

- 명령: `Storyboard: Expand Selection (Draft)`
- CodeLens: `🌿 Expand`
- 동작: 선택한 텍스트를 문체를 유지한 채 확장해 같은 위치에 치환합니다.
- 주의: 선택 영역이 비어 있으면 확장하지 않고 안내 메시지를 표시합니다.

## 5) 카드 기반 보충 (재생성 없이)

- 명령: `Storyboard: Supplement Draft from Cards` / `Storyboard: Update Selection from Cards`
- CodeLens: `✨ Augment from Cards`(본문 전체) / `🪄 Update Selection`(선택 영역)
- 동작: 초안을 **재생성하지 않고**, 현재 캐릭터·배경 카드와 정전(canon) 설정을 기존 본문에 자연스럽게 녹여 보충합니다. 사건 전개·문체·사용자가 직접 고친 부분은 보존합니다.
  - `✨ Augment from Cards`: 본문 전체를 대상으로 보충합니다.
  - `🪄 Update Selection`: 선택한 영역만 보충합니다(선택이 비어 있으면 안내 메시지).
- diff 미리보기: 적용 전 VSCode 네이티브 diff 편집기로 변경 전/후를 보여 주고, 알림의 **적용**을 눌러야 반영됩니다. **취소** 시 본문은 그대로입니다.
- 기록: `storyboard.draft.keepHistory`가 켜져 있으면 적용 직전 초안을 `.draft` 히스토리에 보관합니다.
- 카드를 갱신한 뒤 재생성으로 직접 편집분을 잃고 싶지 않을 때 사용합니다.

## 6) 초안 검수·재작성 루프

- 명령: `Storyboard: Review & Revise Draft (Current Scene)` — 기존 초안에 검수·재작성만 다시 돌리고 싶을 때 사용합니다.
- 자동 실행: `storyboard.draft.reviseAfterGenerate`가 기본 `true`라, 초안 생성(Generate / Regenerate / Generate All) 직후 이 루프가 자동으로 이어집니다. 한 동작으로 검수된 초안이 나오므로 위 명령을 따로 실행할 필요가 없습니다. 비용을 줄이려면 이 설정을 끕니다.
- 동작: 현재 초안을 연속성 검사와 비평(캐릭터 보이스, 장면 목적, 반복)으로 검수하고, 차단 이슈가 있으면 재작성합니다.
- 반복 횟수: `storyboard.draft.reviseMaxIterations` 설정을 따릅니다(기본 2, 최대 5).
- 점수 기준(선택): `storyboard.draft.reviseScoreThreshold`(0–100, 기본 0=비활성)을 설정하면, 비평 루브릭 점수가 기준 이상일 때 루프를 한 번 일찍 통과시킵니다. 기본값 0에서는 동작이 기존과 동일하며 AI 호출 수가 늘지 않습니다. 연속성 high 이슈는 점수와 무관하게 계속 차단합니다. 최종 검사 보고서에는 `비평 점수: NN/100` 줄이 함께 표시됩니다.
- 기록: 씬별 검수 시각, 재작성 횟수, 남은 차단 이슈, 재작성 지시를 `.storyboard/outline/revision-plan.yaml`에 누적합니다.
- 문체/품질 기준: `Storyboard: Open Settings`의 **작품 계약** 탭에 입력한 `styleConstraints`와 `qualityCriteria`가 비평 프롬프트에 반영됩니다.

## 7) 캐릭터 Hover 카드

- 대상: `draft/*.md` 본문에서 캐릭터 이름 위 Hover
- 표시 정보
  - 캐릭터 기본 요약
  - traits
  - recentDialogues
  - 관계 캐릭터 요약
- 데이터 소스: 워크스페이스 `character/*.card` 파일

## 8) 카드 에디터에서 draft 수집

- 대상: `character/*.card`, `background/*.card`를 커스텀 에디터로 열었을 때의 **수집** 탭
- 동작: **수집** 버튼을 누르면 이 카드가 등장하는 `draft/*.md`를 모아 LLM으로 카드에 추가할 정보를 추출합니다.
  - 캐릭터: 속성·관계·아크·특성·최근 대사·설명·화법·욕망
  - 배경: 설명·감각·시간·날씨·등장인물
- 검토: 제안은 git diff처럼 항목별 `+`(추가)/`-`→`+`(수정)으로 표시되며, 출처 씬도 함께 보여 줍니다.
- 신규 vs 수정: 관계는 target, 속성은 key, 시간/날씨, 아크는 sceneRef를 동일성 키로 봅니다. 같은 키가 없으면 추가, 있는데 값이 다르면 수정 제안으로 뜹니다. traits·설명·감각·대사 같은 자유 목록은 새 항목만 추가합니다.
- diff 미리보기: 체크박스로 항목을 고른 뒤 **diff 미리보기**를 누르면 VSCode 네이티브 diff 편집기가 현재 카드 YAML과 선택 반영본을 나란히 보여 줍니다.
- 반영: **선택 항목 반영**을 누르면 카드 YAML에 적용됩니다. 수정 항목은 사용자가 수락할 때만 기존 값을 덮어씁니다.

## 9) 캐릭터·배경 카드 추천

- 대상: 좌측 **Characters**/**Backgrounds** 뷰 헤더의 **추천**(✨) 버튼
- 동작: 프로젝트 전체 `scene/*.txt`와 `draft/*.md`를 모아 LLM으로 읽고, 본문에 등장하지만 해당 탭에 아직 카드가 없는 인물·배경을 찾아 제안합니다.
  - 캐릭터: 이름·역할(main/supporting/extra) 추정·한 줄 설명
  - 배경: 이름·한 줄 설명
- 선택·생성: QuickPick에서 추가할 항목을 다중 선택하면 `character/*.card`·`background/*.card`로 생성됩니다. 이름·역할/종류·설명만 채운 최소 카드이며, 사이드바는 자동 갱신됩니다.
- 보강: 생성 후 세부 설정은 카드 에디터의 **수집** 탭(§7)으로 채웁니다.
- 이미 카드가 있는 이름과 별칭은 제안에서 제외됩니다.

## 10) 동작하지 않을 때 점검

1. 워크스페이스에 `.storyboard/project.json`이 있는지 확인
2. 파일이 `draft/*.md` 경로인지 확인
3. 기본 provider 및 task provider 설정(`Storyboard: Open Settings`) 확인
4. 원격 provider 사용 시 API 키 저장 여부 확인(`Storyboard: Set API Key...`)
5. 로컬 provider(Ollama) 사용 시 base URL/model 설정 확인
