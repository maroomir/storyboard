# 변경 내역

Storyboard의 주요 변경 사항을 한국어로 기록합니다.

이 문서는 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) 형식을 따르며,
첫 공개 릴리스 이후에는 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)을 따릅니다.

영어 변경 내역은 [CHANGELOG.en.md](CHANGELOG.en.md)를 참고하세요.

## [Unreleased]

## [0.6.3] - 2026-08-23

### 변경

- Studio 패널의 첫 화면을 «지금 무대» 카드로 바꿨습니다. 파일명만 띄우던 타깃 칩 대신 씬 제목, 초안 분량·버전·최근 갱신 시점·검수 상태, 연결된 인물·배경 카드를 한 장에 모아 보여 주고, 대화 전 화면에는 그 상태에서 도출한 추천 3개를 이유와 함께 제시합니다. 명령을 실행할 때마다 다시 조회하므로 파일을 고쳐도 상태가 따라옵니다. 대화·승인·슬래시 명령 흐름은 그대로입니다.
- 설정의 태스크 탭을 오버라이드 인박스로 바꿨습니다. 24개 태스크를 모두 늘어놓는 대신 기본값을 덮어쓴 태스크만 남기고, 나머지는 검색 피커로 필요할 때 추가합니다. 탭 상단에는 기본 AI·연결 상태·오버라이드 개수를 요약하는 카드 3장이 붙고 각 카드를 누르면 해당 탭으로 이동합니다.

## [0.6.2] - 2026-08-23

### 추가

- 씬 사실 시트(grounding)를 추가했습니다. 초안 생성 직전에 사건·장소·관계·시점 네 가지를 확정해 씬 frontmatter에 남기고 대사 생성 프롬프트에 주입하므로, 추상적인 씬 시드가 비유만으로 흘러가지 않습니다. 비어 있는 항목만 AI가 제안하고 사용자가 적어 둔 값은 그대로 유지하며, 네 항목이 모두 차 있으면 AI 호출 없이 바로 생성으로 넘어갑니다. 기본은 제안을 검토한 뒤 승인하는 방식이고 `storyboard.grounding.autoApprove`를 켜면 자동 수락해 한 번의 클릭으로 생성이 끝납니다. 확정된 사실은 씬 입력 해시에 포함되므로 사실을 고치면 초안 캐시가 무효화됩니다.
- 작법 계약(craft contract)을 추가했습니다. 해설 지문 금지, 모티프·후렴 반복 상한, 상투 표현 블랙리스트, 인물 내면 요구, 기본 분량 예산을 생성·형식 프롬프트에 항상 주입합니다. 기본 계약이 내장되어 있어 별도 설정 없이 적용되며, `.storyboard/project.json`의 `setting.craftContract`로 작품별로 덮어쓸 수 있습니다.
- 초안 frontmatter에 출처 정보를 남깁니다. 생성·재작성·형식 적용 시 사용한 도구(`storyboard@<버전>`)와 프로바이더·모델이 `generator`·`providerId`·`model` 키로 기록되어, 나중에 어떤 설정으로 뽑은 원고인지 확인할 수 있습니다. 보충·압축의 diff 미리보기 경로에서도 기존 출처 정보가 보존됩니다.
- 텔레그램 봇(storygram)도 같은 흐름을 따릅니다. 초안을 공용 frontmatter 코덱으로 저장하며 `storygram@<버전>`과 프로바이더·모델을 남기고, 생성 전에 grounding을 채웁니다. 큐에 올라간 작업은 텔레그램에 승인을 물을 수 없으므로 `draft.autoGrounding`(기본 켜짐)이 채우고 커밋하는 방식으로 동작하며, 끄면 grounding을 건드리지 않습니다. 저장은 읽은 시점 해시를 기준으로 하므로 작업 도중 데스크톱에서 같은 씬을 고치면 봇이 저장을 건너뜁니다.

### 수정

- 목표 분량을 지정하지 않은 씬의 초안이 무한정 길어지던 문제를 고쳤습니다. 이제 씬 시드 길이 × `sceneLengthMultiplier`(기본 12)로 예산을 도출하고 2,000~20,000자로 제한하며, `sceneLengthMultiplier: 0`으로 이 동작을 끌 수 있습니다. 같은 예산을 생성과 재작성이 공유합니다.
- 같은 문장·후렴구가 반복되어도 걸러지지 않던 문제를 고쳤습니다. 기존 반복 제한이 이미지 표현에만 적용되던 것을 동일 문장과 후렴까지 확장했습니다.
- grounding 제안이 인물 카드 이름 대신 카드 ID(슬러그)를 그대로 노출하던 문제를 고쳤습니다.

## [0.6.1] - 2026-08-21

### 제거

- seedcoat `.seed` 저장소 아카이브 기능을 제거했습니다. `Storyboard: Create/Sync/Export Project ... Seed` 명령 3개와 탐색기 `.seed` 메뉴, `@seedcoat/wasm` 의존성이 사라졌습니다. 작품은 git 워크스페이스 자체로 관리하며, 별도 교환용 아카이브 포맷을 두지 않습니다.
- 스캐폴딩 잔재였던 `Storyboard: Hello World` 명령을 제거했습니다.

### 수정

- 모노레포 재구조화 이전 경로를 import해 기동이 불가능했던 씬 커버리지 진단 하네스(`coverageCheck.harness.ts`)를 수리했습니다.
- 웹뷰 뷰에는 나타날 수 없어 동작하지 않던 카드 ID 변경 트리 컨텍스트 메뉴 기여 2건을 정리했습니다. 탐색기 우클릭·명령 팔레트 경로는 그대로 동작합니다.
- `Storyboard: Promote Card Candidates` 명령 제목의 한국어 번역 누락을 보완했습니다.

### 구조

- 참조되지 않는 코드와 의존성을 정리했습니다: 미사용 모듈·함수·타입 삭제, 내부 전용 심볼의 export 해제, 봇의 `js-yaml` 등 미사용 의존성 제거. 사용자 기능 변화는 없습니다.
- `ARCHITECTURE.md` 등 문서가 가리키던 재구조화 이전 파일 경로 13곳을 실제 위치로 정정했습니다.

## [0.6.0] - 2026-08-01

### 추가

