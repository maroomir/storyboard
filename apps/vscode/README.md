# Storyboard

Storyboard는 VS Code에서 장편 소설 한 권을 기획, 집필, 검수, 수정, 조립까지 자동 수행하는 것을 목표로 하는 AI 기반 픽션 IDE 확장입니다.

English README: [`README.en.md`](README.en.md)

## 주요 기능

- 목표 방향: 원클릭 장편 생성 IDE(Autonomous Fiction Studio)
- 워크스페이스 폴더 하나를 하나의 Storyboard 프로젝트로 초기화
- **작품 계약** 설정으로 장르·독자층·시점·구성·목표 분량·금지 조건·문체/품질 기준 관리
- 시점은 다섯 값(1인칭, 1인칭 회고, 2인칭, 3인칭 제한, 3인칭 전지) 가운데 하나이며, `narrator/*.card`로 이름 붙인 서술자를 만들면 씬·장마다 시점을 달리할 수 있음
- 구성(선형·옴니버스·시점 교차·액자식)을 고르면 연속성 줄기와 서술자 카드를 프리셋이 만들고, 옴니버스는 편 안에서만 이야기 상태·요약·기억이 이어짐
- `Storyboard: Generate Novel`로 작품 설정 → outline → 씬 시드 → 초안·검수·재작성 → 원고 조립·검사·요약까지 실행
- `.storyboard/outline/synopsis.md`, `chapters.yaml`, `revision-plan.yaml` 기반 장편 구조 계획
- `character/*.card`, `background/*.card` 기반 캐릭터/배경 카드 관리
- `.card` 파일용 커스텀 에디터와 Characters / Backgrounds 사이드바
- outline에서 `scene/*.card` 씬 시드를 만들고 `draft/*.md` 초안을 생성
- 씬 생성은 **뼈대 → 대사 다듬기 → 구간 살붙임 → 기계 검증** 4단으로 진행. 씬 전체의 사건 순서·등장·종료 지점을 뼈대에서 한 번에 확정한 뒤 문장만 두껍게 하므로, 같은 인물이 두 번 처음 등장하거나 도입이 반복되는 결함이 구조적으로 나오지 않음
- 생성 검증은 AI 없이 결정론적으로 동작: 뼈대에 없던 인물·다른 문자 체계·사라진 대사·분량 미달을 잡아 재시도하고, 남은 위반은 초안 frontmatter의 `warnings`로 올려 어느 구간을 먼저 볼지 알림
- 씬 간 이야기 상태 원장(`.storyboard/memory/storyState.md`): 확정 사실·인물 관계와 말투·공개된 정보·살아 있는 모티프를 씬 순서와 함께 누적해 다음 씬 프롬프트와 연속성 검사에 주입. 앞 씬을 재생성해도 뒤 씬 상태가 새어 들어가지 않음. 항목마다 그 씬의 입력 기록을 함께 남겨, 카드나 씬을 고쳐 놓고 다시 만들지 않은 항목은 `- [22!]`로 표시하고 프롬프트에서 빼며 생성 경고로 알림
- 캐넌 공개 시점(`revealFrom`): 사실이 **참이 되는 시점**(`validFrom`)과 **밝혀지는 시점**을 분리해, 1화부터 참인 결말 반전이 초반 본문에 누설되지 않게 함
- 씬 카드의 종료 지점(`endState`)·시점 인물(`povCharacter`): 한 씬이 다음 씬 영역까지 진행해 같은 사건이 두 번 결말나는 것과, 한 씬 안에서 여러 인물의 내면이 교차하는 것을 막음
- **Storyboard · Studio** 패널(항상 보이는 사이드바)에서 인물·배경 카드나 씬·초안을 열고 자연어로 수정을 지시 → 에이전트가 모호하면 되묻고 → 정합성 검사를 거친 수정 제안을 diff로 확인 → 승인해야 반영. 대화는 대상별로 저장되어 이어집니다
- 재생성 없이 카드 기반 보충: **카드 기반 보충**(본문 전체)·**선택 영역 보충**(선택 영역) 명령으로 갱신된 카드·정전을 기존 초안에 녹이고, 적용 전 diff로 확인
- 씬 사실 시트(grounding): 생성 직전에 사건·장소·관계·시점을 확정해 씬 frontmatter에 남기고 대사 생성에 주입. 비어 있는 항목만 AI가 제안하며 사용자가 적은 값은 유지. 기본은 제안 검토 후 승인, `grounding.autoApprove`를 켜면 자동 수락
- 작법 계약(`setting.craftContract`): 해설 지문 금지·모티프/후렴 반복 상한·상투 표현 블랙리스트·인물 내면 요구·동작 명료성(`actionClarity`)·밀도 완급(`modulateDensity`)·기본 분량 예산을 생성 프롬프트에 항상 주입(기본 계약 내장, 프로젝트별 덮어쓰기). 목표 분량이 없는 씬은 씬 시드 길이 × `sceneLengthMultiplier`(기본 12, 2,000–20,000자)로 예산을 잡는다
- 고정 산문 규약: 서술은 과거형, 대사는 곡선 큰따옴표(`“ ”`). 한 작품 안에서 갈리면 안 되는 규약이라 계약이 아니라 세 생성 프롬프트에 고정으로 주입한다
- 이전 초안 히스토리 보관(`draft.keepHistory`): 덮어쓰기 직전 초안을 `.draft/<scene>/<yyyy-mm-dd-hh-mm>-rev-NN.md`로 적재(기본 꺼짐)
- 장면 전환 구분자 삽입(`draft.sceneBreakEnabled`/`draft.sceneBreakSeparator`): 초안 생성 시 장면 사이에 `---` 구분선 또는 줄바꿈 n회를 삽입(기본 꺼짐)
- `.storyboard/bible/canon.yaml` 정전 설정 주입과 초안 연속성 검사
- 초안에서 설정 사실 후보 자동 추출 후 canon 승격(`Promote Bible Candidates to Canon`)
- 초안에서 카드 필드 자동 갱신(`updateCardsAfterGenerate`): 배경 등장 인물 직접 기록 + 관계·아크·속성 후보 추출 후 `Promote Card Candidates`로 카드 승격
- 카드 에디터의 **수집** 탭: 카드가 등장하는 draft에서 LLM으로 항목을 추출해 git diff처럼 보여주고, 선택 수락 시 캐릭터/배경 카드에 추가(기존 값 보존)
- Characters / Backgrounds 사이드바의 **추천** 버튼: `scene/*.card`·`draft/*.md` 전체를 LLM으로 훑어 본문에 등장하지만 카드가 없는 인물·배경을 찾아 QuickPick으로 제안하고, 선택분을 신규 카드로 생성
- **이야기 완결**: `scene/*.card`만 이어서 읽고 기존 씬을 건드리지 않은 채 끝번호 뒤에 완결 씬을 제안합니다. 연속된 앞부분만 선택해 VS Code diff와 최종 확인 뒤 추가합니다.
- **씬 기반 카드 구성**: `scene/*.card`를 유일한 새 사실 근거로 읽어 신규 인물·장소 카드와 기존 카드의 필드별 보강안을 함께 제안합니다. 선택한 항목만 diff 검토 뒤 반영하며, 신규 캐릭터는 profile PNG를 만들지 않습니다.
- 씬별 검수·재작성 루프와 `revision-plan.yaml` 기록
- `manuscript/` 원고 조립, 최종 검사(`REVIEW.md`), 장별 요약(`.storyboard/memory/summaries.md`), 복선 체크리스트(`FORESHADOWING.md`)
- 최종 검사가 찾은 high 이슈를 해당 씬 초안에 되먹여 1회 재작성하고 전권을 다시 검사. 재작성한 씬은 `REVIEW.md`의 «재작성 결과»에 남음
- 미승격 설정 후보를 `canon.yaml`과 대조하는 `Canon Diff Report`
- 조립 원고 Markdown / plain text 내보내기
- 캐릭터 관계 그래프
- `mock`, OpenAI, Claude, Google Gemini, xAI Grok, Ollama AI provider 지원
- 명령 제목 다국어(i18n) 지원 (`package.nls.json`, `package.nls.ko.json`)

