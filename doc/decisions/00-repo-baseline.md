# 00. 초기 저장소 의사결정 로그

> 작성일: 2026-05-03  
> 범위: Phase 0 저장소 베이스라인 및 Phase 1 진입 방식

## 결정 요약

Storyboard는 Picktion과 호환되는 마이그레이션 대상이 아니라, VSCode Extension으로 새롭게 구성하는 신규 저장소로 진행한다.

Phase 0는 기존 계획보다 슬림하게 재정의하고, 저장소 기반 정리를 마친 뒤 곧장 Phase 1 스캐폴딩으로 진입한다.

## 결정 사항

### 1. `.clinerules/`는 현재 저장소의 규칙을 그대로 사용한다

현재 저장소에는 `.clinerules/` 디렉토리와 다음 주요 규칙 파일이 이미 존재한다.

- `general.md`
- `clean-code.md`
- `vscode-extension.md`
- `webview.md`
- `testing.md`
- `storyboard-overview.md`

따라서 PR 1에서는 Picktion에서 규칙 파일을 다시 복사하지 않는다.

### 2. 골든 픽스처는 MVP 필수 산출물에서 제외한다

초기 계획에는 Picktion과의 회귀 검증을 위해 골든 픽스처 50쌍을 수집하는 항목이 있었다.

하지만 Storyboard는 Picktion과 동작 호환을 목표로 하지 않는다. 현재 목표는 이 저장소에서 Storyboard가 잘 동작하는 것이므로, Picktion 호환용 골든 픽스처 수집은 Phase 0 및 MVP 필수 범위에서 제외한다.

필요하면 이후 기능별 테스트에서 Storyboard 전용 fixture를 작게 추가한다.

### 3. Phase 0/1은 4개 PR로 나누어 진행한다

초기 구현은 다음 단위로 쪼갠다.

1. **PR 1 — 저장소 베이스라인 정리**
   - `LICENSE`
   - `.gitignore`
   - `CHANGELOG.md`
   - 확장된 `README.md`
   - `doc/decisions/00-repo-baseline.md`
2. **PR 2 — Phase 1a: TypeScript + esbuild 스캐폴딩**
   - 최소 extension manifest
   - `storyboard.helloWorld` 명령
   - TypeScript/esbuild/VScode debug 설정
3. **PR 3 — Phase 1b: `storyboard.init` 명령 + 프로젝트 구조 생성**
   - `.storyboard/project.json`
   - Storyboard 표준 디렉토리 생성
   - 샘플 카드/씬 생성
4. **PR 4 — Phase 1c: Activity Bar 아이콘 + Sidebar placeholder**
   - Activity Bar view container
   - 빈 webview placeholder

### 4. 배포 산출물은 GitHub Releases에 둔다

확장 산출물은 저장소의 GitHub Releases에 VSIX로 첨부한다. PR 1에는 배포 자동화를 포함하지 않고, 실제 패키징 및 배포 검증이 필요한 시점까지 로컬 VSIX 생성 절차를 정리하는 것으로 둔다.

## PR 1 완료 기준

- Apache-2.0 `LICENSE`가 존재한다.
- Node/VSCode extension 개발에 필요한 `.gitignore`가 존재한다.
- `CHANGELOG.md`에 `Unreleased` 섹션이 있다.
- `README.md`가 프로젝트 소개, 문서 링크, 초기 로드맵, 개발 안내를 포함한다.
- 이 의사결정 로그가 `doc/decisions/00-repo-baseline.md`에 기록되어 있다.

## 검증 메모

PR 1 시점에는 아직 `package.json`이 없으므로 빌드, 린트, 테스트 스크립트를 실행하지 않는다. 검증은 파일 존재와 문서 내용의 수동 확인으로 제한한다.