- 텔레그램 동반 봇 **storygram**을 추가했습니다. 확장이 여는 것과 **같은** 워크스페이스를 편집하는 상주 봇으로, 이동 중에도 초안을 읽고(`/read`) 씬 시드를 만들거나 고치고(`/scene`) 카드를 편집하며, 초안 생성을 큐에 넣고 진행 상황을 받아볼 수 있습니다. 저장에 성공한 파일은 항상 커밋되고, 쓰기 직전에 대상 파일을 다시 읽어 확장과 동시에 편집해도 서로의 변경을 덮어쓰지 않습니다.
- `Storyboard: 텔레그램 봇 설정…` 온보딩 마법사를 추가했습니다. 토큰을 텔레그램에 먼저 검증한 뒤 허용 채팅 ID·워크스페이스·기본 프로바이더를 받아 `~/.storygram/config.json`을 0600 권한으로 저장합니다. 아직 초기화하지 않은 폴더를 고르면 그 자리에서 Init을 실행해 마법사를 이어가고, macOS에서는 의존성 설치 → 빌드 → launchd 등록까지 진행률과 함께 수행한 뒤 봇이 실제로 응답하는지 확인하고 대시보드를 엽니다. 토큰은 로그와 오류 메시지에 남지 않습니다.
- 상태바에 봇 상태(미설정·관찰 불가·중지·실행 중)를 표시하고, `Storyboard: 텔레그램 봇 대시보드 열기`로 루프백 운영 패널을 엽니다. 미설정 상태를 클릭하면 설정 마법사로 이어집니다.
- 설정을 마친 뒤에도 봇 설정을 고칠 수 있는 경로를 추가했습니다. 설정 패널의 **텔레그램 봇** 탭에서 허용 채팅 ID와 기본 프로바이더를 편집하고, «이 작품을 봇에 연결»로 봇이 바라보는 워크스페이스를 바꿉니다. `Storyboard: 텔레그램 봇 설정 파일 열기`는 JSON 스키마 검증(자동완성·오타 검사)이 붙은 편집기를 열고, `Storyboard: 텔레그램 봇 재시작`은 launchd로 재시작한 뒤 헬스를 확인합니다. 토큰은 마스킹된 힌트만 보이며 변경은 마법사에서만 가능합니다.

### 수정

- 카드의 `role: support`가 조연(supporting)이 아니라 단역(extra)으로 조용히 강등되던 문제를 고쳤습니다. 정사 주입과 생성 파이프라인의 인물 취급에 영향을 주던 문제입니다.
- 스키마가 모르는 role 값(`주연`, `Main` 등)이 조용히 단역으로 강등된 뒤 재저장 시 원래 값이 사라지던 문제를 고쳤습니다. 이제 대소문자와 알려진 별칭만 보정하고, 그래도 모르는 값이면 Problems 패널에 어느 필드가 왜 거부됐는지 함께 표시합니다.
- 시놉시스 값 안에 마크다운 마커(`## `, `- `, `_미작성_`)나 개행이 들어가면 저장·재읽기 과정에서 내용이 잘리거나 항목이 분해되던 문제를 고쳤습니다.
- 시놉시스 필드 하나가 불량이면 시놉시스 전체가 빈 값으로 초기화되던 문제를 고쳤습니다. 이제 유효한 필드는 보존하고 불량 필드만 기본값으로 대체합니다.
- 경로 판정이 대소문자를 무시해 `SCENE/01.TXT` 같은 파일이 씬으로 분류된 뒤 파서에서 거부되던 불일치를 고쳤습니다.

### 구조

- 저장소를 npm workspaces 모노레포로 재배치했습니다. 확장은 `apps/desktop`으로 이동했고, 워크스페이스 파일 포맷(`@storyboard/story-format`), AI 엔진(`@storyboard/story-ai`), 씬 생성 파이프라인(`@storyboard/story-pipeline`), git 동기화 계층(`@storyboard/story-git`)을 공유 패키지로 분리했습니다. 확장의 사용자 동작과 VSIX 내용물은 변하지 않았습니다.
- 봇은 `apps/bot`에 있으며 확장과 동일한 코덱·파이프라인을 소비합니다. 따라서 어느 쪽에서 저장해도 같은 바이트가 기록됩니다.

## [0.5.2] - 2026-07-24

### 추가

- 수동 **이야기 완결**과 **씬 기반 카드 구성** 기능을 추가했습니다. 두 작업은 Command Palette, Studio, 해당 사이드바 뷰 헤더에서 같은 유스케이스로 실행하며, AI 제안 → 선택 → VS Code native diff → 최종 확인 → 적용 순서로 동작합니다.
- 완결은 기존 `scene/*.txt`를 수정하지 않고 마지막 번호 뒤에만 새 씬을 추가합니다. 카드 구성은 씬만 새 사실 근거로 사용해 신규 카드와 기존 카드 보강안을 함께 제안하고, 별칭·태그도 선택 반영할 수 있습니다.
- Studio 대화를 세션 단위로 `.storyboard/cache/studio-sessions/`에 저장합니다. 뷰를 다시 열면 최신 세션이 복원되고, 최근 세션 목록(20개 유지)에서 지난 대화를 다시 열거나 새 대화를 시작할 수 있습니다.
- Studio 입력창에 슬래시 명령을 추가했습니다. `/`를 입력하면 현재 대상에 맞는 명령이 자동완성되고, 선택한 슬래시 명령은 승인 단계 없이 바로 실행됩니다.
- Studio에 **초안 압축** 기능을 추가했습니다. 설정 가능한 분량 한도에 맞춰 초안을 줄이고, VS Code diff 검토 후에만 적용합니다. 자동 리비전 출력이 비정상이거나 너무 짧으면 기존 초안을 보존하고, 과도하게 쪼개진 상황(situation)은 병합해 반복 장면 생성을 줄입니다.
- 스키마를 위반한 `character/*.card`·`background/*.card` 파일을 Problems 패널에 필드 단위 오류 위치와 함께 표시합니다. 기존에는 위반 카드가 씬 생성에서 무경고로 제외됐습니다.
- 씬 frontmatter에 선택적 `targetWordCount`(양의 정수)를 추가했습니다. 지정하면 장르 포맷 단계가 씬별 목표 분량 지시를 받습니다.
- codex reasoning effort 설정 `storyboard.providers.codex.reasoningEffort`를 추가했습니다. 빈 값이면 CLI 기본값을 사용합니다.
- 모델 카탈로그에 GPT-5.6 Codex 모델(Sol·Terra·Luna)을 추가하고, codex 기본 모델을 Sol로 지정했습니다.
- 헤드리스 하네스를 보강했습니다: 실행 종료 시 태스크별 토큰 사용량 요약 출력, 씬별 배경 카드 부착 결과 로그와 미부착 경고, `SCENE_CLI_TIMEOUT` 환경변수로 CLI 타임아웃 오버라이드(기본 600초), `SCENE_EFFORT` 환경변수로 codex reasoning effort 지정.

