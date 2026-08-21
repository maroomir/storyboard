# Storyboard 확장 — 수동 QA 가이드

Storyboard의 기본 동작과 장편 생성 흐름을 검증하는 **dogfooding** 체크리스트입니다. GitHub Releases용 VSIX를 준비하기 전에, 아래 절차로 **실제 VS Code**에서 한 번씩 확인합니다.

문서상 출시 로드맵과 현재 파이프라인 범위는 [`ARCHITECTURE.md`](../../ARCHITECTURE.md)를 기준으로 한다. `.picktion` import는 비목표다.

자동화 테스트(`npm test`)는 결정적 로직 위주입니다. 이 문서의 항목은 **Extension Development Host(F5)** 또는 **로컬 VSIX**로 확인합니다.

---

## 준비물

| 항목 | 설명 |
| --- | --- |
| VS Code | Stable 권장 (Insiders는 선택) |
| Node.js | 18 이상 (저장소 `package.json` / 빌드 도구 기준) |
| 이 저장소 클론 | 개발자가 확장 소스를 연 상태 |
| 테스트용 폴더 | 비어 있거나 Storyboard가 아닌 폴더 하나 (임의 경로) |

**한글 IME**를 쓰는 경우, macOS / Windows에서 각각 한 번씩 같은 플로우를 밟아 두면 좋습니다.

---

## A안: 개발자 — F5로 검증 (가장 흔한 방법)

### 0. 저장소에서 한 번만

터미널에서 저장소 **루트**로 이동합니다.

```bash
cd /path/to/storyboard
npm install
npm run build
```

- **성공 기준**: 에러 없이 끝나고, `apps/desktop/out/extension.js` 및 `apps/desktop/out/webview-ui/` 산출물이 생깁니다.

**웹뷰(UI)만 수정하고 다시 확인할 때**

- **`npm run build:webview`** 만 실행해도 됩니다(Vite가 `webview-ui/`를 `out/webview-ui/`로 번들함). 이 스크립트는 루트에 없으므로 `cd apps/desktop` 후 실행하거나 `npm run build:webview --workspace storyboard`로 실행합니다.
- 확장 호스트 코드(`apps/desktop/src/` 등)는 바뀌지 않았다면 `npm run compile`은 생략 가능합니다(루트에서 실행 가능).
- 이미 떠 있는 **Extension Development Host** 창에서는 빌드 후 **`Developer: Reload Window`**로 리로드해야 변경된 웹뷰가 보이는 경우가 많습니다.

### 1. Extension Development Host 열기

1. VS Code에서 **이 저장소 루트**를 연다.
2. 왼쪽 **Run and Debug**(실행 및 디버그)를 연다.
3. 구성에서 **`Run Extension`** 을 고른 뒤 **F5**를 누른다.
4. 새 창(**Extension Development Host**)이 뜨면 성공이다.

**막혔을 때**

- F5가 안 되면: `npm run build`가 성공하는지, Run 구성이 `Run Extension`인지 확인한다.
- 새 창이 안 뜨면: **View → Output**에서 확장 호스트 로그를 본다.

### 2. 테스트 워크스페이스 열기

**Extension Development Host 창**에서:

1. **File → Open Folder…** (macOS) / **File → Open Folder** (Windows)
2. 미리 만든 **빈 폴더**를 연다.

**성공 기준**: 왼쪽 탐색기에 해당 폴더가 루트로 보인다.

### 3. Storyboard 프로젝트 초기화

1. `Cmd+Shift+P` (macOS) 또는 `Ctrl+Shift+P` (Windows/Linux)로 **명령 팔레트**를 연다.
2. **`Storyboard: Initialize Project`** 를 실행한다.
3. 안내에 따라 진행한다.

**성공 기준**

- 탐색기에 `.storyboard/project.json`, `character/`, `background/`, `scene/`, `draft/` 등이 생긴다.
- Activity Bar 왼쪽에 **Storyboard · Characters**, **Storyboard · Backgrounds**, **Storyboard · Scenes** 아이콘이 **각각** 보인다(한 개의 Storyboard 아이콘 안에 세 탭이 있는 구조가 아님).
- 위 세 아이콘을 각각 클릭하면 대응하는 **Characters**, **Backgrounds**, **Scenes** Webview 사이드바 뷰가 연다.

**막혔을 때**

