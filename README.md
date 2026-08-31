# storyboard monorepo

한 시스템(스토리 저작)의 두 프론트엔드와, 둘이 공유하는 패키지들을 담은 npm workspaces 모노레포입니다.

| 워크스페이스                                          | 이름                         | 역할                                                                      |
| ----------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| [`apps/desktop`](apps/desktop/)                       | `storyboard-vscode`          | VSCode 확장 — 소설 저작 IDE. 릴리스 버전과 `v*` 태그는 여기만 사용합니다. |
| [`apps/bot`](apps/bot/)                               | `@storyboard/bot`            | Telegram 봇 — 확장이 여는 **같은** git 워크스페이스를 편집합니다.         |
| [`packages/story-engine`](packages/story-engine/)     | `@storyboard/story-engine`   | 런타임 무관 코어: 도메인 정책·파일 레코드·세 앱이 공유하는 계약           |
| [`packages/story-format`](packages/story-format/)     | `@storyboard/story-format`   | 워크스페이스 파일 포맷: 스키마·코덱·경로 규약·공유 픽스처                 |
| [`packages/story-ai`](packages/story-ai/)             | `@storyboard/story-ai`       | AI 엔진: 프로바이더 레지스트리·프롬프트 카탈로그·계약 타입·포트           |
| [`packages/story-pipeline`](packages/story-pipeline/) | `@storyboard/story-pipeline` | 씬 생성 단계 오케스트레이션                                               |
| [`packages/story-git`](packages/story-git/)           | `@storyboard/story-git`      | 커밋·동기화 계층 (저장 성공 = 커밋)                                       |

## 시작하기

```bash
npm ci            # 루트에서 전체 워크스페이스 설치
npm test          # desktop + bot 테스트
npm run lint      # desktop + bot 린트 (아키텍처 검사 포함)
npm run package:vsix   # 확장 VSIX 패키징 (apps/desktop/에 생성)
npm run bot:build      # 봇 번들 빌드 (apps/bot/dist/)
```

확장 사용법은 [`apps/desktop/README.md`](apps/desktop/README.md), 제품 아키텍처는
[`ARCHITECTURE.md`](ARCHITECTURE.md), 릴리스 절차는 [`RELEASE.md`](RELEASE.md)를 참고하세요.
