# 02. 카드 파일과 커스텀 에디터 Phase 2 정책

> 작성일: 2026-05-03  
> 범위: Phase 2 — 파일 시스템 + Card Custom Editor

## 결정 요약

Phase 2에서는 `.card` 파일을 Storyboard 캐릭터·배경 자료의 source of truth로 둔다. `.card`의 실제 저장 포맷은 사람이 읽고 Git diff로 검토하기 쉬운 YAML이며, 커스텀 에디터는 이 YAML을 폼 UI로 렌더링하는 얇은 표현 계층으로 구현한다.

## 결정 사항

### 1. 카드 id는 파일명 안전성을 우선한다

카드의 `id`는 `^[a-z0-9][a-z0-9-]*$` 패턴만 허용한다. 한글 이름은 `name`에 저장하고, 파일명과 참조에 쓰이는 `id`는 영문 소문자·숫자·하이픈으로 별도 입력받는다.

이 정책은 다음을 보장하기 위한 것이다.

- `character/<id>.card`, `background/<id>.card` 파일명 안정성
- Git과 여러 OS 파일 시스템에서의 호환성
- 씬 frontmatter, 관계 참조, 캐시 파일명에서 일관된 식별자 사용

### 2. TextDocument가 카드 편집의 source of truth다

커스텀 에디터의 폼 상태는 `TextDocument`에서 파생한다. Webview에서 사용자가 폼을 수정하면 extension host가 카드 객체를 안정적인 YAML로 직렬화하고 문서 전체 범위를 교체한다.

초기 구현은 **전체 텍스트 replace** 방식으로 시작한다. diff patch 방식은 양방향 동기화와 충돌 처리가 실제로 필요해지는 시점에 진화시킨다.

외부 텍스트 에디터에서 `.card` YAML이 직접 수정되면 커스텀 에디터는 문서 변경 이벤트를 받아 폼을 다시 로드하거나 reload 안내를 표시한다.

### 3. 카드 코덱은 먼저 순수 함수로 검증한다

`files/card.ts`의 `parseCard`와 `serializeCard`는 round-trip 테스트가 가능한 핵심 단위다. VSCode 파일 시스템에 의존하는 `readCardFile`/`writeCardFile`은 얇은 래퍼로 유지한다.

Round-trip 테스트는 다음을 검증한다.

- YAML → 도메인 객체 → YAML 출력의 안정성
- 사람이 읽기 쉬운 키 순서 유지
- 잘못된 YAML과 스키마 위반의 명확한 에러 분류

### 4. 테스트 러너는 Vitest를 도입한다

Phase 2.1부터 단위 테스트 러너로 Vitest를 사용한다. VSCode Extension 통합 테스트는 더 무거우므로 Phase 5 이후 `@vscode/test-electron`으로 별도 도입한다.
