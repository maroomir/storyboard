# Storyboard 에디터 가이드 (Phase 6)

이 문서는 `draft/*.md` 편집 중 사용하는 Phase 6 기능의 실제 사용 흐름을 정리합니다.

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

## 3) 선택 영역 확장

- 명령: `Storyboard: Expand Selection (Draft)`
- CodeLens: `🌿 Expand`
- 동작: 선택한 텍스트를 문체를 유지한 채 확장해 같은 위치에 치환합니다.
- 주의: 선택 영역이 비어 있으면 확장하지 않고 안내 메시지를 표시합니다.

## 4) 캐릭터 Hover 카드

- 대상: `draft/*.md` 본문에서 캐릭터 이름 위 Hover
- 표시 정보
  - 캐릭터 기본 요약
  - traits
  - recentDialogues
  - 관계 캐릭터 요약
- 데이터 소스: 워크스페이스 `character/*.card` 파일

## 5) 동작하지 않을 때 점검

1. 워크스페이스에 `.storyboard/project.json`이 있는지 확인
2. 파일이 `draft/*.md` 경로인지 확인
3. 기본 provider 및 task provider 설정(`Storyboard: Open Settings`) 확인
4. 원격 provider 사용 시 API 키 저장 여부 확인(`Storyboard: Set API Key...`)
5. 로컬 provider(Ollama) 사용 시 base URL/model 설정 확인