현재 구현은 수동 `scene/*.card → draft/*.md` 흐름과 원클릭 장편 생성 흐름을 함께 지원합니다. 원클릭 생성은 재개 가능한 단계 상태를 `.storyboard/cache/novel-run.json`에 저장하며, 긴 원고의 PDF/DOCX 내보내기와 더 세밀한 배치 검수는 후속 작업입니다. 자세한 구조는 [`ARCHITECTURE.md`](../../ARCHITECTURE.md)를 봅니다.

이야기 완결과 씬 기반 카드 구성은 수동 작업이며 자동 장편 파이프라인에 포함되지 않습니다. 두 기능 모두 검토 중 입력 씬·카드·디렉터리가 달라지면 적용을 중단하고 다시 제안해야 합니다. 선택 결과는 하나의 VS Code `WorkspaceEdit`로 적용하지만, 프로세스 크래시까지 보장하는 트랜잭션은 아닙니다.

## 프로젝트 모델

```text
.storyboard/project.json
.storyboard/bible/canon.yaml
.storyboard/outline/   # 시놉시스·챕터/씬 계획·재작성 계획
character/*.card
background/*.card
scene/*.card
draft/*.md
manuscript/*.md
```

- 워크스페이스 폴더 하나가 프로젝트 하나입니다.
- 프로젝트 설정은 자동 장편 생성의 입력 계약입니다. `Storyboard: Open Settings`의 **작품 계약** 탭에서 독자층·목표 분량·시점·구성·금지 조건을 입력하고 생성 준비 상태를 확인합니다. 구성을 고르면 연속성 줄기와 서술자 카드가 함께 만들어지고, 그 결과는 같은 탭에 요약으로 표시됩니다.
- `Storyboard: Generate Novel Outline`은 `synopsis.md`와 `chapters.yaml`을 만들고, `Storyboard: Generate Scene Seeds`는 이 계획에서 씬 시드를 파생합니다.
- `.card` 파일은 YAML 기반 자료 카드입니다.
- `scene/*.card` 파일 하나가 씬 하나이며(`type: scene`), 사용자가 쓰거나 outline에서 자동 생성될 수 있습니다. 구형 `scene/*.txt` 워크스페이스는 **Storyboard: Migrate Scenes to Cards** 명령으로 변환합니다.
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

