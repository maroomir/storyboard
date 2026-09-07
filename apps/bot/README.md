# storyboard-bot

Storyboard 워크스페이스를 텔레그램에서 조회·편집·생성하는 독립 앱입니다. 워크스페이스 디렉터리를 **직접** 편집합니다 — 복제본도, 별도 저장소도 없습니다. 같은 워크스페이스를 VSCode 확장이나 CLI로 동시에 열어도 안전합니다. 사용자 머신에서 long polling으로만 동작하며 인바운드 포트를 열지 않습니다.

## 동작 원칙

- 추적 파일 저장은 항상 커밋입니다. 모든 쓰기는 mutate gate를 지나며, 쓰기 직전 대상 파일을 다시 읽어 편집의 기준 스냅샷과 다르면 거부합니다(확장과 봇이 같은 디렉터리를 동시에 편집해도 안전).
- 커밋은 명시된 경로만 담습니다. `git add .`는 쓰지 않으므로 사용자의 무관한 변경이 쓸려 들어가지 않습니다.
- `.draft/`·`manuscript/`·`.storyboard/cache/`는 생성하되 커밋하지 않습니다(확장의 .gitignore 규칙 그대로). `draft/`는 워크스페이스 `.gitignore`가 정합니다 — 0.8부터 새로 만든 워크스페이스는 추적하므로 초안 저장도 커밋이고, 그 전 워크스페이스는 `.gitignore`의 `draft/` 줄을 지워야 추적됩니다.
- allowlist에 없는 채팅·사용자의 업데이트는 조용히 버립니다.

## 설치와 실행

릴리즈에서 설치하려면 CLI와 같은 한 줄이면 됩니다. 스크립트가 `storyboard`와 `storyboard-bot`을 함께
`~/.local/bin`에 링크하고, 봇의 네이티브 모듈(`better-sqlite3`)도 설치합니다(Node 20+와 npm 필요).

```bash
curl -fsSL https://raw.githubusercontent.com/maroomir/storyboard/main/scripts/install.sh | bash
#   tarball 을 이미 받아 두었다면:  ./install.sh --from ~/Downloads
storyboard-bot setup       # 최초 1회
storyboard-bot             # 실행
```

소스에서 직접 빌드해 쓰려면:

```bash
# 레포 루트에서
npm install
npm run bot:build          # apps/bot/dist/ 번들 생성

# 설정 (최초 1회) — 대화형 마법사
node apps/bot/dist/index.js setup
#   토큰을 getMe 로 검증하고, 허용 chat id 와 워크스페이스 경로를 확인한 뒤
#   ~/.storyboard/bot.json 을 0600 으로 쓰고 테스트 메시지를 보냅니다.
#
# 손으로 쓰려면:
#   mkdir -p ~/.storyboard && cp apps/bot/config.example.json ~/.storyboard/bot.json
#   chmod 600 ~/.storyboard/bot.json   # botToken·allowedChatIds·workspace.path 수정

# 실행
node apps/bot/dist/index.js

# macOS 로그인 시 자동 시작 (launchd)
./apps/bot/scripts/install-launchd.sh
./apps/bot/scripts/install-launchd.sh --uninstall
```

터미널 명령은 네 가지입니다. 인식하지 못하는 인자는 봇을 띄우지 않고 사용법과 함께 거부합니다.

| 명령 | 설명 |
|---|---|
| `storyboard-bot` | 봇 실행 |
| `storyboard-bot setup` | 대화형 설정 마법사 |
| `storyboard-bot doctor` | 설정·워크스페이스·git·프로바이더 점검. 봇이 뜨지 않는 상태에서도 답합니다 |
| `storyboard-bot --help` / `--version` | 사용법과 버전 |

텔레그램의 `/doctor`는 워크스페이스 내용까지 보지만 봇이 떠 있어야 합니다. 설정이 없거나 깨져서
봇 자체가 뜨지 않을 때는 터미널의 `storyboard-bot doctor`를 쓰세요.

`STORYBOARD_HOME` 환경변수로 `~/.storyboard` 위치를 바꿀 수 있습니다.

봇은 설정을 **부팅 때만** 읽으므로, 고친 뒤에는 다시 띄워야 반영됩니다(launchd로 설치했다면
`launchctl kickstart -k gui/$UID/com.maroomir.storyboard.bot`). 설정 파일의 JSON 스키마
(`apps/bot/assets/config.schema.json`)를 에디터에 물리면 자동완성과 오타 검증을 받을 수 있습니다.
스키마는 이 봇의 zod 스키마에서 생성되며 `npm run schema:emit --workspace @storyboard/bot`으로
갱신하고, 어긋나면 봇 테스트가 실패합니다.

