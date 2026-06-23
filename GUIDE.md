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

## 5) 초안 검수·재작성 루프

- 명령: `Storyboard: Review & Revise Draft (Current Scene)` — 기존 초안에 검수·재작성만 다시 돌리고 싶을 때 사용합니다.
- 자동 실행: `storyboard.draft.reviseAfterGenerate`가 기본 `true`라, 초안 생성(Generate / Regenerate / Generate All) 직후 이 루프가 자동으로 이어집니다. 한 동작으로 검수된 초안이 나오므로 위 명령을 따로 실행할 필요가 없습니다. 비용을 줄이려면 이 설정을 끕니다.
- 동작: 현재 초안을 연속성 검사와 비평(캐릭터 보이스, 장면 목적, 반복)으로 검수하고, 차단 이슈가 있으면 재작성합니다.
- 반복 횟수: `storyboard.draft.reviseMaxIterations` 설정을 따릅니다(기본 2, 최대 5).
- 점수 기준(선택): `storyboard.draft.reviseScoreThreshold`(0–100, 기본 0=비활성)을 설정하면, 비평 루브릭 점수가 기준 이상일 때 루프를 한 번 일찍 통과시킵니다. 기본값 0에서는 동작이 기존과 동일하며 AI 호출 수가 늘지 않습니다. 연속성 high 이슈는 점수와 무관하게 계속 차단합니다. 최종 검사 보고서에는 `비평 점수: NN/100` 줄이 함께 표시됩니다.
- 기록: 씬별 검수 시각, 재작성 횟수, 남은 차단 이슈, 재작성 지시를 `.storyboard/outline/revision-plan.yaml`에 누적합니다.
- 문체/품질 기준: `Storyboard: Open Settings`의 **작품 계약** 탭에 입력한 `styleConstraints`와 `qualityCriteria`가 비평 프롬프트에 반영됩니다.

## 6) 캐릭터 Hover 카드

- 대상: `draft/*.md` 본문에서 캐릭터 이름 위 Hover
- 표시 정보
  - 캐릭터 기본 요약
  - traits
  - recentDialogues
  - 관계 캐릭터 요약
- 데이터 소스: 워크스페이스 `character/*.card` 파일

## 7) 동작하지 않을 때 점검

1. 워크스페이스에 `.storyboard/project.json`이 있는지 확인
2. 파일이 `draft/*.md` 경로인지 확인
3. 기본 provider 및 task provider 설정(`Storyboard: Open Settings`) 확인
4. 원격 provider 사용 시 API 키 저장 여부 확인(`Storyboard: Set API Key...`)
5. 로컬 provider(Ollama) 사용 시 base URL/model 설정 확인
