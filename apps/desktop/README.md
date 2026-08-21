# Storyboard

Storyboard는 VS Code에서 장편 소설 한 권을 기획, 집필, 검수, 수정, 조립까지 자동 수행하는 것을 목표로 하는 AI 기반 픽션 IDE 확장입니다.

English README: [`README.en.md`](README.en.md)

## 주요 기능

- 목표 방향: 원클릭 장편 생성 IDE(Autonomous Fiction Studio)
- 워크스페이스 폴더 하나를 하나의 Storyboard 프로젝트로 초기화
- **작품 계약** 설정으로 장르·독자층·시점·목표 분량·금지 조건·문체/품질 기준 관리
- `Storyboard: Generate Novel`로 작품 설정 → outline → 씬 시드 → 초안·검수·재작성 → 원고 조립·검사·요약까지 실행
- `.storyboard/outline/synopsis.md`, `chapters.yaml`, `revision-plan.yaml` 기반 장편 구조 계획
- `character/*.card`, `background/*.card` 기반 캐릭터/배경 카드 관리
- `.card` 파일용 커스텀 에디터와 Characters / Backgrounds 사이드바
- outline에서 `scene/*.txt` 씬 시드를 만들고 `draft/*.md` 초안을 생성
- **Storyboard · Studio** 패널(항상 보이는 사이드바)에서 현재 Draft/Scene에 대해 대화로 작업을 지시 → 제안 확인 → 승인으로 실행(생성·재생성·검사·편집)
- 재생성 없이 카드 기반 보충: Studio 패널에서 **카드 기반 보충**(본문 전체)·**선택 영역 보충**(선택 영역)을 요청해 갱신된 카드·정전을 기존 초안에 녹이고, 적용 전 diff로 확인
- 이전 초안 히스토리 보관(`storyboard.draft.keepHistory`): 덮어쓰기 직전 초안을 `.draft/<scene>/<yyyy-mm-dd-hh-mm>-rev-NN.md`로 적재(기본 꺼짐)
- 장면 전환 구분자 삽입(`storyboard.draft.sceneBreakEnabled`/`sceneBreakSeparator`): 초안 생성 시 장면 사이에 `---` 구분선 또는 줄바꿈 n회를 삽입(기본 꺼짐)
- `.storyboard/bible/canon.yaml` 정전 설정 주입과 초안 연속성 검사
- 초안에서 설정 사실 후보 자동 추출 후 canon 승격(`Promote Bible Candidates to Canon`)
- 초안에서 카드 필드 자동 갱신(`updateCardsAfterGenerate`): 배경 등장 인물 직접 기록 + 관계·아크·속성 후보 추출 후 `Promote Card Candidates`로 카드 승격
- 카드 에디터의 **수집** 탭: 카드가 등장하는 draft에서 LLM으로 항목을 추출해 git diff처럼 보여주고, 선택 수락 시 캐릭터/배경 카드에 추가(기존 값 보존)
- Characters / Backgrounds 사이드바의 **추천** 버튼: `scene/*.txt`·`draft/*.md` 전체를 LLM으로 훑어 본문에 등장하지만 카드가 없는 인물·배경을 찾아 QuickPick으로 제안하고, 선택분을 신규 카드로 생성
- **이야기 완결**: `scene/*.txt`만 이어서 읽고 기존 씬을 건드리지 않은 채 끝번호 뒤에 완결 씬을 제안합니다. 연속된 앞부분만 선택해 VS Code diff와 최종 확인 뒤 추가합니다.
- **씬 기반 카드 구성**: `scene/*.txt`를 유일한 새 사실 근거로 읽어 신규 인물·장소 카드와 기존 카드의 필드별 보강안을 함께 제안합니다. 선택한 항목만 diff 검토 뒤 반영하며, 신규 캐릭터는 profile PNG를 만들지 않습니다.
- 씬별 검수·재작성 루프와 `revision-plan.yaml` 기록
- `manuscript/` 원고 조립, 최종 검사(`REVIEW.md`), 장별 요약(`SUMMARY.md`), 복선 체크리스트(`FORESHADOWING.md`)
- 미승격 설정 후보를 `canon.yaml`과 대조하는 `Canon Diff Report`
- 조립 원고 Markdown / plain text 내보내기
- 캐릭터 관계 그래프
- `mock`, OpenAI, Claude, Google, Ollama AI provider 지원
- Claude Code(`claude`)·Codex(`codex`) CLI provider 지원 — API 키 없이 구독 로그인으로 생성
- 명령 제목 다국어(i18n) 지원 (`package.nls.json`, `package.nls.ko.json`)
- 텔레그램 동반 봇([storygram](../bot/README.md)) 상태바 관찰 — 실행 여부·동기화 상태 표시, `Storyboard: 텔레그램 봇 대시보드 열기` 명령으로 운영 패널(`127.0.0.1`) 열기
- 설정 패널 **텔레그램 봇** 탭 — 허용 채팅 ID·기본 프로바이더 편집, «이 작품을 봇에 연결» 버튼으로 워크스페이스 전환, 저장 후 재시작 안내(토큰은 마스킹 표시만 하며 변경은 마법사에서만)
- `Storyboard: 텔레그램 봇 설정 파일 열기`(JSON 스키마 검증 포함) · `Storyboard: 텔레그램 봇 재시작`(launchd) — 설정을 나중에 고치고 즉시 반영
- `Storyboard: 텔레그램 봇 설정…` 온보딩 마법사 — 토큰 검증(getMe)·허용 chat id·워크스페이스 경로·프로바이더를 받아 `~/.storygram/config.json`(0600) 생성, 테스트 메시지 발송, macOS에서는 launchd 자동 시작 설치까지 안내

