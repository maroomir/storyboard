# 04. 설정 패널 (Settings Webview)

> 작성일: 2026-05-05  
> 범위: 풀 탭 WebviewPanel 기반 설정 UI, ConfigBridge 쓰기, SecretStore, 설정/비밀 RPC

## 결정 요약

사용자 설정은 VSCode `workspace.getConfiguration('storyboard')`를 단일 소스로 두고, `ConfigBridge`로 읽기·쓰기를 모두 통과시킨다. API 키는 기존과 같이 `SecretStore`만 사용한다. 설정 UI는 사이드바가 아니라 **에디터 영역의 단일 WebviewPanel**로 연다 (`RelationGraphProvider`와 유사한 단일 인스턴스 패턴).

## 패널 구조

- 명령: `storyboard.settings.open` — Characters / Backgrounds / Scenes 사이드바 타이틀 메뉴에서도 동일 명령으로 진입 가능.
- Webview 엔트리: `window.__STORYBOARD_VIEW__ === "settings"`일 때 `SettingsView` React 컴포넌트를 마운트한다.
- 호스트는 `createWebviewBridge`에 AI RPC 핸들러와 `createSettingsRpcHandlers` 결과를 합쳐 등록한다.

## RPC 표면 (확장)

웹뷰 ↔ 호스트 메시지는 기존 `parseStoryboardRequestMessage` 경계에서 zod로 검증한다.

| Method | 역할 |
|--------|------|
| `settings.read` | 기본 provider, `listProviders()` 상태, provider별 모델·Ollama baseUrl, 태스크별 override, **모델 카탈로그** 스냅샷 |
| `settings.updateDefaultProvider` | `ConfigBridge.setDefaultProvider` |
| `settings.updateProviderModel` | `ConfigBridge.setProviderModel` — **모델 ID는 `storyboardModelCatalog`에 있을 때만 허용** |
| `settings.updateProviderBaseUrl` | Ollama 전용, `ConfigBridge.setProviderBaseUrl` |
| `settings.updateTaskProvider` | `null`이면 override 제거, 아니면 `tasks` 객체 전체 머지 후 저장 |
| `secrets.writeApiKey` / `secrets.deleteApiKey` | SecretStorage 반영 |

호스트 → 웹뷰 이벤트: `{ type: "event", method: "settings.changed", payload }` — 페이로드는 `settings.read`와 동형이라 UI가 외부에서 설정/비밀이 바뀐 뒤에도 동기화할 수 있다.

## 모델 입력

- **사전 정의 카탈로그만** 허용 (`src/shared/models.ts`의 `storyboardModelCatalog`). 자유 텍스트 모델 ID나 원격 모델 목록 자동 디스커버리는 이 단계에서 도입하지 않는다.
- `package.json`에 선언된 각 provider 기본 모델 문자열은 카탈로그 ID와 정합되도록 유지한다(회귀 테스트로 검증).

## Cline 대비 단순화

다음은 **이번 설계에서 의도적으로 넣지 않은** 영역이다.

- Cline 스타일의 탭 분할·복합 모드(Plan/Act 등) 전용 설정 트리
- 원격 설정 동기화, 멀티 워크스페이스 공유 프로필
- 사용량·비용·토큰 대시보드
- Ollama/OpenAI 등 **런타임 모델 리스트** 기반 피커

필요해지면 별도 결정 문서에서 범위를 잡고 RPC·UI를 확장한다.

## 후속 아이디어

- Ollama `tags` API 등으로 로컬 모델 목록을 채우는 옵션(옵트인)
- 설정 검색/필터,보내기·가져오기(민감 값 제외)
