# Storyboard

Storyboard는 작가가 VS Code에서 소설과 시나리오를 작업하기 위한 AI 기반 픽션 IDE 확장입니다.

English README: [`README.en.md`](README.en.md)

## 주요 기능

- 워크스페이스 폴더 하나를 하나의 Storyboard 프로젝트로 초기화
- `character/*.card`, `background/*.card` 기반 캐릭터/배경 카드 관리
- `.card` 파일용 커스텀 에디터와 Characters / Backgrounds 사이드바
- `scene/*.txt` 기반 씬 관리와 `draft/*.md` 초안 생성
- 씬 CodeLens와 사이드바 액션을 통한 드래프트 생성/재생성
- `.storyboard/bible/canon.yaml` 정전 설정 주입과 초안 연속성 검사
- 초안에서 설정 사실 후보 자동 추출 후 canon 승격(`Promote Bible Candidates to Canon`)
- 캐릭터 관계 그래프
- `mock`, OpenAI, Claude, Google, Ollama AI provider 지원
- seedcoat `.seed` 저장소 아카이브 가져오기/보내기(Seeds와 호환)

## 프로젝트 모델

```text
.storyboard/project.json
character/*.card
background/*.card
scene/*.txt
draft/*.md
```

- 워크스페이스 폴더 하나가 프로젝트 하나입니다.
- `.card` 파일은 YAML 기반 자료 카드입니다.
- `scene/*.txt` 파일 하나가 씬 하나입니다.
- `draft/*.md` 파일은 AI가 생성한 초안입니다.

## 로컬 실행

```bash
npm install
npm run build
```

1. VS Code에서 저장소 루트를 엽니다.
2. **Run and Debug**에서 `Run Extension`을 선택하고 F5를 누릅니다.
3. Extension Development Host 창에서 빈 폴더를 엽니다.
4. `Storyboard: Initialize Project`를 실행합니다.
5. Activity Bar의 Characters / Backgrounds / Scenes 뷰에서 카드와 씬을 생성합니다.

API 키 없이도 기본 `mock` provider로 흐름을 확인할 수 있습니다. 실제 provider를 쓰려면 `Storyboard: Set API Key...` 명령으로 키를 저장합니다.

## 개발

| 명령 | 용도 |
| --- | --- |
| `npm run compile` | 확장 호스트 번들 빌드 |
| `npm run build:webview` | 웹뷰 UI 빌드 |
| `npm run build` | 확장 호스트와 웹뷰 UI 전체 빌드 |
| `npm run lint` | ESLint 및 웹뷰 TypeScript 검사 |
| `npm test` | Vitest 테스트 실행 |
| `npm run package:vsix` | 로컬 설치용 VSIX 생성 |

웹뷰만 수정한 경우에는 `npm run build:webview` 후 Extension Development Host에서 `Developer: Reload Window`를 실행하면 됩니다.

## `.seed` 가져오기/보내기

- 명령: `Storyboard: Create Project from Seed...`, `Sync Project from Seed...`, `Export Project to Seed...`
- `.seed`는 [`@seedcoat/wasm`](https://github.com/maroomir/seedcoat) v0.4.0 **저장소 아카이브**(`seedcoat archive v1`)이며 전체 변경 이력을 보존합니다. 구 암호화 바이너리(v0.2)와 평문 JSON envelope는 지원하지 않습니다.
- `.seed`는 **암호화되지 않습니다**. 패스프레이즈는 사용하지 않으며, 내보내기 시 비암호화 고지를 1회 표시합니다.
- 캐릭터 `arc` / `recentDialogues` / `profile` / `attributes`와 `draft/`는 `.seed`에 포함되지 않습니다.
- 정책 요약: [`STORYBOARD_ALIGNMENT.md`](STORYBOARD_ALIGNMENT.md)

## 문서

공개 문서는 저장소 루트의 대문자 Markdown을 기준으로 합니다. 상세 계획·의사결정 기록 등 확장 문서는 원격에 포함되지 않으며, 필요 시 로컬에만 `.doc/` 디렉터리를 두고 관리할 수 있습니다.

- [`GETTING_STARTED.md`](GETTING_STARTED.md): 작가용 시작 가이드 (초보자용 전체 흐름)
- [`ARCHITECTURE.md`](ARCHITECTURE.md): 제품 아키텍처와 파일 모델
- [`STORYBOARD_ALIGNMENT.md`](STORYBOARD_ALIGNMENT.md): Seeds ↔ Storyboard `.seed` 정책
- [`GUIDE.md`](GUIDE.md): draft 편집 기능 사용법
- [`EXTENSION_QA.md`](EXTENSION_QA.md): 수동 QA 체크리스트
- [`RELEASE.md`](RELEASE.md): 릴리스 절차
- [`CHANGELOG.md`](CHANGELOG.md): 변경 내역 (한국어)

## 라이선스

Apache License 2.0 — [`LICENSE`](LICENSE)