- 이미 `.storyboard/project.json`이 있으면 초기화는 다시 수행되지 않을 수 있다. 새 빈 폴더를 연다.
- 명령이 안 보이면: 확장이 해당 창에서 활성화됐는지(F5 창인지) 확인한다.

### 3a. 세 사이드바 뷰의 **+** 와 공통 설정(톱니바퀴)

프로젝트 초기화 직후, **세 Activity Bar 진입점**을 각각 열어 다음을 확인한다.

| 확인 항목 | 기대 동작 |
| --- | --- |
| **Storyboard · Characters** → 뷰 제목 줄 **+** | **`Storyboard: Create Character`** — `character/<이름>.card` 생성 |
| **Storyboard · Backgrounds** → 뷰 제목 줄 **+** | **`Storyboard: Create Background`** — `background/<이름>.card` 생성 |
| **Storyboard · Scenes** → 뷰 제목 줄 **+** | **`Storyboard: New Scene`** — `scene/*.txt` 생성 흐름 |
| **Storyboard · Scenes** → 완결 아이콘 | **`Storyboard: Complete Story Scenes`** — 기존 씬을 수정하지 않고 새 완결 씬 제안 |
| **Storyboard · Characters / Backgrounds** → 반짝임 아이콘 | **`Storyboard: Build Cards from Scenes`** — 씬 근거 신규/보강 카드 제안 |
| 각 뷰 제목 줄 **톱니바퀴** | **`Storyboard: Open Settings`** — 세 뷰 모두 **동일한** Storyboard 설정 패널(웹뷰)이 열림 |
| **Characters** 목록 vs **Backgrounds** 목록 | 캐릭터 카드(`character/*.card`)와 배경 카드(`background/*.card`)가 **서로 섞이지 않음** |
| **Characters / Backgrounds** 카드 항목 | 이미지 없는 컴팩트 카드로 보이며, 항목 클릭은 카드 열기, 휴지통 버튼은 삭제 확인 후 `.card` 파일 삭제 |
| **Scenes** 목록 | 씬·드래프트 상태가 갱신되는지(준비/미생성 등 배지·버튼) |

**성공 기준**: 위 표가 모두 맞고, Characters **+** 로 만든 파일이 Backgrounds 목록에 나타나지 않으며 그 반대도 같다. 카드 삭제 시 VS Code 확인 다이얼로그가 뜨고, 확인하면 해당 항목과 파일이 사라진다.

### 3b. 이야기 완결과 씬 기반 카드 구성

1. 유효한 `scene/*.txt`를 둘 이상 만들고 Studio를 연다. 다른 파일이 활성화되어도 프로젝트 칩과 **이야기 완결**·**씬 기반 카드 구성** 칩이 보이는지 확인한다.
2. **이야기 완결**을 승인한다. 연속 prefix 선택, 빈 문서와의 diff, 최종 확인을 거쳐 새 씬만 추가되는지 확인한다. 기존 씬의 내용과 파일명은 바뀌면 안 된다.
3. **씬 기반 카드 구성**을 승인한다. 필드별 QuickPick에서 일부만 고르고 카드 YAML diff를 확인한 뒤 적용한다. 신규 한국어 이름 카드에는 고유 ID 입력 상자가 뜨고 profile PNG가 생기지 않아야 한다.
4. diff를 연 뒤 씬 또는 카드 하나를 수정하고 적용한다. 변경이 중단되고 다시 제안하라는 메시지가 보여야 한다.

### 4. 캐릭터·배경 카드 추가

**Extension Development Host** 창에서:

1. Activity Bar에서 **Storyboard · Characters** 또는 **Storyboard · Backgrounds** 아이콘을 눌러 해당 뷰를 연다.
2. 뷰 **제목 줄 오른쪽**의 **+** 로 카드를 만든다(역할은 **3a** 표와 동일).

**성공 기준**

- `character/<이름>.card` 또는 `background/<이름>.card` 파일이 생긴다.
- 파일을 열면 **Storyboard Card** 커스텀 에디터가 뜬다.
- 사이드바에는 이미지 없는 컴팩트 카드 항목으로 표시된다.
- 항목의 편집 아이콘 또는 본문 클릭으로 카드 에디터가 열린다.
- 항목의 휴지통 아이콘으로 삭제 확인 후 `.card` 파일을 삭제할 수 있다.

### 5. 씬 작성 또는 새 씬 만들기

**방법 1 — 샘플 씬 편집**

- `scene/01-prologue.txt` 등을 연 뒤 본문을 조금 수정해 저장한다.

