# 01. 프로젝트 초기화 정책

> 작성일: 2026-05-03  
> 범위: PR 3 — `storyboard.init` 명령과 초기 프로젝트 구조 생성

## 결정 요약

`storyboard.init` 명령은 VSCode 워크스페이스 폴더를 Storyboard 프로젝트로 초기화한다. Storyboard는 Picktion의 `.picktion` 파일 포맷이나 브라우저 storage 계층을 재사용하지 않고, VSCode workspace 파일 시스템을 source of truth로 사용한다.

## 결정 사항

### 1. Picktion storage 코드는 직접 이식하지 않는다

Picktion의 `FileSystemAdapter`는 브라우저 `Blob`, `FileReader`, `<input type="file">` 기반 import/export 코드다. PR 3의 VSCode extension host 초기화에는 맞지 않는다.

PR 3에서는 Picktion에서 다음 아이디어만 참고한다.

- 프로젝트 format/genre 값: `novel`, `screenplay`, `play`, `essay`, `poem`
- 캐릭터·배경·씬의 기본 필드 감각
- 이후 zod/uuid 기반 검증과 식별자 생성 방향

`.picktion` 호환 import는 **제공하지 않는다** (`doc/concept.md` 비목표와 동일). 과거 Picktion 데이터가 필요하면 수동으로 워크스페이스 파일을 옮기거나, 필요해지면 그때 별도 도구·문서로 범위를 정한다.

### 2. 비-Storyboard 폴더에서도 초기화를 허용한다

워크스페이스 폴더가 비어 있지 않아도 `.storyboard/project.json`이 없으면 초기화할 수 있다. 작가가 이미 노트를 작성 중인 폴더를 Storyboard 프로젝트로 승격할 수 있어야 하기 때문이다.

단, `.storyboard/` 폴더는 있는데 `project.json`이 없는 경우는 중단한다. 이 상태는 일부 초기화가 실패했거나 사용자가 직접 만든 애매한 상태일 수 있으므로 자동 병합하지 않는다.

### 3. 기존 사용자 파일은 덮어쓰지 않는다

초기화 명령은 다음 정책을 따른다.

- 기존 `README.md`가 있으면 보존한다.
- 기존 `.gitignore`가 있으면 Storyboard ignore block만 없을 때 append한다.
- 샘플 카드/씬 파일은 없을 때만 생성한다.
- `.storyboard/project.json`이 이미 있으면 재초기화하지 않는다.

### 4. 생성 구조는 컨셉 문서의 워크스페이스 모델을 따른다

초기화 시 생성되는 핵심 구조는 다음과 같다.

```text
.storyboard/project.json
.storyboard/cache/personas/
.storyboard/cache/scenes/
character/sample.card
character/profile/
background/sample.card
background/concept/
scene/01-prologue.txt
draft/
```

`draft/`와 `.storyboard/cache/`는 재생성 가능한 산출물/캐시이므로 기본 `.gitignore` 대상이다.

### 5. `project.json`은 zod로 검증한다

초기 `project.json`은 다음 필드를 가진다.

```json
{
  "version": "1.0.0",
  "id": "uuid-v4",
  "name": "workspace-folder-name",
  "format": "novel",
  "language": "ko",
  "createdAt": "ISO datetime",
  "settings": {
    "scenePrefixDigits": 2,
    "trackDraft": false
  }
}
```

쓰기 전/읽기 시점 모두 동일 스키마를 사용해 검증할 수 있게 한다.