### 수정

- codex CLI 출력을 청크마다 디코딩해 멀티바이트 문자가 청크 경계에서 U+FFFD 대체문자로 손상되던 문제를 고쳤습니다. 이제 프로세스 종료 시 한 번만 UTF-8 디코딩합니다.
- 초안 검수·재작성 단계가 캐릭터 카드를 전달받지 못해 인물 말투가 프로젝트 품질 기준에 밀려 바뀌던 문제를 고쳤습니다. 두 단계 모두 장면 캐릭터 카드를 받고 카드 보이스를 최우선으로 적용합니다.
- Studio 웹뷰가 project 대상을 인식하지 못하고 none으로 강등하던 문제를 고쳤습니다.
- 수동 초안 압축 결과가 목표 분량보다 짧아도 유효하면 거부하지 않고 diff 검토로 전달하도록 고쳤습니다.
- 아키텍처 재구성 이후 낡은 임포트 경로로 실패하던 헤드리스 하네스 실행을 고쳤습니다.

### 안전

- 제안 입력과 대상 파일의 SHA-256 스냅샷을 적용 직전에 검증합니다. 검토 중 변경되면 자동 재배치·덮어쓰기 없이 다시 제안하도록 중단합니다. 적용은 단일 `WorkspaceEdit`를 사용하지만 크래시까지 보장하는 완전 트랜잭션은 아닙니다.

## [0.5.1] - 2026-07-19

### 변경

- 확장 기능의 동작을 유지하면서 extension host 코드를 bootstrap·application·domain·infrastructure·presentation 계층으로 재구성했습니다. 의존성 방향을 검증하는 아키텍처 검사와 유스케이스 단위 테스트를 추가해 이후 변경의 안정성을 높였습니다.

## [0.5.0] - 2026-07-04

### 추가

- 항상 보이는 **Storyboard · Studio** 사이드바 패널을 추가했습니다. 현재 활성 `draft/*.md`·`scene/*.txt`를 자동으로 인식해, 초안 재생성·문법/연속성 검사·카드 기반 보충·선택 영역 확장/업데이트·지시문 편집(Edit Selection 입력란)과 씬 초안 생성·포맷 적용을 한곳에서 실행합니다. 본문을 스크롤해도 버튼이 사라지지 않으며, 패널 헤더를 우측 Secondary Side Bar로 옮길 수 있습니다.
- 초안 생성 시 장면 전환마다 구분자를 삽입하는 기능을 추가했습니다. `storyboard.draft.sceneBreakEnabled`로 켜고 `storyboard.draft.sceneBreakSeparator`로 `---` 구분선 또는 줄바꿈 반복 횟수(1~10)를 선택할 수 있으며 기본값은 꺼짐입니다. 켜면 장르 포맷 AI 호출이 장면 단위로 실행되어 호출 수가 늘어나고, 설정을 바꾸면 다음 Generate Draft에서 캐시 없이 재생성됩니다.

### 변경

- 스크롤 시 사라지던 초안/씬 상단 CodeLens 버튼을 제거하고, 동일한 동작을 Studio 패널로 옮겼습니다. 같은 동작은 명령 팔레트로도 계속 실행할 수 있습니다.

## [0.4.4] - 2026-06-30

### 추가

- 재생성 없이 현재 카드·정전(canon)을 기존 초안에 반영해 보충하는 기능을 추가했습니다. 초안 CodeLens의 `✨ Augment from Cards`는 본문 전체를, `🪄 Update Selection`은 선택한 영역만 보충하며, 사건 전개·문체·직접 편집분을 보존합니다. 적용 전 VSCode 네이티브 diff로 변경 전/후를 확인하고 **적용**을 눌러야 반영되며, `storyboard.draft.keepHistory`가 켜져 있으면 직전 초안을 `.draft` 히스토리에 보관합니다.
- 선택 영역을 지시문으로 편집하는 기능을 추가했습니다. 초안 CodeLens의 `✏️ Edit Selection...`을 클릭하면 수정 방향 입력 창이 열립니다. 지시문(예: "더 긴장감 있게", "짧게 줄여서")과 현재 카드·정전 정보를 함께 AI에 전달해 선택 영역을 재작성하고, 동일한 diff 미리보기·적용 흐름을 거칩니다.
- 초안 인라인 완성이 연결된 씬 파일의 의도, 등장 캐릭터, 배경 정보를 함께 참고하도록 보강했습니다. 캐릭터 말투와 배경 묘사를 짧게 포함해 현재 장면에 맞는 이어쓰기 제안을 만들며, 동일 장면 컨텍스트는 짧게 캐시해 키 입력 중 반복 I/O를 줄입니다.

### 수정

- 초안 보강 diff 미리보기에서 실제 초안 파일을 before 쪽으로 직접 열어 VSCode 자동 저장이나 CodeLens 동작이 간섭할 수 있던 문제를 고쳤습니다. 이제 변경 전/후 모두 읽기 전용 가상 문서로 보여주고, 사용자가 **적용**을 누를 때만 실제 초안을 갱신합니다.

### 테스트

- 초안 보강 프롬프트, 지시문 기반 선택 편집, AI 서비스 보강 호출, 인라인 완성 씬 컨텍스트 포맷 테스트를 추가했습니다.

## [0.4.3] - 2026-06-28

### 추가

- Characters·Backgrounds 사이드바 헤더에 **추천**(✨) 버튼을 추가했습니다. 클릭 시 프로젝트 전체 `scene/*.txt`와 `draft/*.md`를 LLM으로 분석해 본문에 등장하지만 아직 카드가 없는 인물·배경을 QuickPick으로 제안하고, 선택한 항목만 최소 카드 파일로 생성합니다. 이미 카드에 등록된 이름과 별칭은 제안에서 제외됩니다.

### 수정

- 한국어처럼 ASCII 문자가 없는 이름의 카드를 추천으로 생성할 때 `background-2`, `background-3`처럼 의미 없는 파일명이 붙던 문제를 고쳤습니다. 이제 파일 ID 지정 창이 떠서 직접 이름을 입력할 수 있습니다.

## [0.4.2] - 2026-06-28

### 추가

