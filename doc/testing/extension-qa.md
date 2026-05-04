# Storyboard 확장 — MVP QA 체크리스트

Phase 5 MVP 게이트용 수동 검증 가이드이다. 자동화 테스트(`npm test`)는 결정적 로직 위주이며, 아래 항목은 **실제 VSCode에서 F5(Extension Development Host)** 로 확인한다.

## 환경 매트릭스 (권장)

| OS            | 입력기        | VSCode        | 비고                          |
| ------------- | ------------- | ------------- | ----------------------------- |
| macOS         | 한글 IME      | Stable        | 기본 개발 환경                |
| Windows       | 한글 IME      | Stable        | 경로·줄바꿈 차이              |
| Linux (선택)  | 한글 IME      | Stable        | 파일 감시·권한                |

Insiders는 선택적으로 한 번만 스모크 테스트해도 된다.

## End-to-end — “빈 폴더 → MVP 플로우”

워크스페이스에 Storyboard가 없는 빈(또는 테스트용) 폴더를 연 뒤 순서대로 진행한다.

1. **초기화**: 명령 팔레트에서 `Storyboard: Initialize Project` 실행 → `.storyboard/project.json`, `character/`, `background/`, `scene/`, `draft/` 등 표준 트리 생성 확인.
2. **캐릭터·배경 카드**: 사이드바 Characters / Backgrounds에서 추가 → `.card` 파일 생성 및 커스텀 에디터로 열림 확인.
3. **씬 작성**: `scene/*.txt` 파일 작성 또는 `Storyboard: New Scene`으로 생성 → 본문·옵션 frontmatter 저장.
4. **드래프트 생성**: 씬 파일에서 CodeLens `Generate Draft` / `Regenerate` 또는 명령 `Storyboard: Generate Draft` → `draft/<stem>.md` 생성 및 열림 확인.
5. **드래프트 CodeLens**: `draft/*.md` 첫 줄 근처에 `Re-generate Draft`, `Grammar Check`, `Expand` 표시 → Re-generate는 동작, Grammar/Expand는 “Phase 6 예정” 안내 확인.
6. **Scenes 사이드바**: Scenes 뷰에서 목록·상태 배지(준비/구버전/미생성)·`Generate` / `Open Draft` 등 워크플로 확인.
7. **관계 그래프**: `Storyboard: Open Character Relation Graph` 실행 → 캐릭터 노드·링크 표시, 노드 드래그 동작 확인.
8. **캐시**: 동일 씬에 대해 재생성 없이 다시 생성 시 캐시 hit 메시지 또는 기대 동작 확인(프로젝트 설정·입력 동일 전제).
9. **API 키**: `Storyboard: Set API Key...`로 provider별 키 등록(또는 `mock`으로 스모크) 후 생성 파이프라인 재실행.

## 회복·에러 시나리오

- **API 키 없음**: 실 provider 선택 시 명확한 오류 또는 안내 메시지, Output 채널에 민감 정보 미노출.
- **잘못된 YAML**: `.card` 또는 씬 frontmatter 깨짐 시 확장이 전체 비활성화되지 않고, 해당 기능에서만 오류 처리되는지.
- **없는 이미지**: 카드가 참조하는 프로필/컨셉 이미지 경로가 없을 때 UI가 깨지지 않는지.
- **네트워크 끊김**: OpenAI/Claude 등 원격 호출 시 타임아웃·실패 메시지가 사용자에게 전달되는지.

## 패키징 (후속 게이트)

- `vsce package` 성공 및 산출 `.vsix` 용량 **50MB 미만**(Phase 5 이후 릴리스 준비 단계에서 기록).
- `package` 스크립트는 저장소의 `package.json` 정의를 따른다.

## 기록

검증 일자·커밋 SHA·발견 이슈는 PR 또는 이슈 트래커에 남긴다.
