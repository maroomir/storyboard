# 03. AI Provider Bridge Phase 3 정책

> 작성일: 2026-05-03  
> 범위: Phase 3 — AI 서비스 이식 + Secret + 설정

## 결정 요약

Phase 3에서는 Picktion의 AI 핵심을 Storyboard extension host로 옮기기 전에, VSCode 런타임에 맞는 얇은 어댑터 경계를 먼저 만든다. API 키는 `vscode.SecretStorage`, 사용자 설정은 `vscode.workspace.getConfiguration('storyboard')`를 source of truth로 둔다.

## 결정 사항

### 1. 기본 provider는 `mock`이다

초기 dogfooding과 테스트를 위해 `storyboard.defaultProvider`의 기본값은 `mock`으로 둔다. 사용자는 API 키 없이도 extension 흐름을 확인할 수 있고, 실제 provider 연결은 명시적으로 설정한 뒤 사용한다.

### 2. API 키는 설정에 저장하지 않는다

API 키는 `SecretStore`가 `vscode.ExtensionContext.secrets`에만 저장한다. 키 이름은 `storyboard.apiKey.<provider>` 패턴을 사용한다.

`SecretStore`는 다음 작업만 책임진다.

- `setApiKey(provider, key)`
- `getApiKey(provider)`
- `deleteApiKey(provider)`
- `hasApiKey(provider)`
- provider별 키 변경 이벤트 필터링

### 3. 설정은 `ConfigBridge`를 통해 읽는다

AI provider 코드가 VSCode API에 직접 의존하지 않도록 `ConfigBridge`를 둔다. Provider 구현은 호출 시점마다 `ConfigBridge`를 통해 최신 모델과 task override를 읽는다.

우선순위는 다음과 같다.

1. `storyboard.tasks.<taskName>.provider`
2. `storyboard.defaultProvider`
3. 안전한 fallback인 `mock`

### 4. Provider 이식 전 추상 타입을 먼저 둔다

`src/services/ai/types.ts`에 provider id와 task 이름의 최소 공용 타입을 둔다. 실제 provider registry와 `checkConnection()` 구현은 후속 PR-3b/3c에서 추가한다.

### 5. 비결정적 LLM 호출은 직접 snapshot 테스트하지 않는다

Phase 3 테스트는 SecretStore, ConfigBridge, mock provider, 결정적 parser/traits 유틸에 집중한다. 실제 LLM 응답은 후속 provider PR에서 연결 상태와 응답 스키마 통과 여부만 검증한다.

## 후속 작업

- PR-3b: provider registry, mock provider, OpenAI provider, `ai.*` RPC의 최소 연결
- PR-3c: Claude, Google, Ollama provider 추가
- PR-3d: Picktion AI 유틸/fixture 테스트와 문서 마무리