- 카드 에디터에 **수집** 탭을 추가했습니다. `character/*.card`와 `background/*.card`에서 해당 카드가 등장하는 `draft/*.md`를 스캔해 LLM으로 카드 보강 제안을 만들고, 사용자가 선택한 항목만 카드 YAML에 반영할 수 있습니다.
- 카드 수집 제안 타입과 적용 로직을 추가했습니다. 캐릭터는 속성·관계·아크·특성·최근 대사·설명·화법·욕망을, 배경은 설명·감각·시간·날씨·등장인물을 제안합니다.
- 카드 수집용 AI 빌더와 `backgroundFactExtraction` 작업을 추가했습니다. 씬별 제안을 모아 중복을 제거하고, 기존 값이 있는 항목은 추가가 아니라 수정 제안으로 표시합니다.
- `cards.collect`, `cards.applyCollect`, `cards.previewCollect` RPC 메시지를 추가하고 카드 커스텀 에디터 provider에 연결했습니다.
- 수락할 제안을 고른 뒤 VSCode 네이티브 diff 편집기로 현재 카드와 반영 예정 YAML을 비교하는 미리보기 흐름을 추가했습니다.

### 수정

- 수집 diff 미리보기 가상 문서가 `.card` 확장자 때문에 다시 카드 커스텀 에디터로 라우팅되어 열리지 않던 문제를 고쳤습니다.
- 별칭으로만 언급된 캐릭터도 카드 수집 대상과 추출 컨텍스트에 포함되도록 고쳤습니다. 예를 들어 본명이 아닌 호칭으로 등장한 대사와 서술도 수집 후보에 반영됩니다.

### 문서

- README와 작가 가이드에 카드 에디터 수집 탭, 항목 검토, diff 미리보기, 선택 반영 흐름을 문서화했습니다.

### 테스트

- 카드 수집 제안 타입, 신규/수정 필터링, 적용 로직, 배경 정보 추출, 캐릭터 설명·화법·욕망 수집, 별칭 기반 수집, 메시징 레지스트리 테스트를 추가·갱신했습니다.

## [0.4.1] - 2026-06-27

### 추가

- 초안 히스토리 옵션 `storyboard.draft.keepHistory`(기본 꺼짐)를 추가했습니다. 켜면 Generate/Regenerate가 `draft/<scene>.md`를 덮어쓰기 직전에 이전 초안을 `.draft/<scene>/<yyyy-mm-dd-hh-mm>-rev-NN.md`로 보관합니다. `.draft/`는 `draft/`처럼 `.gitignore`로 제외됩니다.
- 초안 생성 결과에서 캐릭터별 속성·관계·아크 후보를 추출해 `.storyboard/cache/cards/`에 저장하는 카드 후보 흐름을 추가했습니다. `storyboard.draft.updateCardsAfterGenerate`가 켜져 있을 때 동작하며, `Storyboard: Promote Card Candidates` 명령으로 사용자가 선택한 후보만 캐릭터 카드에 반영합니다.
- 카드 후보 검증 옵션 `storyboard.draft.verifyCardCandidates`(기본 켜짐)를 추가했습니다. 추출된 후보를 초안 본문과 다시 대조해 명시적으로 확인되는 후보만 승격 대기 목록에 남깁니다.
- 캐릭터 카드에 `desire` 항목 목록을, 배경 카드에 `aliases`·`time`·`weather`·`senses` 필드를 추가했습니다. 페르소나 생성과 배경 묘사 프롬프트가 새 필드를 컨텍스트로 사용합니다.
- 씬 frontmatter에 `location`이 없어도 본문에서 배경 이름·별칭을 감지해 씬 컨텍스트에 배경 카드를 연결합니다.
- 초안 생성 후 감지된 캐릭터를 해당 배경 카드의 `characterIds`에 자동 추가하는 흐름을 추가했습니다.

### 변경

- 캐릭터 `voice`·`description`과 배경 `description`을 긴 산문 대신 **항목 목록(`string[]`)**으로 입력하도록 바꿨습니다. 카드 편집기에서 항목 추가/삭제로 관리하며, YAML에는 시퀀스로 저장됩니다.
- 산문으로 작성된 기존 카드를 줄 단위 목록으로 변환하는 `Storyboard: 카드 텍스트 필드를 목록형으로 변환`(`storyboard.cards.migrateTextToList`) 명령을 추가했습니다.
- 카드 편집기에서 수동 입력 필드와 AI가 관리하는 후보·관계·아크 필드를 분리했습니다. 관계·아크·속성은 초안에서 후보로 모은 뒤 승격 명령으로 반영하는 흐름에 맞췄습니다.
- `storyboard.draft.updateCardsAfterGenerate` 설명과 동작 범위를 확장했습니다. 기존 traits/recent dialogue 업데이트에 더해 배경 캐릭터 연결과 카드 후보 추출까지 포함합니다.
- 캐릭터 `attributes`를 페르소나 캐시와 페르소나 생성 프롬프트에 반영하도록 바꿨습니다.
- Guerrila harness의 재생성 흐름도 기존 초안을 `.draft/` 히스토리에 보관하도록 맞췄습니다.
- `npm run lint`가 extension host `tsconfig.json` 타입체크까지 실행하도록 보강했습니다.

### 수정

- 캐릭터 `voice`·`description`·`attributes`와 배경 `description`·`senses`가 바뀌면 씬 캐시가 올바르게 무효화되도록 고쳤습니다.
- 승격된 카드 후보는 후보 캐시에서 제거하고, 모두 반영된 후보 파일은 삭제하도록 고쳤습니다.
- 로컬 개발용 `TODO.md`가 Git과 VSIX 패키지에 포함되지 않도록 제외했습니다.

### 문서

- README, 아키텍처 문서, 수동 QA 문서, 카드 파라미터 영향 리포트에 카드 후보 승격, 초안 히스토리, 목록형 카드 필드, 배경 감지와 새 카드 필드 흐름을 반영했습니다.
- 카드/씬 포맷 스킬 문서에 목록형 카드 텍스트 필드와 초안 히스토리 규칙을 반영했습니다.

### 테스트

- 카드 후보 추출·검증·승격·캐시 정리, 배경 캐릭터 자동 업데이트, 카드 텍스트 목록 변환, 초안 히스토리, 배경 자동 감지, 카드 스키마와 씬 캐시 무효화 테스트를 추가했습니다.
- 카드 편집기 수동 필드, YAML 편집, Seed 가져오기/리맵, 페르소나·배경 묘사 프롬프트 관련 회귀 테스트를 갱신했습니다.

## [0.4.0] - 2026-06-25

### 추가

