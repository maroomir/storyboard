# storygram

Storyboard 워크스페이스를 텔레그램에서 조회·편집·생성하는 동반 봇입니다. VSCode 확장이 여는 **바로 그 git 워크스페이스**를 편집합니다 — 복제본도, 별도 저장소도 없습니다. 사용자 머신에서 long polling으로만 동작하며 인바운드 포트를 열지 않습니다.

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

# 설정 (최초 1회)
mkdir -p ~/.storygram
cp apps/bot/config.example.json ~/.storygram/config.json
chmod 600 ~/.storygram/config.json
# botToken·allowedChatIds·workspace.path를 실제 값으로 수정
# — 또는 VSCode 확장의 `Storyboard: 텔레그램 봇 설정…` 명령이 이 단계를 대신합니다
#   (토큰 getMe 검증, 워크스페이스 자동 기입, 0600 저장, macOS launchd 설치 안내 포함)

# 실행
node apps/bot/dist/index.js

# macOS 로그인 시 자동 시작 (launchd)
./apps/bot/scripts/install-launchd.sh
./apps/bot/scripts/install-launchd.sh --uninstall
```

`STORYGRAM_HOME` 환경변수로 `~/.storygram` 위치를 바꿀 수 있습니다.

설정을 나중에 고칠 때는 확장의 `Storyboard: 텔레그램 봇 설정 파일 열기`가 편합니다 — 확장이 이 설정의
JSON 스키마를 기여하므로 에디터에서 자동완성·오타 검증을 받습니다. 봇은 설정을 **부팅 때만** 읽으므로
편집 후 `Storyboard: 텔레그램 봇 재시작`(launchd)으로 반영합니다. 스키마 파일
(`apps/desktop/assets/storygram-config.schema.json`)은 이 봇의 zod 스키마에서 생성되며
`npm run schema:emit --workspace storygram`으로 갱신하고, 어긋나면 봇 테스트가 실패합니다.

## 설정

`~/.storygram/config.json` (권장 mode 0600). 전체 예시는 [`config.example.json`](./config.example.json).

| 섹션 | 키 | 기본값 | 설명 |
|---|---|---|---|
| `telegram` | `botToken` | 필수 | BotFather 토큰. 로그·직렬화에 절대 노출되지 않음 |
| | `allowedChatIds` / `allowedUserIds` | `[]` | allowlist. 둘 다 비면 아무도 접근 못 함 |
| `workspace` | `path` | 필수 | Storyboard 워크스페이스 절대 경로(`~` 확장 지원, `.storyboard/project.json` 필요) |
| | `remote` | 없음 | 없으면 로컬 커밋만 하고 `/sync`는 `no-remote`로 정착 |
| | `pushDebounceSec` / `syncIntervalSec` | 30 / 300 | 푸시 디바운스·주기 동기화 |
| `providers` | `default` | `mock` | CLI 전용: `mock` · `claude-code` · `codex` |
| | `tasks` | `{}` | 태스크별 프로바이더(문자열 또는 `{provider, model}`) |
| | `models.<id>` | — | `model` · `command` · `timeoutMs` · `reasoningEffort`(codex) |
| `draft` | `reviseAfterGenerate` | `true` | 생성 직후 공유 검토→수정 루프 실행 여부 |
| | `reviseMaxIterations` | `2` | 수정 반복 상한(1~5) |
| `privacy` | `minimizeChatBody` | `false` | 켜면 `/read`가 초안 본문을 채팅에 싣지 않고 파일 첨부로만 전달 |
| `jobs` | `heavyConcurrency` / `lightConcurrency` | 1 / 1 | 잡 클래스별 동시 실행 수 |
| `dashboard` | `enabled` / `port` | `true` / 8787 | 루프백 전용 읽기 패널 `http://127.0.0.1:<port>/` |

설정 오류는 조용히 무시되지 않습니다: 오타 난 프로바이더·미지원 필드·범위 밖 값은 부팅 시 명확한 메시지로 거부됩니다.

## 명령

| 명령 | 설명 |
|---|---|
| `/start` | 소개와 전체 명령 안내 |
| `/cards` · `/show <id>` · `/scenes` · `/bible` · `/status` | 조회 |
| `/read <씬 stem>` | 초안 열람 — 장문은 미리보기+Markdown 첨부, 인자 없이 부르면 버튼 선택. `privacy.minimizeChatBody`가 켜져 있으면 본문 없이 첨부만 |
| `/rename <id> <새 이름>` · `/set <id> <항목> <값1> \| <값2>` | 카드 편집(저장=커밋) |
| `/scene new <slug>` · `/scene edit·append <씬 stem>` | 씬 시드 생성·본문 교체·덧붙이기(본문은 다음 줄부터, frontmatter 보존) |
| `/draft <씬 stem>` | 씬 초안 생성(확장과 동일한 파이프라인 + 검토→수정 루프) |
| `/outline` · `/plan` · `/manuscript` | 시놉시스·챕터 계획·원고 조립 |
| `/jobs` · `/stop <번호>` | 작업 목록·취소(실행 중 CLI 프로세스까지 중단) |
| `/sync` | 원격 동기화(fetch→rebase→push, 충돌 시 자동 중단·보고) |
| `/doctor` | 워크스페이스·git·원격·프로바이더 CLI·설정 권한·작업 적체 점검. `/doctor init` 저장소 초기화, `/doctor format` 카드 서식 정규화 |

## 카드 서식

카드 직렬화는 표준형(고정된 키 순서, 블록 리스트)입니다. 손이나 에이전트가 쓴 카드가 `tags: [a, b]` 같은 인라인 표기나 다른 키 순서를 쓰고 있으면, 첫 편집 때 그 서식 변경이 내용 변경과 한 diff에 섞입니다. 내용이 손상되지는 않지만 이력이 지저분해집니다.

`/doctor`가 그런 카드를 미리 알려주고, `/doctor format`이 **커밋 하나로** 일괄 정규화합니다. 정규화 이후의 편집은 바뀐 줄만 diff에 남습니다. 확장에서 저장해도 같은 표준형이 되므로 두 앱의 결과는 동일합니다.

## 검증

```bash
npm test --workspace storygram
npm run lint --workspace storygram
npm run bot:build
```

sync·mutate 테스트는 임시 디렉터리에 실제 git 저장소를 만들어 돌립니다 — 스텁으로 대체하지 마세요.
