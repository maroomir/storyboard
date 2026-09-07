# storyboard-bot

Storyboard 워크스페이스를 텔레그램에서 조회·편집·생성하는 독립 앱입니다. 워크스페이스 디렉터리를 **직접** 편집합니다 — 복제본도, 별도 저장소도 없습니다. 같은 워크스페이스를 VSCode 확장이나 CLI로 동시에 열어도 안전합니다. 사용자 머신에서 long polling으로만 동작하며 인바운드 포트를 열지 않습니다.

## 동작 원칙

- 추적 파일 저장은 항상 커밋입니다. 모든 쓰기는 mutate gate를 지나며, 쓰기 직전 대상 파일을 다시 읽어 편집의 기준 스냅샷과 다르면 거부합니다(확장과 봇이 같은 디렉터리를 동시에 편집해도 안전).
- 커밋은 명시된 경로만 담습니다. `git add .`는 쓰지 않으므로 사용자의 무관한 변경이 쓸려 들어가지 않습니다.
- `draft/`·`.draft/`·`manuscript/`·`.storyboard/cache/`는 생성하되 커밋하지 않습니다(확장의 .gitignore 규칙 그대로).
- allowlist에 없는 채팅·사용자의 업데이트는 조용히 버립니다.

## 설치와 실행

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
| | `remote` | 없음 | 없으면 로컬 커밋만 하고 `/sync`는 `no-remote`로 정착 |
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

## 명령

| 명령 | 설명 |
|---|---|
| `/start` · `/help` | 소개와 전체 명령 안내 |
| `/cards` · `/show <id>` · `/scenes` · `/bible` · `/status` | 조회 |
| `/read <씬 stem>` | 초안 열람 — 장문은 미리보기+Markdown 첨부, 인자 없이 부르면 버튼 선택. `privacy.minimizeChatBody`가 켜져 있으면 본문 없이 첨부만 |
| `/rename <id> <새 이름>` · `/set <id> <항목> <값1> \| <값2>` | 카드 편집(저장=커밋) |
| `/scene new <slug>` · `/scene edit·append <씬 stem>` | 씬 카드 생성·요약 교체·덧붙이기(본문은 다음 줄부터, 구조 필드는 보존). 요약은 `scene/<stem>.summary.md`에 두고 카드에는 파일명만 남깁니다 |
| `/scene beats <씬 stem> [force]` | 씬 카드의 사건 비트를 전개해 `beats`에 커밋(light 작업). 이미 비트가 있으면 `force`를 붙여야 다시 뽑습니다. `/draft`도 비트가 없으면 먼저 뽑습니다(`draft.autoBeats`) |
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