- 캐릭터별 페르소나와 배경별 분위기 묘사를 `.storyboard/cache/personas/`와 `.storyboard/cache/backgrounds/`에 저장하는 카드 단위 메모리를 추가했습니다. 카드 내용이 바뀌면 `cardHash`로 캐시를 무효화합니다.
- `backgroundDescription` AI 작업을 추가했습니다. 배경 카드에서 장소·시대 분위기와 감각 묘사를 생성하고, 씬 대화 생성 컨텍스트에 주입합니다.
- 검수 이슈를 `canon` / `persona` / `narrator` 에이전트로 라우팅하는 결정적 매핑을 추가했습니다. 보이스 이슈는 가능하면 캐릭터 name·alias로 카드 범위를 좁히고, 전역 이슈만 기존 전체 재작성으로 처리합니다.
- `/scene-quality` 워크플로와 장면 품질 루브릭 문서를 추가했습니다. 커버리지 게이트, 서사력·연결성·장면 구분·전환 축, 6차원 품질 점수를 같은 기준으로 기록합니다.

### 변경

- `storyboard.draft.reviseAfterGenerate` 기본값을 `true`로 바꿨습니다. Generate / Regenerate / Generate All 직후 검수·재작성 루프가 자동으로 이어져 한 동작으로 검수된 초안을 생성합니다.
- Claude Code와 Codex CLI provider에 `timeoutMs` 설정을 추가하고 기본 생성 타임아웃을 10분으로 늘렸습니다.
- 씬 생성 파이프라인, 장편 생성 파이프라인, 초안 생성 명령, AI provider 구성, 설정 화면, 메시징 계약을 작은 단계와 모듈로 분리했습니다. 사용자 동작은 유지하면서 테스트 가능한 경계를 넓혔습니다.
- Codex JSONL 파싱, 페르소나 라인 구성, AI 응답 보정, revise-after-generate 게이트, Seed 파일 I/O 흐름의 중복을 줄였습니다.

### 문서

- 아키텍처 문서에 다중 에이전트 협업 모델, 카드 단위 메모리, 검수 피드백 라우팅, 드로잉 에이전트 배경 묘사 흐름을 반영했습니다.
- 작가 가이드에 초안 생성 후 자동 검수·재작성 기본 동작을 반영했습니다.
- 카드 파라미터가 draft 생성 품질에 실제로 미치는 영향을 정리한 리포트를 추가했습니다.
- Claude/Cursor 규칙과 스킬의 canonical 위치를 `.claude/` 중심으로 정리하고, Cursor 미러를 동기화했습니다.

### 테스트

- 카드 메모리 직렬화·검증, 페르소나 캐시 재사용·무효화, 배경 묘사 캐시, 검수 라우팅, 설정 스냅샷, CLI 타임아웃, 메시징 레지스트리 분리 테스트를 추가했습니다.
- 장면 생성 파이프라인과 revise workflow 테스트를 보강했습니다.

## [0.3.3] - 2026-06-24

### 추가

- 캐릭터 카드에 `aliases`와 `voice` 필드를 추가했습니다. 씬 본문 캐릭터 감지와 상황별 페르소나 스코핑이 이름뿐 아니라 별칭도 인식합니다.
- 씬 frontmatter의 `relationStage`와 작품 설정의 시점·장르·문체 제약을 묶는 style directive를 추가했습니다. 페르소나 생성, 대사 생성, 장르 포맷, 초안 비평 프롬프트가 이를 반영합니다.
- `sceneCoverage` AI 작업과 `StoryboardAIService.checkSceneCoverage`를 추가했습니다. 입력 비트가 초안에 빠졌거나 순서가 바뀐 경우를 JSON으로 검사하고 요약할 수 있습니다.
- 실제 CLI provider로 장편 씬 생성과 장면 커버리지 검사를 돌릴 수 있는 별도 Vitest harness 설정과 스크립트를 추가했습니다.

### 변경

- 씬 생성 파이프라인이 각 상황의 실제 참여 인물 페르소나만 넘기고, 이전 상황 원문 대신 앞서 생성된 대사 tail을 다음 상황 컨텍스트로 이어 씁니다.
- 상황 추출·대사 생성·장르 포맷 프롬프트를 보강해 비트를 빠뜨리지 않고, 전환·행동·내면·갈등을 장면으로 극화하도록 조정했습니다.
- 긴 씬의 최종 포맷을 글자 예산 단위로 나누어 처리합니다. 모델이 분량 한계나 선택지 안내 같은 메타 응답을 반환하면 원고에 섞지 않고 원본 대사 조각을 유지합니다.
- 초안 생성 후 캐릭터 카드 자동 업데이트는 `storyboard.draft.updateCardsAfterGenerate` 설정을 켰을 때만 실행되도록 기본값을 껐습니다.

### 문서

- 아키텍처 예시에 캐릭터 `voice`와 씬 `relationStage` frontmatter를 반영했습니다.

### 테스트

- 별칭 기반 캐릭터 감지, style directive, scene coverage 파싱·요약, 프롬프트 지시문, 씬 생성 파이프라인의 페르소나 스코핑·컨텍스트 연결·청크 포맷 테스트를 추가했습니다.

## [0.3.2] - 2026-06-22

### 추가

- 스토리 바이블 정전 사실에 `validFrom` / `validUntil` 유효 범위와 `keywords` 활성화 조건을 추가했습니다. 씬 순번에 맞는 canon 버전만 주입하고, 씬 본문에 키워드가 등장하면 등장 엔티티가 아니어도 관련 사실을 추가로 주입합니다.
- `Storyboard: Slop Check (Draft)` 명령과 선택적 `storyboard.slop.realtimeEnabled` 설정을 추가했습니다. 초안에서 상투 표현, “단순히 X가 아니라 Y”류 대조 구문, 과도하게 반복되는 3어절 표현을 진단합니다.
- `storyboard.draft.reviseAfterGenerate` 설정을 추가했습니다. 켜면 `Generate Draft` / `Generate All Drafts`로 새 초안을 생성한 직후 기존 연속성·비평 검수 재작성 게이트를 실행합니다.
- `storyboard.draft.reviseScoreThreshold` 설정과 비평 루브릭 점수를 추가했습니다. 기준 점수 이상이고 high 연속성 이슈가 없으면 검수·재작성 루프를 조기 통과할 수 있으며, 최종 검사 보고서에도 `비평 점수: NN/100`을 표시합니다.
- `Storyboard: Canon Diff Report`가 같은 subject/key의 시간 범위별 canon 버전을 “설정 변경 타임라인”으로 함께 표시합니다.

### 변경