처음 활성화하면 상태바와 알림이 AI 제공자를 고르라고 안내합니다. 고르기 전에는 초안 생성이 실행되지 않습니다. 흐름만 확인하려면 `Mock`을 고르면 API 키 없이 가짜 텍스트로 동작하고, 실제 provider를 고르면 바로 API 키를 묻습니다(`Storyboard: Set API Key...`로 나중에 바꿀 수 있습니다).

## 설정 파일

Storyboard 설정은 VSCode 설정이 아니라 **`~/.storyboard/config.json`** 에 저장되며, CLI가 같은
파일을 읽습니다. 작품마다 다르게 두고 싶은 값은 워크스페이스의 `.storyboard/config.json` 에 적으면 그 작품에서만
공통값을 덮어씁니다. API 키는 `~/.storyboard/secrets.json`(권한 0600)에 있습니다. `STORYBOARD_HOME` 환경
변수로 홈 위치를 옮길 수 있습니다.

키 이름은 아래 문서의 `draft.keepHistory` 같은 점 표기 그대로이며, 설정 패널(`Storyboard: Open Settings`)이 이
파일을 편집합니다. 패널은 값마다 출처(공통 / 이 작품 / 기본값)를 표시하고, 저장할 때마다 어느 파일에 저장됐는지
알려 줍니다. 생성·검수·편집기 스위치는 **옵션** 탭에 모여 있습니다. 상태바의 `✦ provider · model` 항목이 현재
기본 AI를 보여 주며, 누르면 설정 패널이 열립니다. 예전 버전에서 VSCode `settings.json` 에 두었던 `storyboard.*` 값은 처음 활성화될 때 한 번
자동으로 옮겨집니다.

```json
{ "defaultProvider": "claude", "draft": { "keepHistory": true } }
```

생성은 모두 API 키로 이루어집니다. 설정 패널의 **연결** 탭에서 제공자를 고르고 키를 넣으면 되고, 키는
`~/.storyboard/secrets.json`에 0600으로 저장돼 CLI와 공유됩니다. `ollama`만 키 없이 로컬에서 돕니다.

0.9.2에서 Claude Code·Codex·Gemini CLI 구독 provider를 제외했습니다. Anthropic·OpenAI·Google 모두 구독과 계정
로그인을 대화형 개인 사용으로 한정하고, 프로그램적·대량 호출에는 API 키를 쓰도록 안내합니다. Storyboard의
장편 생성은 후자에 해당하므로 API 키 경로 하나로 정리했습니다. 기존 설정에 `claude-code`·`codex`·`gemini-cli`가
남아 있으면 «고르지 않음»으로 읽혀 생성이 거부됩니다. 대신 골라 주지 않는 것은 모델도 요금도
다르기 때문입니다. 설정 패널에서 다시 고르고, 모델은 `providers.<id>.model`로 바꿉니다.

## 생성물과 제공자 정책

- **AI가 단정한 사실은 직접 확인하세요.** 초안·재작성·검수 의견·설정집 제안은 모두 모델 산출물입니다. 그 안의
  사실 주장(역사·지리·의학·법률·실존 인물과 장소)은 스스로 확인하기 전까지 검증되지 않은 것으로 다루세요. 이 앱을
  다른 작가에게 나눠 줄 때는 이 안내도 함께 전달해 주세요.
- **제공자의 사용 정책이 원고에 적용됩니다.** `openai`·`claude`·`google`·`grok`는 각자의 콘텐츠 규칙(예: 노골적
  성행위 묘사, 미성년자 관련 성적 내용, 폭력을 조장하는 내용)을 생성 결과에 적용합니다. 선을 넘는 요청은 제공자가
  거부하고, 반복되면 API 키나 계정이 제한될 수 있습니다. `ollama`는 내 컴퓨터에서 돌기 때문에 해당하지 않습니다.

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
