# storyboard monorepo

한 시스템(스토리 저작)의 세 프론트엔드와, 셋이 공유하는 패키지들을 담은 npm workspaces 모노레포입니다.

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

## 시작하기

```bash
npm ci            # 루트에서 전체 워크스페이스 설치
npm test          # 세 앱 테스트
npm run lint      # 세 앱 린트 (아키텍처 검사 포함)
npm run package:vsix   # 확장 VSIX 패키징 (apps/vscode/에 생성)
npm run cli:build      # CLI 번들 빌드 (apps/cli/dist/)
npm run desktop:dev    # 데스크톱 앱 개발 실행
```

사용법은 [확장](apps/vscode/README.md)·[CLI](apps/cli/README.md)·[데스크톱](apps/desktop/README.md) README, 제품 아키텍처는
[`ARCHITECTURE.md`](ARCHITECTURE.md), 릴리스 절차는 [`RELEASE.md`](RELEASE.md)를 참고하세요.