현재 구현은 수동 `scene/*.txt → draft/*.md` 흐름과 원클릭 장편 생성 흐름을 함께 지원합니다. 원클릭 생성은 재개 가능한 단계 상태를 `.storyboard/cache/novel-run.json`에 저장하며, 긴 원고의 PDF/DOCX 내보내기와 더 세밀한 배치 검수는 후속 작업입니다. 자세한 구조는 [`ARCHITECTURE.md`](../../ARCHITECTURE.md)를 봅니다.

이야기 완결과 씬 기반 카드 구성은 수동 작업이며 자동 장편 파이프라인에 포함되지 않습니다. 두 기능 모두 검토 중 입력 씬·카드·디렉터리가 달라지면 적용을 중단하고 다시 제안해야 합니다. 선택 결과는 하나의 VS Code `WorkspaceEdit`로 적용하지만, 프로세스 크래시까지 보장하는 트랜잭션은 아닙니다.

## 프로젝트 모델

```text
.storyboard/project.json
.storyboard/bible/canon.yaml
.storyboard/outline/   # 시놉시스·챕터/씬 계획·재작성 계획
character/*.card
background/*.card
scene/*.txt
draft/*.md
manuscript/*.md
```

- 워크스페이스 폴더 하나가 프로젝트 하나입니다.
- 프로젝트 설정은 자동 장편 생성의 입력 계약입니다. `Storyboard: Open Settings`의 **작품 계약** 탭에서 독자층·목표 분량·시점·금지 조건을 입력하고 생성 준비 상태를 확인합니다.
- `Storyboard: Generate Novel Outline`은 `synopsis.md`와 `chapters.yaml`을 만들고, `Storyboard: Generate Scene Seeds`는 이 계획에서 씬 시드를 파생합니다.
- `.card` 파일은 YAML 기반 자료 카드입니다.
- `scene/*.txt` 파일 하나가 씬 하나이며, 사용자가 쓰거나 outline에서 자동 생성될 수 있습니다.
- `draft/*.md` 파일은 AI가 생성하고 검사·재작성하는 원고입니다.
- `manuscript/`는 장별 조립 원고, 전체 원고(`manuscript.md`), 최종 검사·요약·복선 보고서를 담는 재생성 가능한 산출물입니다.