- 씬 생성 컨텍스트가 2번째 이상 씬에서 `manuscript/SUMMARY.md`의 롤링 요약(최대 2000자)을 이전 장면 컨텍스트로 우선 사용합니다. 요약 파일이 없거나 비어 있으면 기존처럼 이전 초안 tail 1000자로 fallback합니다.
- 연속성 검사 결과에 `high` / `low` 심각도를 도입했습니다. `high`만 재작성 차단 이슈로 세고, 실시간 진단에서는 `high`를 Warning, `low`를 Information으로 표시합니다.
- 자동 승격되는 바이블 후보는 `sourceScene`을 해석할 수 있으면 해당 씬을 `validFrom`으로 삼고, 같은 subject/key의 이후 버전과 구분되는 id를 부여합니다.
- Codex CLI provider의 기본 모델을 `gpt-5.5`로 바꾸고, 기존 `gpt-5-codex` 설정은 현재 catalog 기본값으로 보정합니다.
- Codex CLI는 ChatGPT 구독 기반 사용을 반영해 토큰 사용량만 기록하고 USD 비용은 `0`으로 기록합니다. 이전 gpt-5-codex API 요금 환산 추정치는 제거했습니다.

### 수정

- Codex CLI가 JSONL 오류 이벤트와 함께 실패할 때, 일반 종료 코드 메시지 대신 CLI가 제공한 구체적인 실패 사유를 표시합니다.

### 문서

- README, 아키텍처 문서, 작가 가이드, 수동 QA 문서에 canon 키워드 주입, 롤링 요약 컨텍스트, 검수 점수 기준, Codex 비용 기록 변경을 반영했습니다.

## [0.3.1] - 2026-06-22

### 추가

- Claude Code(`claude`)·Codex(`codex`) CLI provider를 추가했습니다. API 키 없이 각 CLI의 자체 로그인(구독)으로 생성하며, 실행 명령·모델은 설정과 **연결** 탭에서 바꿀 수 있습니다.
- 연결 테스트가 CLI 바이너리를 찾지 못한 경우(`ENOENT`)를 그 밖의 실패와 구분해 «CLI 미설치»로 표시합니다.
- Claude Code 비용은 CLI가 보고하는 `total_cost_usd`를 기록하고, Codex 사용량은 `codex exec --json`에서 파싱합니다. Codex 비용은 gpt-5-codex API 요금으로 환산한 추정치이며 실제 청구액이 아닙니다.

### 변경

- CLI provider는 실시간 토큰 스트리밍 대신 전체 결과를 한 번에 전달하고, 인라인 완성은 CLI provider에서 비활성화합니다.
- CLI provider에서는 각 CLI가 노출하지 않는 `temperature`와 출력 토큰 상한(`maxTokens`)을 적용하지 않습니다.

### 수정

- Claude Code와 Codex 연결 테스트가 CLI 실행 가능 여부뿐 아니라 로그인 상태까지 확인하도록 보강했습니다.
- 사용자 지정 CLI command가 stdin 소비 전 종료해도 `EPIPE`로 확장이 중단되지 않도록 보호했습니다.
- Codex `--json` 이벤트 파싱을 강화해 빈 usage 이벤트가 앞선 사용량을 0으로 덮어쓰지 않도록 했습니다.

### 문서

- README와 아키텍처 문서에 CLI provider 지원 범위, 인증 방식, 비용 추정, 스트리밍·인라인 완성 제한을 정리했습니다.

## [0.3.0] - 2026-06-21

### 추가

- `Storyboard: Generate Novel` 명령으로 작품 설정 → outline → 시드 → 장별 초안·검수 → 조립 → 검사 → 요약까지 원클릭 실행하고 단계별로 재개할 수 있습니다.
- `Storyboard: Canon Diff Report`(`storyboard.bible.canonDiff`)가 아직 승격되지 않은 설정 후보를 `canon.yaml`과 대조해 `manuscript/CANON.md`로 정리합니다.
- `Storyboard: Export Draft…`(`storyboard.draft.export`)가 조립 원고를 Markdown 또는 일반 텍스트로 내보냅니다. (PDF/DOCX는 후속)
- 검수·재작성 결과와 지시를 `.storyboard/outline/revision-plan.yaml`에 scene 단위로 누적합니다.
- 작품 계약에 문체 제약(`styleConstraints`)·품질 기준(`qualityCriteria`)을 추가하고 **작품 계약** 설정 탭에서 편집합니다. 해당 기준은 draft critique 프롬프트에도 반영됩니다.
- `chapters.yaml`에 chapter/scene 단위 목표 분량(`targetWordCount`)을 저장합니다.
- outline 기반 씬 시드에 갈등(`conflict`), 반전(`twist`), 필요 설정(`neededCanon`), 목표 분량을 포함합니다.
- 확장 UI 다국어(i18n) 메커니즘(`package.nls.json` / `package.nls.ko.json`)을 도입하고 모든 명령 제목을 외부화했습니다.

### 변경

- `chapters.yaml`가 씬보다 최신이면 Scenes 사이드바에 "outline" stale 배지를 표시합니다.

## [0.2.4] - 2026-06-18

### 추가

- 스토리 바이블 도메인과 파일 I/O를 추가했습니다. 작품 설정·캐논을 워크스페이스에 저장·로드할 수 있습니다.
- 씬 생성 시 스토리 바이블 캐논을 프롬프트에 주입합니다.
- 연속성 검사(continuity check) AI 작업을 추가했습니다.
- 초안에 연속성 진단 결과를 표시하고, 초안 CodeLens에서 연속성 검사를 실행할 수 있습니다.
- 바이블 후보(bible candidate) 팩트 저장소와 설정 팩트 추출 AI 작업을 추가했습니다.
- 초안 생성 후 바이블 후보를 자동 추출하고, 후보를 캐논으로 승격하는 명령을 추가했습니다.
- 배경 카드 폼에서 관련 캐릭터(`characterIds`)를 편집할 수 있습니다.

### 문서

- 스토리 바이블·연속성 검사·바이블 후보 승격 흐름을 문서화했습니다.
- 작가용 시작 가이드(`GUIDE.md`)를 추가했습니다.
- 제품 계획을 “작가 보조형 픽션 IDE”에서 **원클릭 장편 생성 IDE / Autonomous Fiction Studio** 방향으로 재정렬했습니다. `ARCHITECTURE.md`, README, agent rule 요약을 같은 용어로 갱신했습니다.

## [0.2.3] - 2026-06-14

### 변경

- `.seed` 가져오기/보내기를 `@seedcoat/wasm` v0.4.0 저장소 엔진 API(`load`/`checkoutSnapshot`, `init`/`note`/`save`)로 전환했습니다. `.seed`는 이제 전체 변경 이력을 보존하는 비암호화 포터블 아카이브(`seedcoat archive v1`)입니다.
- 가져오기/보내기에서 패스프레이즈 입력과 암호화/복호화 진행 알림을 제거했습니다. 내보내기 시 비암호화 고지를 1회 표시합니다.
- Seed 오류 메시지를 신규 오류 코드 체계(`UNSUPPORTED_FORMAT`, `HASH_MISMATCH` 등 11종)에 맞게 교체했습니다.
- `@seedcoat/wasm`이 순수 TypeScript 패키지가 되어 확장 번들에 직접 포함합니다. `out/vendor` 복사 단계(`scripts/copy-seedcoat.mjs`)와 동적 import 로더를 제거했습니다.

