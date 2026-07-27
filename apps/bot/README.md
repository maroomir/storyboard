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

# 실행
node apps/bot/dist/index.js

# macOS 로그인 시 자동 시작 (launchd)
./apps/bot/scripts/install-launchd.sh
./apps/bot/scripts/install-launchd.sh --uninstall
```

`STORYGRAM_HOME` 환경변수로 `~/.storygram` 위치를 바꿀 수 있습니다.

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
| `jobs` | `heavyConcurrency` / `lightConcurrency` | 1 / 1 | 잡 클래스별 동시 실행 수 |
| `dashboard` | `enabled` / `port` | `true` / 8787 | 루프백 전용 읽기 패널 `http://127.0.0.1:<port>/` |

설정 오류는 조용히 무시되지 않습니다: 오타 난 프로바이더·미지원 필드·범위 밖 값은 부팅 시 명확한 메시지로 거부됩니다.

## 명령

| 명령 | 설명 |
|---|---|
| `/start` | 소개와 전체 명령 안내 |
| `/cards` · `/show <id>` · `/scenes` · `/bible` · `/status` | 조회 |
| `/rename <id> <새 이름>` · `/set <id> <항목> <값1> \| <값2>` | 카드 편집(저장=커밋) |
| `/draft <씬 stem>` | 씬 초안 생성(확장과 동일한 파이프라인 + 검토→수정 루프) |
| `/outline` · `/plan` · `/manuscript` | 시놉시스·챕터 계획·원고 조립 |
| `/jobs` · `/stop <번호>` | 작업 목록·취소(실행 중 CLI 프로세스까지 중단) |
| `/sync` | 원격 동기화(fetch→rebase→push, 충돌 시 자동 중단·보고) |
| `/doctor` | 워크스페이스·git 점검, `/doctor init`으로 저장소 초기화 |

## 검증

```bash
npm test --workspace storygram
npm run lint --workspace storygram
npm run bot:build
```

sync·mutate 테스트는 임시 디렉터리에 실제 git 저장소를 만들어 돌립니다 — 스텁으로 대체하지 마세요.