**방법 2 — 새 씬**

- 명령 팔레트: **`Storyboard: New Scene`** (또는 Scenes 뷰 제목의 **New Scene**)
- 안내에 따라 파일명이 생성되는지 확인한다.

**성공 기준**: `scene/*.txt`가 저장되고, 내용이 유지된다.

### 6. 드래프트 생성 (씬 파일 + Studio 패널)

1. `scene/` 아래의 `.txt` 씬 파일을 연다.
2. **Storyboard · Studio** 패널(액티비티바)을 연다. 헤더와 입력창 컨텍스트 칩에 `씬 · <파일명>`이 표시되는지 확인한다.
   - 드래프트가 없으면 제안 칩에 **`초안 생성`**
   - 이미 있으면 제안 칩에 **`재생성`**·**`형식 적용`**
3. 입력창에 "초안 생성"(또는 "다시 생성")이라고 적어 보내거나 제안 칩을 누른 뒤, 나타난 제안에서 **`승인`**을 누른다.

**성공 기준**

- `draft/` 아래에 대응하는 `.md` 파일이 생기거나 갱신된다.
- 진행 알림/로그에 치명적 오류만 없으면 된다(첫 실행은 시간이 걸릴 수 있음).

**명령 팔레트로 동일 동작**

- 씬 파일을 활성 에디터로 둔 상태에서: **`Storyboard: Generate Draft (Current Scene)`** 등

### 7. 드래프트 파일 Studio 패널

1. 생성된 `draft/*.md`를 연다. Studio 패널 헤더에 `초안 · <파일명>`이 표시되는지 확인한다.
2. **본문을 끝까지 스크롤해도** 패널 입력창이 사라지지 않는지 확인한다.
3. 입력창에 작업을 적어 보내거나 제안 칩을 눌러 제안을 받은 뒤 **`승인`**으로 실행한다:
   - "다시 생성" → **재생성**
   - "문법 봐줘" → **문법 검사**(진단 squiggle 생성 또는 갱신)
   - "연속성 확인" → **연속성 검사**(canon이 있으면 설정 모순 진단 생성 또는 갱신)
   - 본문에서 영역을 선택한 뒤 "확장" / "선택 영역 보충" → 선택 영역을 치환/보충(영역 없이 요청하면 먼저 선택하라고 안내)
   - 영역 선택 후 "더 긴장감 있게" 같은 지시문 → **선택 영역 편집**
4. 제안에서 **`취소`**를 누르면 실행되지 않는지 확인한다.
5. (선택) 패널 헤더를 우측 **Secondary Side Bar**로 드래그해도 동일하게 동작하는지 확인한다.

### 7a. 캐릭터 Hover 카드

1. `draft/*.md` 본문에서 등장 캐릭터 이름 위에 마우스를 올린다.
2. Hover 카드에 캐릭터 요약(특성/최근 대사/관계)이 표시되는지 확인한다.

**성공 기준**

- 프로젝트의 `character/*.card`에 있는 캐릭터만 Hover 카드가 뜬다.
- 이름이 일치하지 않거나 프로젝트가 아니면 Hover가 뜨지 않는다.

### 7b. 초안 검수·재작성 루프

1. `draft/*.md`를 활성 에디터로 둔다.
2. **`Storyboard: Review & Revise Draft (Current Scene)`** 실행.
3. `storyboard.draft.reviseMaxIterations` 기본값(2)에서 완료 또는 남은 차단 이슈 안내가 표시되는지 확인한다.
4. `storyboard.draft.reviseScoreThreshold` 기본값(0)에서는 동작이 변하지 않는지, 값을 올렸을 때(예: 90) 점수 기준 충족 시 루프가 더 일찍 통과하는지 확인한다. 최종 검사 보고서에 `비평 점수: NN/100` 줄이 표시되는지 확인한다.

**성공 기준**

- 초안이 필요 시 재작성된다.
- `.storyboard/outline/revision-plan.yaml`에 scene stem, 검사 시각, 재작성 횟수, 남은 차단 이슈, 지시가 기록된다.
- Output에 API 키·토큰 원문이 노출되지 않는다.

### 7c. 이전 초안 히스토리 보관

1. `storyboard.draft.keepHistory`를 `true`로 설정한다.
2. 이미 `draft/<scene>.md`가 있는 씬에서 **Regenerate**(또는 Generate)를 실행한다.
3. `.draft/<scene>/<yyyy-mm-dd-hh-mm>-rev-01.md`에 직전 초안이 그대로 보관되는지 확인한다.
4. 같은 씬을 한 번 더 재생성하면 `rev-02.md`가 추가되는지 확인한다.

