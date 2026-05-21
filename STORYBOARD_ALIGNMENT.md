# Seeds ↔ Storyboard 정렬 (요약)

Storyboard와 Seeds가 공유하는 **도메인·`.seed` 교환 정책** 요약이다. 암호화 컨테이너·4파트 JSON 스키마의 단일 진실원은 [seedcoat](https://github.com/maroomir/seedcoat) (`SRS.md`, `API.md`, `@seedcoat/wasm` v0.2.0)이다.

**구현**

- 인코딩·디코딩: [`src/services/seedcoat/projectAdapter.ts`](src/services/seedcoat/projectAdapter.ts)
- VS Code 명령: [`src/commands/importSeed.ts`](src/commands/importSeed.ts)

## 디스크 매핑

| 파트 | 경로 |
|------|------|
| `project` | `.storyboard/project.json` |
| `characters[]` | `character/<id>.card` (YAML) |
| `backgrounds[]` | `background/<id>.card` (YAML, `type ∈ {location, temporal, social}`) |
| `scenes[]` (`stem`, `content`) | `scene/<stem>.txt` (raw) |

## `.seed` 정책

- 디스크 교환용 `.seed`는 **seedcoat v0.2 암호화 바이너리**만 지원한다. 평문 JSON envelope 등은 `LEGACY_FORMAT_REJECTED`로 거부하며 자동 변환은 없다.
- import·export 시 **패스프레이즈를 매번 입력**한다. 빈 문자열은 허용하지 않으며 앱에 저장하지 않는다(메모리 한정).
- 가져오기 시 패스프레이즈 입력 전 `inspectHeader`로 레거시 파일을 먼저 거부한다.
- 캐릭터 `arc` / `recentDialogues` / `profile` / `attributes`는 `.seed` 왕복에서 보존되지 않는다(seedcoat FR-8).
- `draft/`, `.storyboard/cache/`는 컨테이너에 포함하지 않으며 Seed 동기화 시에도 소스로 취급하지 않는다.
- 씬 `stem`은 seedcoat §9.6 기준 **두 자리 숫자 prefix**(`^\d{2}-`)를 만족해야 export `validate`가 통과한다. Storyboard는 보내기 전 [`src/files/seedExportPreflight.ts`](src/files/seedExportPreflight.ts)로 `editor.scenePrefixDigits === 2`와 stem 규칙을 사전 검사한다.
- `project.json`의 `editor.trackDraft`는 seed `project` envelope에 **포함하지 않는다**. Seed로 **동기화**하면 디스크의 `project.json`이 디코드 결과로 덮어쓰이므로 `trackDraft`는 유지되지 않을 수 있다. 로컬에서만 쓰는 값은 동기화 전 백업하거나, 동기화 후 다시 설정한다.

## 씬 stem: Seeds vs Storyboard

- **Seeds**는 seedcoat 디코드 후 §11.1에 따라 stem을 재번호할 수 있다.
- **Storyboard**는 디코드된 `stem`을 그대로 `scene/<stem>.txt`에 기록한다(**raw 보존**). Seeds↔Storyboard `.seed` 왕복 시 stem·순서가 어긋날 수 있으므로, 교환 전후에 `scene/` 파일명을 직접 확인한다.

## 미지원·호환

- 기존 워크스페이스의 구 `type: background` 카드(`type: background` 단일 타입)는 Zod 검증에서 실패한다. 자동 마이그레이션·변환 도구는 없으며, 카드를 `location` / `temporal` / `social` 판별 유니온으로 **수동 수정**한 뒤 보내기/읽기를 시도한다.
- 오류 코드 → 한국어 메시지: [`src/constants/projectStorageMessages.ts`](src/constants/projectStorageMessages.ts)
