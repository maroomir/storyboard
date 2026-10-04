# Storyboard

English: [`README.en.md`](README.en.md)

Storyboard는 장편 소설 한 권을 **검증 가능한 작은 단계**로 나누어 쓰는 도구입니다. 작품 계약(장르·독자·
시점·분량)에서 시작해 인물·배경 카드, 시놉시스와 장 계획, 씬 시드, 씬별 초안, 검수와 재작성, 원고
조립까지 이어지고, 모든 단계가 작품 저장소 안의 파일로 남아 되돌리고 다시 돌릴 수 있습니다. 거대한
프롬프트 한 번이 아니라, 이전 본문·정전(canon)·이야기 상태 원장을 주입받는 씬 단위 생성이 핵심입니다.

세 앱이 같은 엔진을 씁니다. 작품 저장소는 git 저장소이고, AI 키는 사용자 본인의 것(`~/.storyboard/secrets.json`)입니다.


| 앱                    | 이런 분께                    | 특징                         |
| -------------------- | ------------------------ | -------------------------- |
| **CLI** `storyboard` | 터미널에 익숙한 사용자, AI 에이전트    | 레퍼런스 구현. 모든 기능을 명령 한 줄로 실행 |
| **VS Code 확장**       | 에디터에서 카드·씬·초안을 다루고 싶은 작가 | 카드 편집기, 초안 진단, 스튜디오 패널     |
| **데스크톱 앱**           | 개발 도구 없이 쓰고 싶은 작가        | 원고 책상, 실행 서랍, 자동 버전 기록     |


## 설치

**CLI** — Node 20 이상이 필요합니다.

```bash
curl -fsSL https://raw.githubusercontent.com/maroomir/storyboard/main/scripts/install.sh | bash
```

**VS Code 확장** — [최신 릴리즈](https://github.com/maroomir/storyboard/releases/latest)에서 `.vsix`를 받아 설치합니다.

```bash
code --install-extension storyboard-vscode-*.vsix
```

**데스크톱 앱** — [최신 릴리즈](https://github.com/maroomir/storyboard/releases/latest)에서 macOS는 `.dmg`, Windows는 `-setup.exe`를 받아 실행합니다.

## 한 사이클

```bash
storyboard init --title "밤의 항해" --genre 미스터리 --pov third-limited --target-words 300000
storyboard setup                      # 프로바이더와 키 (claude, openai, google, grok, ollama)
storyboard outline generate           # 계약 → 시놉시스·장 계획
storyboard scene seed                 # 장 계획 → scene/*.card
storyboard scene plot --all           # 씬마다 사건 비트
storyboard draft generate 01-prologue # 뼈대 → 대사 → 구간 확장 → 기계 검증 → 검수·재작성
storyboard draft check continuity 01-prologue
storyboard manuscript assemble        # draft/*.md → 원고
```

`storyboard novel generate`는 이 전체를 승인 없이 한 번에 돌립니다. 예산 상한(`budget.run.limitUsd`)에
닿으면 진행 중인 씬까지 마치고 멈추며, 다시 실행하면 이어서 갑니다. 새 작품에는 `AGENTS.md`가 함께
생겨 Claude Code 같은 에이전트가 본문을 직접 쓰지 않고 이 명령들을 거치게 합니다.

## 저장소 구조

npm workspaces 모노레포입니다. 패키지는 빌드 없이 TypeScript 소스를 그대로 노출하고, 앱이 번들합니다.


| 워크스페이스                                            | 이름                         | 역할                                                |
| ------------------------------------------------- | -------------------------- | ------------------------------------------------- |
| [`apps/vscode`](apps/vscode/)                     | `storyboard-vscode`        | VSCode 확장 — 소설 저작 IDE                             |
| [`apps/cli`](apps/cli/)                           | `@storyboard/cli`          | CLI(`storyboard`) — 헤드라인 제품이자 레퍼런스 구현             |
| [`apps/desktop`](apps/desktop/)                   | `@storyboard/desktop`      | 작가용 데스크톱 앱(Electron, macOS Apple Silicon·Windows) |
| [`packages/story-app`](packages/story-app/)       | `@storyboard/story-app`    | 세 앱이 공유하는 컴포지션 루트와 매니저 파사드                        |
| [`packages/story-engine`](packages/story-engine/) | `@storyboard/story-engine` | 런타임 무관 코어: 유즈케이스·저장 계층·호스트 포트·씬/장편 파이프라인          |
| [`packages/story-model`](packages/story-model/)   | `@storyboard/story-model`  | 파일 포맷(스키마·코덱·경로 규약·공유 픽스처)·계약·도메인 정책              |
| [`packages/story-ai`](packages/story-ai/)         | `@storyboard/story-ai`     | AI 엔진: 프로바이더 레지스트리·프롬프트 카탈로그·포트                   |
| [`packages/story-config`](packages/story-config/) | `@storyboard/story-config` | 공용 홈(`~/.storyboard`): 설정 계층·시크릿 파일·변경 감시         |
| [`packages/story-node`](packages/story-node/)     | `@storyboard/story-node`   | Node 호스트 어댑터: 파일 시스템·워크스페이스 로케이터                  |
| [`packages/story-sim`](packages/story-sim/)       | `@storyboard/story-sim`    | 품질·비용 측정: 손잡이 스윕·독자 패널·파레토 리포트                    |


## 개발

```bash
npm ci            # 루트에서 전체 워크스페이스 설치
npm run lint      # 아키텍처 검사·eslint·tsc·prettier (전 워크스페이스)
npm test          # 세 앱 테스트 — API 키 없이 mock 프로바이더로 돈다
npm run build     # 확장·CLI·데스크톱 번들
npm run package:vsix   # 확장 VSIX 패키징 (apps/vscode/에 생성)
npm run cli:build      # CLI 번들 빌드 (apps/cli/dist/)
npm run desktop:dev    # 데스크톱 앱 개발 실행
```

사용법은 [확장](apps/vscode/README.md)·[CLI](apps/cli/README.md)·[데스크톱](apps/desktop/README.md) README, 작품
저장소의 구조와 파일 형식은 [`ARCHITECTURE.md`](ARCHITECTURE.md), 릴리스 절차는 [`RELEASE.md`](RELEASE.md)를
참고하세요.

## 기여

Storyboard는 더 많은 작가가 쓰고, 쓰는 사람들이 함께 키우는 도구를 지향합니다. 버그 수정은 물론
기능을 바꾸거나 새로 더하는 PR도 적극적으로 받습니다 — 새 프로바이더, 파이프라인 단계, 화면 개선 모두
환영합니다. 써 보고 불편했던 점이나 원하는 기능을 이슈로 남겨 주는 것도 큰 기여입니다. 큰 변경은 이슈로
방향을 먼저 맞추면 더 빨리 들어갑니다.

시작은 [`CONTRIBUTING.md`](CONTRIBUTING.md)와 `good first issue`·`help wanted` 라벨에서 하세요. AI
에이전트로 작성한 기여도 받습니다. 보안 문제는 [`SECURITY.md`](SECURITY.md)를 따릅니다.

## 라이선스

Apache License 2.0 — [`LICENSE`](LICENSE)