**성공 기준**

- `draft/<scene>.md`는 최신 결과로 덮어써지고, 이전 버전은 `.draft/<scene>/`에 시간값 + `rev-NN`으로 누적된다.
- 옵션이 꺼져 있으면 `.draft/`가 생성되지 않는다.
- 보관에 실패해도 초안 생성 자체는 성공하며, 실패는 Output 경고로만 남는다.

### 8. Scenes 사이드바

1. Activity Bar에서 **Storyboard · Scenes** 아이콘을 눌러 **Scenes** 뷰를 연다.
2. 씬 목록과 상태 표시(준비 / 구버전 / 미생성 등)가 기대와 맞는지 본다.
3. 행에 붙은 **Generate**, **Open Draft** 등 웹뷰 버튼이 동작하는지 확인한다.
4. `.storyboard/outline/chapters.yaml`를 저장(수정)한 뒤 뷰를 새로고침하면, 해당 씬 행에 **"outline"** stale 배지가 보이는지 확인한다.

> Activity Bar의 `WebviewView` 사이드바에는 탐색기처럼 **행마다 VS Code 기본 컨텍스트 메뉴**가 붙지 않는다. 씬별 액션은 **뷰 내부 버튼**과 **view/title**의 명령을 사용한다.

### 8a. 작품 계약·outline·씬 시드

1. **`Storyboard: Open Settings`** → **작품 계약** 탭에서 장르, 독자층, 시점, 목표 분량을 채운다.
2. **`Storyboard: Generate Novel Outline`** 실행 → `.storyboard/outline/synopsis.md`와 `chapters.yaml`가 생성되고 `synopsis.md`가 열리는지 확인한다.
3. `chapters.yaml`에 chapter/scene `targetWordCount`, scene `conflict`, `twist`, `neededCanon`이 포함될 수 있는지 확인한다.
4. **`Storyboard: Generate Scene Seeds`** 실행 → `scene/NN-slug.txt` 파일이 생성되고 첫 씬이 열리는지 확인한다.

**성공 기준**: 필수 계약 필드가 비어 있을 때는 설정 열기 안내가 나오며, 채운 뒤에는 outline과 씬 시드가 재현 가능한 파일로 저장된다.

### 8b. 장편 원클릭 생성 (선택)

1. 위 **8a**의 작품 계약 필드를 채운 프로젝트에서 **`Storyboard: Generate Novel`** 실행.
2. 실행 모드 QuickPick(전체 자동 / 아웃라인 승인 후 진행 / 장별 승인 후 진행)이 뜨는지 확인한다.
3. 아웃라인 승인 또는 장별 승인 모드에서 확인 다이얼로그가 의도한 지점에 뜨는지 확인한다.
4. 진행 중 취소 후 다시 실행하면 `.storyboard/cache/novel-run.json`을 바탕으로 이어서 진행 선택지가 보이는지 확인한다.

**성공 기준**: 완료 후 `manuscript/manuscript.md`가 열리고, `manuscript/REVIEW.md`, `SUMMARY.md`, `FORESHADOWING.md`가 생성된다.

### 8c. 장편 산출물 명령 (선택)

조립 원고·설정 후보가 있는 프로젝트에서 확인한다.

1. **`Storyboard: Assemble Manuscript`** 실행 → `manuscript/NN-chapter.md`, `manuscript/manuscript.md`, `manuscript/FORESHADOWING.md`가 생성되는지 확인한다.
2. **`Storyboard: Review Manuscript`** 실행 → `manuscript/REVIEW.md`가 생성되고 설정 모순·비평 요약이 표시되는지 확인한다.
3. **`Storyboard: Summarize Chapters`** 실행 → `manuscript/SUMMARY.md`에 장별 요약과 이전 장 recap이 표시되는지 확인한다. 이후 2번째 이상 씬을 재생성하면 이전 장면 컨텍스트가 raw tail 대신 이 롤링 요약에서 오는지(SUMMARY.md가 없을 때와 비교) 확인한다. 알려진 한계: 롤링 요약은 장(chapter) 단위로 분리하지 않으므로, 전체 원고를 요약한 뒤 앞쪽 씬을 재생성하면 뒤 장의 상태가 컨텍스트에 섞일 수 있다(향후 chapter-aware 슬라이싱으로 개선 예정).
4. **`Storyboard: Canon Diff Report`** 실행 → `manuscript/CANON.md`가 생성되고, 아직 `canon.yaml`로 승격되지 않은 설정 후보가 목록으로 보이는지 확인한다. (후보가 없으면 "없음" 안내)
5. **`Storyboard: Export Draft…`** 실행 → 형식(Markdown/Plain text) 선택 후 저장 다이얼로그가 뜨고, 저장한 파일이 열리는지 확인한다. 조립 원고(`manuscript/manuscript.md`)가 없으면 먼저 **Assemble Manuscript** 안내가 나오는지 확인한다.

