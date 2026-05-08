# 변경 내역

Storyboard의 주요 변경 사항을 한국어로 함께 기록합니다.

이 문서는 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) 형식을 따르며,
첫 공개 릴리스 이후에는 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)을 따릅니다.

영문 변경 내역은 [CHANGELOG.md](CHANGELOG.md)를 참고하세요.

## [Unreleased]

### Documentation

- `README.md`와 `doc/plan.md`에 한국어 변경 내역 링크와 릴리스 노트 동기화 안내를 추가했습니다.

## [0.1.1] - 2026-05-09

### Added

- 점진적 UI 업데이트를 위한 AI 스트리밍 RPC(`ai.generateStream`)와 청크 이벤트(`ai.generateStream.chunk`)를 추가했습니다. 네이티브 스트리밍을 지원하지 않는 provider는 registry를 통해 단일 응답 생성으로 fallback합니다.
- scene draft 생성 중 긴 `previousContext`를 선택적으로 줄이기 위한 `storyboard.ai.contextCondenseEnabled` 설정을 추가했습니다.

### Changed

- Prompt variant 선택이 provider 전용 routing 대신 task, model, token budget(`xs` / `generic` / `rich`)을 함께 고려하도록 변경했습니다.
- `rich` variant가 선택되면 persona dialogue와 genre formatting 등 장문 prompt가 더 풍부한 지시문을 사용하도록 변경했습니다.

## [0.1.0] - 2026-05-09

### Changed

- 문서: `doc/plan.md`, `doc/concept.md`, `doc/decisions/01-project-initialization.md`, `doc/testing/extension-qa.md`, `README.md`를 release policy에 맞게 정렬했습니다 — `.picktion` import 없음, extension UI i18n은 **`ko` 기본**, **`en` 선택**, 첫 Marketplace 목표는 **0.1.0**(Phase 7–8).
- 문서: `doc/plan.md`에서 Phase 7이 publish 전 LICENSE, privacy, Marketplace metadata를 담당하도록 하고, Phase 8을 `vsce publish` 직전 최종 QA gate로 정리했습니다.

### Added

- tag 기반 VSIX packaging과 checksum asset을 생성하는 GitHub Release workflow를 추가했습니다.
- `@vscode/vsce` 기반 로컬 `npm run package:vsix` script를 추가했습니다.
- 기본 provider, provider별 curated model, task별 provider override, Ollama base URL, API key(SecretStorage), connection check를 관리하는 settings webview panel(`Storyboard: Open Settings`)을 추가했습니다. settings RPC와 `settings.changed` sync도 포함됩니다.
- cache metadata와 새 draft 생성 시 선택적 trait update를 포함하는 scene-to-draft generation pipeline을 추가했습니다(Phase 4).
- tree, status badge, in-view action을 제공하는 Scenes sidebar webview를 추가했습니다(Phase 5).
- Character relation graph panel(d3-force)과 `Storyboard: Open Character Relation Graph` command를 추가했습니다(Phase 5).
- draft가 있는 경우 `scene/*.txt`에서 generate/regenerate draft와 apply format을 실행할 수 있는 CodeLens를 추가했습니다(Phase 5).
- `draft/*.md`에서 re-generate, grammar check, expand를 실행할 수 있는 CodeLens를 추가했습니다. grammar/expand는 Phase 6 placeholder notice를 표시합니다(Phase 5).
- 0.0.1 dogfooding을 위한 manual MVP QA guide를 `doc/testing/extension-qa.md`에 추가했습니다(Phase 5).
- Storyboard VSCode extension의 repository baseline을 수립했습니다.
- 초기 TypeScript 및 esbuild extension-host scaffold를 추가했습니다.
- `storyboard.helloWorld` sanity-check command를 추가했습니다.
- F5 extension debugging을 위한 VSCode launch/tasks 설정을 추가했습니다.
- ESLint 및 Prettier baseline 설정을 추가했습니다.
- Storyboard workspace 구조를 생성하는 `storyboard.init` command를 추가했습니다.
- `.storyboard/project.json`의 project metadata validation을 추가했습니다.
- extension-host workspace, path convention, logger module을 추가했습니다.
- Storyboard Activity Bar container와 sidebar placeholder view를 추가했습니다.
- 최소 Vite 및 React webview UI build를 추가했습니다.
- `.card` YAML schema, round-trip test, Storyboard card custom editor를 추가했습니다.
- file watching과 card opening을 지원하는 Characters 및 Backgrounds sidebar view를 추가했습니다.
- sidebar에서 character/background card를 생성하는 command를 추가했습니다.
- `mock`을 기본 provider로 사용하는 Storyboard AI provider configuration key를 추가했습니다.
- SecretStorage 기반 API key 관리와 `Storyboard: Set API Key...` command를 추가했습니다.
- Phase 3 AI integration을 위한 testable `SecretStore` 및 `ConfigBridge` adapter를 추가했습니다.
- mock 및 OpenAI provider를 지원하는 Phase 3 AI provider registry를 추가했습니다.
- 초기 `ai.providers.list`, `ai.providers.checkConnection`, `ai.generate` RPC contract를 추가했습니다.
- Phase 3 AI registry에 Claude, Google Gemini, Ollama provider support를 추가했습니다.
- response parsing, JSON repair, trait processing을 위한 deterministic AI utility module을 추가했습니다.
- 최소 Storyboard AI service facade와 Phase 3 orchestration용 core prompt module을 추가했습니다.

### Documentation

- README를 Phase 5 scope 및 0.0.1 dogfooding에 맞게 정렬했습니다(Marketplace publish는 아직 없음).
- `doc/plan.md` MVP gate를 local `vsce package`, QA, dogfooding 중심으로 재정의했습니다.

### Changed

- Project license를 MIT에서 Apache License 2.0으로 변경했습니다(`LICENSE`, `package.json`).
- Phase 0을 Picktion compatibility fixture 대신 repository readiness에 집중하도록 축소했습니다.
- `npm run build`가 extension host와 webview UI를 모두 bundle하도록 packaging script를 업데이트했습니다.