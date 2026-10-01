# Storyboard

English: [`README.en.md`](README.en.md)

Storyboard는 장편 소설 한 권을 **검증 가능한 작은 단계**로 나누어 쓰는 도구입니다. 작품 계약(장르·독자·
시점·분량)에서 시작해 인물·배경 카드, 시놉시스와 장 계획, 씬 시드, 씬별 초안, 검수와 재작성, 원고
조립까지 이어지고, 모든 단계가 작품 저장소 안의 파일로 남아 되돌리고 다시 돌릴 수 있습니다. 거대한
프롬프트 한 번이 아니라, 이전 본문·정전(canon)·이야기 상태 원장을 주입받는 씬 단위 생성이 핵심입니다.

세 앱이 같은 엔진을 씁니다. 작품 저장소는 git 저장소이고, AI 키는 사용자 본인의 것(`~/.storyboard/secrets.json`)입니다.

| 앱 | 누구를 위한 것 | 설치 |
|---|---|---|
| **CLI** `storyboard` | 터미널 사용자와 **Storyboard를 운전하는 AI 에이전트**. 레퍼런스 구현 | `curl -fsSL https://raw.githubusercontent.com/maroomir/storyboard/main/scripts/install.sh \| bash` |
| **VS Code 확장** | 카드·씬·초안을 에디터에서 다루는 작가 | [릴리즈](https://github.com/maroomir/storyboard/releases/latest)의 `.vsix` |
| **데스크톱 앱** | 개발 도구가 없는 작가. 원고 책상 + 실행 서랍 + 자동 버전 기록 | [릴리즈](https://github.com/maroomir/storyboard/releases/latest)의 `.dmg` / `-setup.exe` |

## 한 사이클

```bash
storyboard init --title "밤의 항해" --genre 미스터리 --pov third-limited --target-words 300000
storyboard setup                      # 프로바이더와 키 (claude, openai, google, grok, ollama)
storyboard outline generate           # 계약 → 시놉시스·장 계획
storyboard scene seeds                # 장 계획 → scene/*.card
storyboard scene beats --all          # 씬마다 사건 비트
storyboard scene generate 01-prologue # 뼈대 → 대사 → 구간 확장 → 기계 검증 → 검수·재작성
storyboard check continuity 01-prologue
storyboard manuscript assemble        # draft/*.md → 원고
```

`storyboard novel generate`는 이 전체를 승인 없이 한 번에 돌립니다. 예산 상한(`budget.run.limitUsd`)에
닿으면 진행 중인 씬까지 마치고 멈추며, 다시 실행하면 이어서 갑니다. 새 작품에는 `AGENTS.md`가 함께
생겨 Claude Code 같은 에이전트가 본문을 직접 쓰지 않고 이 명령들을 거치게 합니다.

## 저장소 구조

npm workspaces 모노레포입니다. 패키지는 빌드 없이 TypeScript 소스를 그대로 노출하고, 앱이 번들합니다.

| 워크스페이스                                          | 이름                         | 역할                                                                      |
| ----------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| [`apps/vscode`](apps/vscode/)                         | `storyboard-vscode`          | VSCode 확장 — 소설 저작 IDE                                              |
| [`apps/cli`](apps/cli/)                               | `@storyboard/cli`            | CLI(`storyboard`) — 헤드라인 제품이자 레퍼런스 구현                       |
| [`apps/desktop`](apps/desktop/)                       | `@storyboard/desktop`        | 작가용 데스크톱 앱(Electron, macOS Apple Silicon·Windows)                |
| [`packages/story-app`](packages/story-app/)           | `@storyboard/story-app`      | 세 앱이 공유하는 컴포지션 루트와 매니저 파사드                            |
| [`packages/story-engine`](packages/story-engine/)     | `@storyboard/story-engine`   | 런타임 무관 코어: 도메인 정책·유즈케이스·저장 계층·앱들이 공유하는 계약   |
| [`packages/story-format`](packages/story-format/)     | `@storyboard/story-format`   | 워크스페이스 파일 포맷: 스키마·코덱·경로 규약·공유 픽스처                 |
| [`packages/story-ai`](packages/story-ai/)             | `@storyboard/story-ai`       | AI 엔진: 프로바이더 레지스트리·프롬프트 카탈로그·계약 타입·포트           |
| [`packages/story-pipeline`](packages/story-pipeline/) | `@storyboard/story-pipeline` | 씬 생성 단계 오케스트레이션                                               |
| [`packages/story-config`](packages/story-config/)     | `@storyboard/story-config`   | 공용 홈(`~/.storyboard`): 설정 계층·시크릿 파일·변경 감시                 |
| [`packages/story-node`](packages/story-node/)         | `@storyboard/story-node`     | Node 호스트 어댑터: 파일 시스템·워크스페이스 로케이터                     |
| [`packages/story-sim`](packages/story-sim/)           | `@storyboard/story-sim`      | 품질·비용 측정: 손잡이 스윕·독자 패널·파레토 리포트                       |

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

이 도구는 메인테이너 한 사람이 자기 작품을 쓰려고 만들고 있습니다. 이슈와 PR은 환영하고 되도록 며칠
안에 답하지만, 응답 시한을 약속하지는 않습니다. 시작은 [`CONTRIBUTING.md`](CONTRIBUTING.md)와
`good first issue` 라벨에서 하세요. AI 에이전트로 작성한 기여도 받습니다. 보안 문제는
[`SECURITY.md`](SECURITY.md)를 따릅니다.

## 라이선스

Apache License 2.0 — [`LICENSE`](LICENSE)