## 설정

`~/.storyboard/bot.json` (권장 mode 0600). 전체 예시는 [`config.example.json`](./config.example.json).

| 섹션 | 키 | 기본값 | 설명 |
|---|---|---|---|
| `telegram` | `botToken` | 필수 | BotFather 토큰. 로그·직렬화에 절대 노출되지 않음 |
| | `allowedChatIds` / `allowedUserIds` | `[]` | allowlist. 둘 다 비면 아무도 접근 못 함 |
| `workspace` | `path` | 필수 | Storyboard 워크스페이스 절대 경로(`~` 확장 지원, `.storyboard/project.json` 필요) |
| | `remote` | 없음 | 없으면 로컬 커밋만 하고 `/sync`는 `no-remote`로 정착. 지정하면 저장이 원격까지 나가므로 폰의 git 클라이언트로 초안을 읽을 수 있습니다([모바일에서 읽고 손질하기](#모바일에서-읽고-손질하기)) |
| | `pushDebounceSec` / `syncIntervalSec` | 30 / 300 | 푸시 디바운스·주기 동기화 |
| `privacy` | `minimizeChatBody` | `false` | 켜면 `/read`가 초안 본문을 채팅에 싣지 않고 파일 첨부로만 전달 |
| `jobs` | `heavyConcurrency` / `lightConcurrency` | 1 / 1 | 잡 클래스별 동시 실행 수 |
| `dashboard` | `enabled` / `port` | `true` / 8787 | 루프백 전용 읽기 패널 `http://127.0.0.1:<port>/` |

### AI 설정은 공통 파일에서

프로바이더·모델·태스크 라우팅·검수 옵션은 `bot.json`이 아니라 **`~/.storyboard/config.json`**(익스텐션·CLI와
공유)과 워크스페이스의 `.storyboard/config.json`에서 읽습니다. `storyboard-bot setup`이 고른 기본 프로바이더도
그 파일에 저장됩니다. 키 이름은 익스텐션 설정과 같습니다.

```json
{ "defaultProvider": "codex", "tasks": { "sceneDraft": { "provider": "claude-code" } },
  "providers": { "codex": { "reasoningEffort": "medium" } }, "draft": { "reviseMaxIterations": 2 } }
```

봇은 익스텐션·CLI와 같은 프로바이더를 모두 씁니다. `claude-code` · `codex` · `gemini-cli` 같은 구독 CLI는 각자의 로그인을,
`openai` · `claude` · `google` · `grok` 같은 API 키 프로바이더는 공통 **`~/.storyboard/secrets.json`**(0600)의 키를
씁니다 — 봇은 키를 따로 갖지 않으므로 익스텐션 설정 패널이나 `storyboard apikey set <provider>` 로 넣어 두세요.
키가 없거나 프로바이더가 아예 없으면 생성 작업이 거부됩니다(`/doctor`가 알려 줍니다). 씬
사실 시트 자동 승인(`grounding.autoApprove`)은 공통 설정에 값이 없을 때 봇에서는 켜진 것으로 봅니다 — 대기열
작업은 승인을 물을 수 없기 때문입니다.

예전 `bot.json`의 `providers`/`draft` 블록은 아직 읽히며 공통 설정보다 우선하지만, 부팅 로그에 옮기라는 경고가
납니다.

설정 오류는 조용히 무시되지 않습니다: 오타 난 프로바이더·미지원 필드·범위 밖 값은 부팅 시 명확한 메시지로 거부됩니다.

## 모바일에서 읽고 손질하기

텔레그램은 **제어 채널**입니다 — 생성을 걸고, 상태를 보고, 카드를 손질하는 데 씁니다. 씬 하나의 초안은 수천 자라
텔레그램 메시지 한계(4,096자)를 거의 항상 넘으므로 `/read`는 미리보기와 `.md` 첨부로 끝납니다. 장문 읽기·판본
비교·문단 편집은 채팅이 아니라 **git 클라이언트**의 몫입니다. 봇은 저장마다 커밋하고 `workspace.remote`가 있으면
푸시하므로, 폰에서 같은 remote를 클론하면 코드 한 줄 없이 진짜 리더가 생깁니다.

### 셋업

1. **비공개 remote**를 만듭니다(GitHub·GitLab의 private 저장소, 또는 자체 서버의 bare 저장소). 원고가 통째로
   올라가므로 반드시 비공개여야 합니다.
2. 봇 워크스페이스에서 `git remote add origin <url>` 뒤 한 번 `git push -u origin main` 합니다. `.gitignore`에
   `draft/` 줄이 있으면 초안이 remote에 올라가지 않으니 지우세요(0.8 이후 워크스페이스는 처음부터 없습니다).
3. `~/.storyboard/bot.json`의 `workspace.remote`를 그 remote 이름(`"origin"`)으로 지정하고 봇을 다시 띄웁니다.
4. 텔레그램에서 `/sync` → `✅ 이미 최신입니다.` 또는 `✅ 원격에 반영했습니다.`가 나오면 준비 끝입니다.
   `/status`의 `동기화: clean`으로도 확인됩니다.
5. 폰에서 같은 remote를 클론합니다. "git 클론 + 마크다운 편집"이 되는 앱이면 무엇이든 됩니다 — iOS는 Working Copy나
   Obsidian(git 플러그인), 안드로이드는 MGit이나 Obsidian(git 플러그인)이 그런 예이고, GitHub·GitLab 모바일 앱은
   읽기만 하기에 충분합니다.

이후의 흐름은 이렇습니다.

- 봇이 초안을 저장하면 즉시 로컬 커밋이 되고, `pushDebounceSec`(기본 30초) 안에 다른 저장이 없으면 fetch→rebase→push가
  나갑니다. 폰 앱에서 pull 하면 새 초안이 보입니다.
- 원격에 닿지 못하면(`offline`) 로컬 커밋은 그대로 남고, 다음 저장이나 `syncIntervalSec`(기본 300초) 주기 동기화,
  또는 `/sync`에서 다시 시도합니다.
- 폰에서 커밋·푸시한 변경은 주기 동기화(또는 `/sync`)가 **rebase로 가져와** 봇 워크스페이스에 반영합니다.
  데스크톱에서 편집 중이라 커밋되지 않은 변경이 있으면 rebase를 시작하지 않고 `dirty`로 보고하며 파일은 건드리지
  않습니다.

### 사용 규칙: 읽기는 언제나, 손질은 봇이 놀 때

폰에서 커밋하는 순간 mutate gate 밖의 **두 번째 작성자**가 생깁니다. 봇의 쓰기는 편집을 시작할 때 읽은 스냅샷을
기준으로 쓰기 직전에 다시 검사하므로, 폰 커밋이 먼저 들어오면 봇 쪽 저장은 `changed-on-disk`로 거부되어 작업이
헛돌고, 봇 저장이 먼저면 폰의 푸시가 거부되거나 봇의 다음 동기화가 `conflict`로 멈춥니다. 그래서 규칙은 하나입니다:
**봇이 만든 초안을 읽고, 손질은 `/jobs`가 비어 있을 때** 하세요. 손질한 씬을 다시 `/draft` 하면 봇이 그 파일을
덮어쓰기 전에 `.draft/<stem>/`에 보관하지만, 그 보관본은 커밋되지 않습니다.

### 충돌 복구

같은 파일을 폰과 봇이 각각 커밋하면 봇의 동기화는 **항상 중단**합니다 — rebase를 abort 하고 봇의 로컬 커밋과 폰의
원격 커밋을 둘 다 보존하며, 절대 대신 풀지 않습니다. 이 상태에서 봇은 저장(로컬 커밋)은 계속하지만 푸시는 나가지
않으므로, 폰에는 새 초안이 도착하지 않습니다. 봇은 충돌에 **빠지는 순간** 허용된 모든 chat에 충돌 파일 목록과 함께
한 번 알립니다 — 주기 동기화가 같은 충돌을 다시 만나도 같은 경고를 반복하지는 않으니, 놓쳤다면 `/status`나
`/sync`로 확인하세요.

1. `/sync` — `⚠️ 충돌로 원격 변경을 적용하지 못했습니다: draft/01-prologue.md` 처럼 충돌 파일 목록이 나옵니다.
2. 봇 워크스페이스가 있는 데스크톱에서 직접 풉니다.

   ```bash
   cd <workspace.path>
   git rebase origin/main        # 충돌 파일을 편집해 정리
   git add <충돌 파일>
   git rebase --continue
   ```

   rebase가 진행 중인 동안 봇의 저장은 `rebase-in-progress`로 거부되고 주기 동기화는 `error`(detached HEAD)로
   보고합니다 — 정상이며, 마치면 사라집니다.
3. 다시 `/sync`(또는 다음 주기 동기화). 봇은 재시작 없이 `✅ 원격에 반영했습니다.`로 돌아오고 `/status`가 `clean`이
   됩니다.

### 폰에서 하지 않는 것

- **`.storyboard/memory/`** — 이야기 상태·인물 기억·장 요약은 엔진이 소유하며 생성이 다시 씁니다. 폰에서 고치면 다음
  생성에서 충돌하거나 덮입니다.
- **`scene/`·`character/`·`background/`·`narrator/` 카드의 구조 필드** — 카드는 canonical 재직렬화 대상이라 키 순서·
  시퀀스 표기가 봇의 첫 쓰기에서 통째로 바뀌고, 그 diff가 폰 편집과 겹치면 충돌이 됩니다. 씬 요약은 `scene/<stem>.summary.md`,
  카드 필드는 `/set`·`/scene edit`로 하세요.
- `draft/`를 폰에서 삭제하거나 이름을 바꾸는 것 — 봇은 씬 stem으로 초안을 찾습니다.

## 명령

| 명령 | 설명 |
|---|---|
| `/start` · `/help` | 소개와 전체 명령 안내 |
| `/cards` · `/show <id>` · `/scenes` · `/bible` · `/status` | 조회 |
| `/read <씬 stem>` | 초안 열람 — 장문은 미리보기+Markdown 첨부, 인자 없이 부르면 버튼 선택. `privacy.minimizeChatBody`가 켜져 있으면 본문 없이 첨부만 |
| `/rename <id> <새 이름>` · `/set <id> <항목> <값1> \| <값2>` | 카드 편집(저장=커밋) |
| `/scene new <slug>` · `/scene edit·append <씬 stem>` | 씬 카드 생성·요약 교체·덧붙이기(본문은 다음 줄부터, 구조 필드는 보존). 요약은 `scene/<stem>.summary.md`에 두고 카드에는 파일명만 남깁니다 |
| `/scene show <씬 stem>` | 그 씬에 적용될 시점(서술자)과 연속성 줄기 |
| `/scene beats <씬 stem> [force]` | 씬 카드의 사건 비트를 전개해 `beats`에 커밋(light 작업). 이미 비트가 있으면 `force`를 붙여야 다시 뽑습니다. `/draft`도 비트가 없으면 먼저 뽑습니다(`draft.autoBeats`) |
| `/narrator` · `/narrator add <id> <인칭> <지식 경계> [초점]` | 서술자 카드 조회·생성 (`narrator/` 는 tracked 이므로 생성도 커밋) |
| `/draft <씬 stem>` | 씬 초안 생성(확장과 동일한 파이프라인 + 검토→수정 루프). `/draft all`은 초안 없는 씬만 일괄 큐잉(기존 초안 재생성 안 함) |
| `/review <씬 stem>` | 기존 초안을 재생성 없이 검수·수정(공유 review→revise 루프) |
| `/outline` · `/plan` · `/manuscript` | 시놉시스·챕터 계획·원고 조립 |
| `/jobs` · `/log <번호>` · `/stop <번호>` | 작업 목록·단계 이력·취소(실행 중 CLI 프로세스까지 중단) |
| `/usage` | 24시간·7일·30일 토큰·비용 사용량 |
| `/sync` | 원격 동기화(fetch→rebase→push, 충돌 시 자동 중단·보고) |
| `/doctor` | 워크스페이스·git·원격·프로바이더 CLI·설정 권한·작업 적체 점검. `/doctor init` 저장소 초기화, `/doctor format` 카드 서식 정규화, `/doctor migrate` 구형 `scene/*.txt` → `scene/*.card` 변환 |

## 카드 서식

카드 직렬화는 표준형(고정된 키 순서, 블록 리스트)입니다. 손이나 에이전트가 쓴 카드가 `tags: [a, b]` 같은 인라인 표기나 다른 키 순서를 쓰고 있으면, 첫 편집 때 그 서식 변경이 내용 변경과 한 diff에 섞입니다. 내용이 손상되지는 않지만 이력이 지저분해집니다.

`/doctor`가 그런 카드를 미리 알려주고, `/doctor format`이 **커밋 하나로** 일괄 정규화합니다. 정규화 이후의 편집은 바뀐 줄만 diff에 남습니다. 확장에서 저장해도 같은 표준형이 되므로 두 앱의 결과는 동일합니다.

## 검증

```bash
npm test --workspace @storyboard/bot
npm run lint --workspace @storyboard/bot
npm run bot:build
```

sync·mutate 테스트는 임시 디렉터리에 실제 git 저장소를 만들어 돌립니다 — 스텁으로 대체하지 마세요.