### 제거

- 구 암호화 `.seed`(seedcoat v0.2) 지원을 제거했습니다. 해당 파일은 지원하지 않는 형식으로 거부되며, 보낸 쪽에서 v0.4 형식으로 다시 내보내야 합니다.

## [0.2.2] - 2026-05-28

### 추가

- 캐릭터 카드에 역할(`protagonist` / `supporting` / `extra`)을 명시할 수 있는 스키마와 에디터 입력 UI를 추가했습니다.
- 캐릭터 사이드바를 역할별 그룹(주연·조연·엑스트라·미분류)으로 나누고, 그룹별 접기/펼치기와 카드 수 표시를 지원하도록 개선했습니다.
- 카드 에디터·미리보기의 `StoryboardCard`에 카드 게임 스타일 프레임(캐릭터/배경 톤 구분)과 역할 배지(주연·조연·엑스트라 색·문양)를 적용했습니다.
- 카드 에디터에 원본 YAML 편집 패널을 추가했습니다. 저장 전 YAML 검증 오류를 표시하고, 성공 시 카드 데이터를 다시 동기화합니다.
- 캐릭터 관계 미리보기 패널을 추가해 캐릭터의 arc 흐름과 관계 목록을 카드 에디터에서 바로 확인할 수 있습니다.
- 캐릭터 관계 표시에서 관계 대상 ID를 캐릭터 이름/역할 정보와 함께 보여주는 roster lookup을 추가했습니다.

### 변경

- 카드 에디터 Overview 필드(List/Arc/Relations/Key-Value)의 항목 추가·삭제 버튼을 `+` / `-` 아이콘 `IconButton`으로 교체했습니다.
- 카드 미리보기 영역을 `PreviewPanel`로 분리해 카드 에디터 본문과 미리보기 렌더링 책임을 나눴습니다.
- Arc와 Relations 입력 UI의 배열 편집 흐름을 정리하고, 관계 미리보기와 동일한 데이터 형태를 사용하도록 맞췄습니다.
- 초기 프로젝트 템플릿과 경로 규칙에서 더 이상 쓰지 않는 character relation 샘플 경로 생성을 제거했습니다.

## [0.2.1] - 2026-05-24

### 수정

- 탐색기 F2 rename 시 카드 본문 `id` 갱신이 적용되지 않던 문제를 수정했습니다. `onWillRenameFiles` 시점에 `oldUri`에 텍스트 edit를 걸도록 변경했습니다.
- 사이드바·명령 팔레트 **ID 변경**이 `fs.rename`만 호출해 참조·프로필이 갱신되지 않던 문제를 수정했습니다. `workspace.applyEdit` + `renameFile`로 participant 경로와 통일했습니다.

### 추가

- 탐색기에서 `*.card` 파일 rename 시 본문 `id`, 다른 카드 참조, 캐릭터 프로필 이미지를 함께 갱신합니다. 사이드바 컨텍스트 메뉴의 **ID 변경** 명령(`storyboard.character.rename`, `storyboard.background.rename`)도 같은 경로를 사용합니다.
- Seed 가져오기·동기화 직후 **ID 매핑 검토** QuickPick을 추가했습니다. 카드별 새 ID를 지정할 수 있으며, **변경 없이 계속**을 선택하면 기존 흐름과 동일합니다.

## [0.2.0] - 2026-05-22

### 변경