## 로컬 실행

```bash
npm install
npm run build
```

1. VS Code에서 저장소 루트를 엽니다.
2. **Run and Debug**에서 `Run Extension`을 선택하고 F5를 누릅니다.
3. Extension Development Host 창에서 빈 폴더를 엽니다.
4. `Storyboard: Initialize Project`를 실행합니다.
5. `Storyboard: Open Settings`에서 **작품 계약**을 채운 뒤 `Storyboard: Generate Novel`을 실행하거나, Activity Bar의 Characters / Backgrounds / Scenes 뷰에서 카드와 씬을 직접 생성합니다.

API 키 없이도 기본 `mock` provider로 흐름을 확인할 수 있습니다. 실제 provider를 쓰려면 `Storyboard: Set API Key...` 명령으로 키를 저장합니다.

이미 **Claude Code**나 **Codex** CLI를 쓰고 있다면 API 키 없이 그 구독을 그대로 활용할 수 있습니다.
각 CLI(`claude` / `codex`)를 설치하고 자체 로그인(`claude` 구독 로그인 / `codex login`의 ChatGPT 로그인)을
마친 뒤 `storyboard.defaultProvider`를 `claude-code` 또는 `codex`로 설정하면 됩니다. CLI 실행 파일이 PATH에
없으면 설정 패널 **연결** 탭의 «실행 명령» 입력(또는 `storyboard.providers.claude-code.command` /
`storyboard.providers.codex.command` 설정)에 절대 경로를 지정하고, 모델은 `...model` 설정으로 바꿉니다.
연결 테스트는 CLI를 찾지 못하면 «CLI 미설치»를, 설치는 됐지만 로그인되지 않았으면 연결 실패를 표시합니다.

CLI provider 사용 시 참고할 점:

- **사용량·비용**: Claude Code 비용은 CLI가 보고하는 `total_cost_usd`를 그대로 씁니다. Codex 사용량은
  `codex exec --json`에서 파싱합니다. Codex CLI는 ChatGPT 구독으로 인증돼 토큰당 과금이 아니므로 USD 비용은
  `0`으로 기록합니다.
- **추론 강도(Codex)**: `storyboard.providers.codex.reasoningEffort`를 `minimal`·`low`·`medium`·`high`로 지정하면
  Codex CLI에 `model_reasoning_effort`로 전달됩니다. 비워 두면 CLI 기본값을 씁니다.
- **스트리밍**: 두 CLI는 실시간 토큰 스트리밍 대신 생성을 끝까지 마친 뒤 전체 결과를 한 번에 전달합니다(의도된 동작).
- **인라인 완성**: CLI provider에서는 인라인 완성이 비활성화됩니다. 키 입력마다 CLI 프로세스를 새로 띄우는 비용이
  크고, 두 CLI가 길이·`temperature` 제어를 노출하지 않기 때문입니다(의도된 동작).

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

## 문서

공개 문서는 저장소 루트의 대문자 Markdown을 기준으로 합니다. 상세 계획·의사결정 기록 등 확장 문서는 원격에 포함되지 않으며, 필요 시 로컬에만 `.doc/` 디렉터리를 두고 관리할 수 있습니다.

- [`GETTING_STARTED.md`](GETTING_STARTED.md): 작가용 시작 가이드 (초보자용 전체 흐름)
- [`ARCHITECTURE.md`](../../ARCHITECTURE.md): 제품 아키텍처와 파일 모델
- [`GUIDE.md`](GUIDE.md): draft 편집 기능 사용법
- [`EXTENSION_QA.md`](EXTENSION_QA.md): 수동 QA 체크리스트
- [`RELEASE.md`](../../RELEASE.md): 릴리스 절차
- [`CHANGELOG.md`](CHANGELOG.md): 변경 내역 (한국어)

## 라이선스

Apache License 2.0 — [`LICENSE`](LICENSE)
