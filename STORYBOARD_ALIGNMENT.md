# Seeds ↔ Storyboard 정렬 (요약)

Storyboard와 Seeds가 공유하는 **도메인·`.seed` 교환 정책** 요약이다. `.seed` 저장소 형식·스키마의 단일 진실원은 [seedcoat](https://github.com/maroomir/seedcoat) (`SRS.md`, `API.md`, `@seedcoat/wasm` v0.4.0)이다.

`.seed`는 더 이상 암호화 컨테이너가 아니다. Git 유사 저장소(노트·스냅샷·refs)를 하나의 파일로 내보낸 **포터블 아카이브**(`seedcoat archive v1`)이며, 전체 변경 이력을 보존한다.

**구현**

- 인코딩·디코딩: [`src/services/seedcoat/projectAdapter.ts`](src/services/seedcoat/projectAdapter.ts)
- VS Code 명령: [`src/commands/importSeed.ts`](src/commands/importSeed.ts)

## 디스크 매핑

| `SeedState` 필드 | 경로 |
|------|------|
| `project` | `.storyboard/project.json` |
| `characters[]` | `character/<id>.card` (YAML) |
| `backgrounds[]` | `background/<id>.card` (YAML, `type ∈ {location, temporal, social}`) |
| `scenes[]` (`stem`, `content`) | `scene/<stem>.txt` (raw) |

## `.seed` 정책

- 디스크 교환용 `.seed`는 **seedcoat 아카이브(`seedcoat archive v1`)**만 지원한다. 구 암호화 바이너리(v0.2)와 평문 JSON envelope는 `UNSUPPORTED_FORMAT`으로 거부하며 자동 변환은 없다.
- `.seed`는 **암호화되지 않는다**. 패스프레이즈는 더 이상 사용하지 않으며, 내보내기 시 비암호화 고지를 1회 표시한다.
- **가져오기**는 `load`로 아카이브를 검증(경로 안전성·객체 해시·refs 무결성)한 뒤, HEAD 노트의 스냅샷(`log` → `checkoutSnapshot`)을 디스크에 반영한다. 노트가 하나도 없는 아카이브는 거부한다.
- **내보내기**는 워크스페이스 상태로 새 저장소를 만들고(`init` → `note` → `save`) 노트 1개를 기록한다. 기존 `.seed`의 이력을 이어가지 않는다.
- 캐릭터 `arc` / `recentDialogues` / `profile` / `attributes`는 `.seed` 왕복에서 보존되지 않는다(seedcoat canonical 스키마가 알려진 필드만 기록).
- `draft/`, `.storyboard/cache/`는 아카이브에 포함하지 않으며 Seed 동기화 시에도 소스로 취급하지 않는다.
- 씬 `stem`은 seedcoat 기준으로 숫자 prefix(`^[0-9]+-`)면 유효하지만, Storyboard 내보내기는 **두 자리 prefix**(`^\d{2}-`) 정책을 유지한다. 보내기 전 [`src/files/seedExportPreflight.ts`](src/files/seedExportPreflight.ts)로 `editor.scenePrefixDigits === 2`와 stem 규칙을 사전 검사한다.
- `project.json`의 `editor.trackDraft`는 seed `project`에 **포함하지 않는다**. Seed로 **동기화**하면 디스크의 `project.json`이 디코드 결과로 덮어쓰이므로 `trackDraft`는 유지되지 않을 수 있다. 로컬에서만 쓰는 값은 동기화 전 백업하거나, 동기화 후 다시 설정한다.

## 씬 stem: Seeds vs Storyboard

- **Seeds**는 seedcoat 디코드 후 stem을 재번호할 수 있다.
- **Storyboard**는 디코드된 `stem`을 그대로 `scene/<stem>.txt`에 기록한다(**raw 보존**). Seeds↔Storyboard `.seed` 왕복 시 stem·순서가 어긋날 수 있으므로, 교환 전후에 `scene/` 파일명을 직접 확인한다.

## 미지원·호환

- **seedcoat v0.2 암호화 `.seed`는 읽을 수 없다.** 보낸 쪽(Seeds 또는 구버전 Storyboard)에서 v0.4 형식으로 다시 내보내야 한다. Seeds 앱도 `@seedcoat/wasm` v0.4 이상으로 전환되어야 교환이 성립한다.
- 기존 워크스페이스의 구 `type: background` 카드(`type: background` 단일 타입)는 Zod 검증에서 실패한다. 자동 마이그레이션·변환 도구는 없으며, 카드를 `location` / `temporal` / `social` 판별 유니온으로 **수동 수정**한 뒤 보내기/읽기를 시도한다.
- 오류 코드 → 한국어 메시지: [`src/constants/projectStorageMessages.ts`](src/constants/projectStorageMessages.ts)
- 이력 조회(`log`)·되돌리기(`reset` / `revert`) UI는 아직 노출하지 않는다(후속 작업).