### 9. 관계 그래프

명령 팔레트: **`Storyboard: Open Character Relation Graph`**

**성공 기준**

- 패널이 열리고 캐릭터 노드·링크가 보인다.
- 노드를 **드래그**할 수 있다.

### 10. 캐시 동작 (선택)

동일 씬·동일 설정으로 **Generate**를 다시 실행했을 때, 캐시 hit 메시지 또는 기대한 재사용 동작이 있는지 확인한다. (프로젝트 옵션·입력이 동일해야 함)

### 11. API 키·기본 provider (`storyboard.defaultProvider`)

Storyboard는 **기본 AI 백엔드**를 설정 키 `storyboard.defaultProvider`로 고릅니다.  
가능한 값: `mock`, `openai`, `claude`, `google`, `ollama` (`apps/desktop/package.json`의 `contributes.configuration`과 동일).

#### A. 키 없이 스모크 (`mock`)

1. 아래 **「기본 provider 바꾸기」** 절차를 따라 `storyboard.defaultProvider`를 **`mock`** 으로 둔다.
2. **6. 드래프트 생성**까지 키 없이 진행할 수 있어야 한다.

#### B. 실제 provider (원격 API: OpenAI / Claude / Google)

순서는 **키 등록 → 기본 provider 변경 → 6번 재실행**을 권장한다 (반대로 해도 되지만, provider와 키가 짝이 맞아야 한다).

1. **API 키 저장**  
   명령 팔레트 → **`Storyboard: Set API Key...`** → 사용할 provider 선택 → 키 입력 → 확인.  
   - 키는 **VS Code SecretStorage**에만 들어가며, 일반 `settings.json`에는 저장되지 않는다.  
   - `mock`은 키가 없으므로 이 명령 목록에 나오지 않을 수 있다.

2. **기본 provider를 그 provider로 맞추기** (`storyboard.defaultProvider`)  
   아래 둘 중 편한 방법 하나만 하면 된다.

   **방법 1 — 설정 UI (추천)**

   1. 명령 팔레트 → **`Preferences: Open Settings (UI)`** (macOS 한글 메뉴: **기본 설정: 설정(UI) 열기**)
   2. 검색창에 **`storyboard default`** 또는 **`defaultProvider`** 입력
   3. **Storyboard › Default Provider** 항목에서 방금 키를 넣은 provider와 **같은 값** 선택 (예: OpenAI 키를 넣었다면 `openai`)

   **방법 2 — `settings.json`**

   1. 명령 팔레트 → **`Preferences: Open User Settings (JSON)`**  
      (이 Storyboard 폴더에만 적용하려면 **`Preferences: Open Workspace Settings (JSON)`**)
   2. JSON에 한 줄 추가(예: OpenAI):

   ```json
   "storyboard.defaultProvider": "openai"
   ```

   저장 후 별도 재시작은 보통 필요 없다. 그다음 **6. 드래프트 생성**을 다시 실행한다.

3. **막혔을 때**
   - 설정에 Storyboard 항목이 안 보이면: 확장이 해당 창에 설치·활성화됐는지(F5 호스트 또는 VSIX 설치 창) 확인한다.
   - `defaultProvider`는 `claude`인데 키는 `openai`에만 넣은 경우: **해당 provider에 맞는 키**를 다시 `Storyboard: Set API Key...`로 넣거나, `defaultProvider`를 키가 있는 쪽으로 맞춘다.

#### C. Ollama (로컬, API 키 대신 URL·모델 설정)

`ollama`는 보통 **API 키가 아니라** 설정으로 서버 주소와 모델을 쓴다.

- `storyboard.providers.ollama.baseUrl` (기본값 예: `http://localhost:11434`)
- `storyboard.providers.ollama.model`

