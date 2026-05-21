# Storyboard 확장 — 0.0.1 수동 QA 가이드

Storyboard **0.0.1**은 기본 동작을 검증하는 **dogfooding** 단계입니다. GitHub Releases용 VSIX를 준비하기 전에, 아래 절차로 **실제 VS Code**에서 한 번씩 확인합니다.

문서상 출시 로드맵: Phase 7에서 **0.1.0** 메타·export·온보딩·i18n(**`ko` 기본**, **`en` 옵션**)을 두고, Phase 8에서 GitHub Releases용 VSIX 검증을 목표로 한다. `.picktion` import는 비목표다 ([`ARCHITECTURE.md`](ARCHITECTURE.md), 로컬 `.doc/plan/storyboard-plan.md`).

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

- **성공 기준**: 에러 없이 끝나고, `out/extension.js` 및 `out/webview-ui/` 산출물이 생깁니다.

**웹뷰(UI)만 수정하고 다시 확인할 때**

- 저장소 루트에서 **`npm run build:webview`** 만 실행해도 됩니다(Vite가 `webview-ui/`를 `out/webview-ui/`로 번들함).
- 확장 호스트 코드(`src/` 등)는 바뀌지 않았다면 `npm run compile`은 생략 가능합니다.
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
| 각 뷰 제목 줄 **톱니바퀴** | **`Storyboard: Open Settings`** — 세 뷰 모두 **동일한** Storyboard 설정 패널(웹뷰)이 열림 |
| **Characters** 목록 vs **Backgrounds** 목록 | 캐릭터 카드(`character/*.card`)와 배경 카드(`background/*.card`)가 **서로 섞이지 않음** |
| **Characters / Backgrounds** 카드 항목 | 이미지 없는 컴팩트 카드로 보이며, 항목 클릭은 카드 열기, 휴지통 버튼은 삭제 확인 후 `.card` 파일 삭제 |
| **Scenes** 목록 | 씬·드래프트 상태가 갱신되는지(준비/미생성 등 배지·버튼) |

**성공 기준**: 위 표가 모두 맞고, Characters **+** 로 만든 파일이 Backgrounds 목록에 나타나지 않으며 그 반대도 같다. 카드 삭제 시 VS Code 확인 다이얼로그가 뜨고, 확인하면 해당 항목과 파일이 사라진다.

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

### 6. 드래프트 생성 (씬 파일 CodeLens)

1. `scene/` 아래의 `.txt` 씬 파일을 연다.
2. 파일 **맨 위 줄 근처**에 CodeLens가 보이는지 확인한다.
   - 드래프트가 없으면: **`▶ Generate Draft`**
   - 이미 있으면: **`🔄 Regenerate Draft`**
   - 드래프트가 있을 때만: **`🎭 Apply Format`**
3. **`▶ Generate Draft`** 또는 **`🔄 Regenerate Draft`** 를 클릭한다.

**성공 기준**

- `draft/` 아래에 대응하는 `.md` 파일이 생기거나 갱신된다.
- 진행 알림/로그에 치명적 오류만 없으면 된다(첫 실행은 시간이 걸릴 수 있음).

**명령 팔레트로 동일 동작**

- 씬 파일을 활성 에디터로 둔 상태에서: **`Storyboard: Generate Draft (Current Scene)`** 등

### 7. 드래프트 파일 CodeLens

1. 생성된 `draft/*.md`를 연다.
2. 상단 CodeLens 확인:
   - **`🔁 Re-generate Draft`** — 동작해야 함
   - **`🩹 Grammar Check`** — 진단(squiggle) 생성 또는 갱신
   - **`🌿 Expand`** — 선택 영역이 있을 때 확장문으로 치환

### 7a. 캐릭터 Hover 카드

1. `draft/*.md` 본문에서 등장 캐릭터 이름 위에 마우스를 올린다.
2. Hover 카드에 캐릭터 요약(특성/최근 대사/관계)이 표시되는지 확인한다.

**성공 기준**

- 프로젝트의 `character/*.card`에 있는 캐릭터만 Hover 카드가 뜬다.
- 이름이 일치하지 않거나 프로젝트가 아니면 Hover가 뜨지 않는다.

### 8. Scenes 사이드바

1. Activity Bar에서 **Storyboard · Scenes** 아이콘을 눌러 **Scenes** 뷰를 연다.
2. 씬 목록과 상태 표시(준비 / 구버전 / 미생성 등)가 기대와 맞는지 본다.
3. 행에 붙은 **Generate**, **Open Draft** 등 웹뷰 버튼이 동작하는지 확인한다.

> Activity Bar의 `WebviewView` 사이드바에는 탐색기처럼 **행마다 VS Code 기본 컨텍스트 메뉴**가 붙지 않는다. 씬별 액션은 **뷰 내부 버튼**과 **view/title**의 명령을 사용한다.

### 9. 관계 그래프

명령 팔레트: **`Storyboard: Open Character Relation Graph`**

**성공 기준**