- `doc/` 트리를 비추적 `.doc/`으로 옮기고(원격 저장소에는 포함하지 않음), 공개 문서는 루트 `ARCHITECTURE.md`, `STORYBOARD_ALIGNMENT.md`, `EXTENSION_QA.md`, `RELEASE.md`, `GUIDE.md`로 정리했습니다. README, AGENTS, Cursor/Clinerules, 스킬 문서의 링크를 갱신했습니다.
- `.seed` 파일을 평문 JSON envelope(`version: "2.0.0"`)에서 **`@seedcoat/wasm` v0.2.0 암호화 컨테이너**로 완전히 이관했습니다(하드 컷오버). 이전 평문/구버전 `.seed`는 더 이상 지원하지 않으며 `LEGACY_FORMAT_REJECTED`로 거부됩니다.
- 배경 카드 스키마를 단일 `type: background`에서 **판별 유니온(`location` / `temporal` / `social`)**으로 교체하고, 공통 필드(`characterIds`, `tags`)와 `locationKind`(location 전용)를 도입했습니다. 이전 `concept` / `country` / `category` 필드는 제거되었습니다.
- 프로젝트 메타데이터의 `settings`를 `editor`(`scenePrefixDigits`, `trackDraft?`)와 작품 단위 `setting`(genre/country/concept/tags/description)으로 분리했습니다.
- 루트 `SEED-FORMAT.md`를 제거하고, 컨테이너 명세는 [seedcoat](https://github.com/webfic/seedcoat)를 단일 진실원으로 둡니다. Storyboard 정책은 [`STORYBOARD_ALIGNMENT.md`](STORYBOARD_ALIGNMENT.md)에 정리했습니다.

### 추가

- Seed import/export 시 패스프레이즈 입력 다이얼로그를 추가했습니다(import 1회, export 입력+확인 2회 및 손실 경고). 빈 패스프레이즈는 허용하지 않으며 저장하지 않습니다.
- 가져오기 시 패스프레이즈 입력 전 `inspectHeader`로 레거시 평문 `.seed`를 거부합니다.
- seedcoat 오류 코드 전체에 대한 한국어 메시지 매핑(`src/constants/projectStorageMessages.ts`)을 추가했습니다.
- `.seed` 보내기/가져오기 시 KDF 대기용 진행 알림(`withProgress`)을 추가했습니다.
- `.seed` 보내기 전 `scenePrefixDigits`·씬 stem seedcoat 규칙 사전 검사(`src/files/seedExportPreflight.ts`)를 추가했습니다.
- [`EXTENSION_QA.md`](EXTENSION_QA.md)에 `.seed` 수동 QA 절, [`RELEASE.md`](RELEASE.md)에 `compile`·VSIX `.seed` smoke 절차를 추가했습니다.

### 참고

- 캐릭터 `arc` / `recentDialogues` / `profile` / `attributes`는 `.seed` 왕복에서 보존되지 않습니다(seedcoat가 encode 시 폐기). `trackDraft`는 seed `project` envelope에 없어 동기화 시 덮어쓰면 소실될 수 있습니다. 기존 워크스페이스의 구 형식 background 카드는 자동 마이그레이션되지 않습니다.

## [0.1.3] - 2026-05-21

### 추가

- Seed `.seed` 파일 포맷 v2 envelope의 공식 사양 문서(`SEED-FORMAT.md`)를 추가했습니다.
- Seed 파일에서 Storyboard 프로젝트를 생성하고 기존 프로젝트와 동기화하는 command를 추가했습니다.
- Storyboard 프로젝트를 Seed 파일로 내보내는 export command와 관련 문서를 추가했습니다.

## [0.1.2] - 2026-05-11

### 문서

- `README.md`와 `doc/`에서 Visual Studio Marketplace 발행 안내를 제거하고, GitHub Releases 전용 VSIX 배포 방침에 맞췄습니다.
- `README.md`와 `doc/plan.md`에 한국어 변경 내역 링크와 릴리스 노트 동기화 안내를 추가했습니다.

## [0.1.1] - 2026-05-09

### 추가

- 점진적 UI 업데이트를 위한 AI 스트리밍 RPC(`ai.generateStream`)와 청크 이벤트(`ai.generateStream.chunk`)를 추가했습니다. 네이티브 스트리밍을 지원하지 않는 provider는 registry를 통해 단일 응답 생성으로 fallback합니다.
- scene draft 생성 중 긴 `previousContext`를 선택적으로 줄이기 위한 `storyboard.ai.contextCondenseEnabled` 설정을 추가했습니다.

### 변경

- Prompt variant 선택이 provider 전용 routing 대신 task, model, token budget(`xs` / `generic` / `rich`)을 함께 고려하도록 변경했습니다.
- `rich` variant가 선택되면 persona dialogue와 genre formatting 등 장문 prompt가 더 풍부한 지시문을 사용하도록 변경했습니다.

## [0.1.0] - 2026-05-09

### 변경

- 문서: `doc/plan.md`, `doc/concept.md`, `doc/decisions/01-project-initialization.md`, `doc/testing/extension-qa.md`, `README.md`를 release policy에 맞게 정렬했습니다 — `.picktion` import 없음, extension UI i18n은 **`ko` 기본**, **`en` 선택**, 첫 Marketplace 목표는 **0.1.0**(Phase 7–8).
- 문서: `doc/plan.md`에서 Phase 7이 publish 전 LICENSE, privacy, Marketplace metadata를 담당하도록 하고, Phase 8을 `vsce publish` 직전 최종 QA gate로 정리했습니다.

### 추가

- tag 기반 VSIX packaging과 checksum asset을 생성하는 GitHub Release workflow를 추가했습니다.
- `@vscode/vsce` 기반 로컬 `npm run package:vsix` script를 추가했습니다.
- 기본 provider, provider별 curated model, task별 provider override, Ollama base URL, API key(SecretStorage), connection check를 관리하는 settings webview panel(`Storyboard: Open Settings`)을 추가했습니다. settings RPC와 `settings.changed` sync도 포함됩니다.
- cache metadata와 새 draft 생성 시 선택적 trait update를 포함하는 scene-to-draft generation pipeline을 추가했습니다(Phase 4).
- tree, status badge, in-view action을 제공하는 Scenes sidebar webview를 추가했습니다(Phase 5).
- Character relation graph panel(d3-force)과 `Storyboard: Open Character Relation Graph` command를 추가했습니다(Phase 5).
- draft가 있는 경우 `scene/*.txt`에서 generate/regenerate draft와 apply format을 실행할 수 있는 CodeLens를 추가했습니다(Phase 5).
- `draft/*.md`에서 re-generate, grammar check, expand를 실행할 수 있는 CodeLens를 추가했습니다. grammar/expand는 Phase 6 placeholder notice를 표시합니다(Phase 5).
- 0.0.1 dogfooding을 위한 manual MVP QA guide를 `doc/testing/extension-qa.md`에 추가했습니다(Phase 5).
- Storyboard VSCode extension의 repository baseline을 수립했습니다.
- 초기 TypeScript 및 esbuild extension-host scaffold를 추가했습니다.
- `storyboard.helloWorld` sanity-check command를 추가했습니다.
- F5 extension debugging을 위한 VSCode launch/tasks 설정을 추가했습니다.
- ESLint 및 Prettier baseline 설정을 추가했습니다.
- Storyboard workspace 구조를 생성하는 `storyboard.init` command를 추가했습니다.
- `.storyboard/project.json`의 project metadata validation을 추가했습니다.
- extension-host workspace, path convention, logger module을 추가했습니다.
- Storyboard Activity Bar container와 sidebar placeholder view를 추가했습니다.
- 최소 Vite 및 React webview UI build를 추가했습니다.
- `.card` YAML schema, round-trip test, Storyboard card custom editor를 추가했습니다.
- file watching과 card opening을 지원하는 Characters 및 Backgrounds sidebar view를 추가했습니다.
- sidebar에서 character/background card를 생성하는 command를 추가했습니다.
- `mock`을 기본 provider로 사용하는 Storyboard AI provider configuration key를 추가했습니다.
- SecretStorage 기반 API key 관리와 `Storyboard: Set API Key...` command를 추가했습니다.
- Phase 3 AI integration을 위한 testable `SecretStore` 및 `ConfigBridge` adapter를 추가했습니다.
- mock 및 OpenAI provider를 지원하는 Phase 3 AI provider registry를 추가했습니다.
- 초기 `ai.providers.list`, `ai.providers.checkConnection`, `ai.generate` RPC contract를 추가했습니다.
- Phase 3 AI registry에 Claude, Google Gemini, Ollama provider support를 추가했습니다.
- response parsing, JSON repair, trait processing을 위한 deterministic AI utility module을 추가했습니다.
- 최소 Storyboard AI service facade와 Phase 3 orchestration용 core prompt module을 추가했습니다.

### 문서

- README를 Phase 5 scope 및 0.0.1 dogfooding에 맞게 정렬했습니다(Marketplace publish는 아직 없음).
- `doc/plan.md` MVP gate를 local `vsce package`, QA, dogfooding 중심으로 재정의했습니다.

### 변경

- Project license를 MIT에서 Apache License 2.0으로 변경했습니다(`LICENSE`, `package.json`).
- Phase 0을 Picktion compatibility fixture 대신 repository readiness에 집중하도록 축소했습니다.
- `npm run build`가 extension host와 webview UI를 모두 bundle하도록 packaging script를 업데이트했습니다.