위를 맞춘 뒤 `storyboard.defaultProvider`를 **`ollama`** 로 바꾸고 6번을 실행한다. Ollama 데몬이 떠 있는지도 확인한다.

#### D. 작업별로만 다른 provider 쓰기 (선택)

`storyboard.tasks`에 작업별 `provider` override를 줄 수 있다.  
기본은 `storyboard.defaultProvider`를 따른다. QA에서는 우선 **기본값만** 맞춰도 된다.

**성공 기준**

- 키가 없을 때: 실 provider로 생성 시 **이해 가능한 오류/안내**, Output·로그에 **키·토큰 원문 노출 없음**
- 키 등록 후: 생성이 완료되거나, 네트워크 오류 시 사용자에게 전달됨

---

## B안: VSIX로 검증 (배포 없이 “설치 경험”만)

저장소 루트에서 빌드한 뒤, 패키징은 확장 워크스페이스에서 실행한다:

```bash
npm run build
cd apps/desktop
npx @vscode/vsce package
```

- **성공 기준**: `apps/desktop/storyboard-<version>.vsix`(또는 지정한 출력 이름)가 생성된다.
- **용량**: `.vsix`가 **50MB 미만**인지 확인한다 (`du -h *.vsix` 등).

일반 VS Code 창에서:

1. **Extensions** 뷰 → **`...` 메뉴 → Install from VSIX…**
2. 위에서 만든 `.vsix` 선택
3. **새 빈 폴더**를 연 뒤, 위 **3번부터** 동일하게 진행한다.

---

## 카드 ID rename

- [ ] 탐색기 F2, Storyboard 사이드바 카드 컨텍스트 **ID 변경**, 명령 팔레트(`storyboard.character.rename` / `storyboard.background.rename`) 세 경로 모두 본문 `id`, 다른 카드의 `relations.target` / `characterIds`, 캐릭터 `profile/{id}.png`(있을 때)가 함께 갱신된다.
- [ ] `.sample.card` rename은 후처리 대상에서 제외된다.
- [ ] 규칙에 맞지 않는 새 ID(대문자·공백 등)는 경고 후 rename이 취소된다.
- [ ] Finder·터미널 등 VSCode 밖에서 파일명을 바꾼 경우는 자동 갱신되지 않는다. 본문·참조·프로필을 맞추려면 사이드바 **ID 변경** 또는 명령 팔레트 rename을 사용한다.

---

## 회복·에러 시나리오 (짧게)

- **API 키 없음 / 잘못된 키**: 실패 메시지가 뜨고, 다른 기능 전체가 죽지 않는지
- **깨진 YAML** (`.card` 또는 씬): 해당 파일/기능에서만 오류가 나는지
- **없는 이미지 경로**: 카드 UI가 완전히 깨지지 않는지
- **카드 삭제 취소/확인**: 사이드바 휴지통 버튼에서 취소 시 파일이 유지되고, 확인 시 해당 `.card` 파일과 목록 항목이 사라지는지
- **네트워크 끊김**: 타임아웃·재시도 안내가 사용자에게 보이는지

---

## 자동 검증 (개발자가 커밋 전에)

저장소 스크립트만 사용한다.

```bash
npm run build
npm run lint
npm test
```

---

## 기록 (권장)

검증할 때마다 아래를 PR 또는 이슈에 남긴다.

- 날짜
- Git 커밋 SHA
- OS / VS Code 버전
- `mock`만 했는지, 실 provider까지 했는지
- 실패한 단계와 재현 방법

---

## 패키징 게이트

- [ ] `npm run build` 성공
- [ ] `npm run lint` 성공
- [ ] `npm test` 성공
- [ ] `apps/desktop`에서 `npx @vscode/vsce package` 성공, `.vsix` **50MB 미만**
- [ ] 위 A안 또는 B안의 수동 플로우를 최소 1회 통과
- [ ] **3a** 절차로 Characters / Backgrounds / Scenes 세 뷰의 **+**·톱니바퀴·목록 분리와 Characters / Backgrounds 컴팩트 카드 열기·삭제를 확인
- [ ] **8a~8c** 절차로 작품 계약, outline, 씬 시드, 장편 산출물 명령을 확인
- [ ] **1주 dogfooding** (매일 짧게라도 실제 작업 흐름에 넣고 이슈 적기)

저장소 릴리스 태그 생성과 GitHub Release 업로드는 별도 릴리스 절차([`RELEASE.md`](../../RELEASE.md))에서 확인한다.