- 패널이 열리고 캐릭터 노드·링크가 보인다.
- 노드를 **드래그**할 수 있다.

### 10. 캐시 동작 (선택)

동일 씬·동일 설정으로 **Generate**를 다시 실행했을 때, 캐시 hit 메시지 또는 기대한 재사용 동작이 있는지 확인한다. (프로젝트 옵션·입력이 동일해야 함)

### 11. API 키·기본 provider (`storyboard.defaultProvider`)

Storyboard는 **기본 AI 백엔드**를 설정 키 `storyboard.defaultProvider`로 고릅니다.  
가능한 값: `mock`, `openai`, `claude`, `google`, `ollama` (`package.json`의 `contributes.configuration`과 동일).

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

저장소 루트에서:

```bash
npm run build
npx @vscode/vsce package
```

- **성공 기준**: `storyboard-0.0.1.vsix`(또는 유사 이름)가 생성된다.
- **용량**: `.vsix`가 **50MB 미만**인지 확인한다 (`du -h *.vsix` 등).

일반 VS Code 창에서:

1. **Extensions** 뷰 → **`...` 메뉴 → Install from VSIX…**
2. 위에서 만든 `.vsix` 선택
3. **새 빈 폴더**를 연 뒤, 위 **3번부터** 동일하게 진행한다.

---

## `.seed` 암호화 컨테이너 (seedcoat v0.2)

**전제**: `npm run compile`로 `out/vendor/@seedcoat/wasm`이 번들에 포함된 상태에서 F5 또는 VSIX로 검증한다. 평문 JSON envelope(구 `version: "2.0.0"`) `.seed`는 지원하지 않는다.

### 준비

- [ ] 테스트용 Storyboard 워크스페이스(캐릭터·배경·씬 `01-…` stem)가 있다.
- [ ] 동일 워크스페이스를 **보내기**한 `.seed` 파일 1개를 만든다(패스프레이즈 기억).

### 바이너리·레거시

- [ ] 저장된 `.seed`를 텍스트 에디터로 열면 **바이너리**이며, 평문 `version` JSON이 보이지 않는다.
- [ ] 구 평문 `.seed`로 **가져오기** 시 패스프레이즈 입력 **전**에 레거시 거부 메시지가 뜬다.

### 보내기 (export)

- [ ] 명령 **Storyboard: Seed 파일로 보내기** → 저장 대화상자 → 패스프레이즈 2회 확인 → **암호화 중…** 알림이 뜨고, 수 초~수십 초 후 완료된다.
- [ ] `scene/1-opening.txt`처럼 **두 자리 prefix가 아닌 stem**이 있으면 보내기 **전**에 한국어 사전 검사로 중단된다(패스프레이즈 입력 전).
- [ ] `editor.scenePrefixDigits`가 `2`가 아니면 보내기가 사전 검사로 중단된다.

### 가져오기·동기화 (import / sync)

- [ ] **복호화 중…** 진행 알림이 뜨고, 잘못된 패스프레이즈 시 한국어 오류가 표시된다.
- [ ] 올바른 패스프레이즈로 **새 폴더에 만들기** 후 `project.json`, 카드, `scene/*.txt`가 기대와 일치한다.
- [ ] 기존 워크스페이스 **동기화** 시 충돌·삭제 확인 후 반영된다.

### 데이터·호환

- [ ] 보내기 다이얼로그에 arc/profile 등 **미포함** 안내가 있다. round-trip 후 해당 필드가 사라지는지 확인한다(의도된 동작).
- [ ] `trackDraft` 등 seed `project` envelope에 없는 필드는 동기화 시 덮어쓰기 정책을 [`STORYBOARD_ALIGNMENT.md`](STORYBOARD_ALIGNMENT.md)와 대조한다.
- [ ] 구 `type: background` 카드가 있는 워크스페이스는 보내기/읽기 실패 시 메시지로 원인을 파악할 수 있다.

### VSIX 패키징

- [ ] `npm run package:vsix -- --out dist/storyboard-<version>.vsix` 성공.
- [ ] VSIX 설치 후 위 **보내기·가져오기**를 **최소 1회** 반복한다(`out/vendor` 포함 확인).

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

## 패키징 게이트 (0.0.1)

- [ ] `npm run build` 성공
- [ ] `npm run lint` 성공
- [ ] `npm test` 성공
- [ ] `npx @vscode/vsce package` 성공, `.vsix` **50MB 미만**
- [ ] 위 **End-to-end** 플로우를 최소 1회 통과
- [ ] **3a** 절차로 Characters / Backgrounds / Scenes 세 뷰의 **+**·톱니바퀴·목록 분리와 Characters / Backgrounds 컴팩트 카드 열기·삭제를 확인
- [ ] **1주 dogfooding** (매일 짧게라도 실제 작업 흐름에 넣고 이슈 적기)

저장소 릴리스 태그 생성과 GitHub Release 업로드는 **이번 0.0.1 게이트 범위에 포함하지 않는다.**
