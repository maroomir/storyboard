# storyboard monorepo

한 시스템(스토리 저작)의 두 프론트엔드와, 둘이 공유하는 패키지들을 담은 npm workspaces 모노레포입니다.

| 워크스페이스                                          | 이름                         | 역할                                                                      |
| ----------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| [`apps/vscode`](apps/vscode/)                       | `storyboard-vscode`          | VSCode 확장 — 소설 저작 IDE. 릴리스 버전과 `v*` 태그는 여기만 사용합니다. |
| [`apps/cli`](apps/cli/)                               | `@storyboard/cli`            | CLI(`storyboard`) — 헤드라인 제품이자 레퍼런스 구현                       |
| [`packages/story-engine`](packages/story-engine/)     | `@storyboard/story-engine`   | 런타임 무관 코어: 도메인 정책·유즈케이스·저장 계층·두 앱이 공유하는 계약  |
| [`packages/story-format`](packages/story-format/)     | `@storyboard/story-format`   | 워크스페이스 파일 포맷: 스키마·코덱·경로 규약·공유 픽스처                 |
| [`packages/story-ai`](packages/story-ai/)             | `@storyboard/story-ai`       | AI 엔진: 프로바이더 레지스트리·프롬프트 카탈로그·계약 타입·포트           |
| [`packages/story-pipeline`](packages/story-pipeline/) | `@storyboard/story-pipeline` | 씬 생성 단계 오케스트레이션                                               |
| [`packages/story-config`](packages/story-config/)     | `@storyboard/story-config`   | 공용 홈(`~/.storyboard`): 설정 계층·시크릿 파일·변경 감시                 |

## 시작하기

```bash
npm ci            # 루트에서 전체 워크스페이스 설치
npm test          # 두 앱 테스트
npm run lint      # 두 앱 린트 (아키텍처 검사 포함)
npm run package:vsix   # 확장 VSIX 패키징 (apps/vscode/에 생성)
npm run cli:build      # CLI 번들 빌드 (apps/cli/dist/)
```

확장 사용법은 [`apps/vscode/README.md`](apps/vscode/README.md), 제품 아키텍처는
[`ARCHITECTURE.md`](ARCHITECTURE.md), 릴리스 절차는 [`RELEASE.md`](RELEASE.md)를 참고하세요.
