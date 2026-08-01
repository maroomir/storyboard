# Seeds ↔ Storyboard 정렬 (요약)

Storyboard와 Seeds가 공유하는 **도메인·`.seed` 교환 정책** 요약이다. `.seed` 저장소 형식·스키마의 단일 진실원은 [seedcoat](https://github.com/maroomir/seedcoat) (`SRS.md`, `API.md`)이며, 최신 릴리즈는 `@seedcoat/wasm` **v0.7.0**(저장소 포맷 `seed repository v3`)이다.

`.seed`는 Git 유사 저장소(노트·스냅샷·refs)를 하나의 파일로 내보낸 **포터블 아카이브**(`seedcoat archive v1`)이며, 전체 변경 이력을 보존한다. 암호화 컨테이너가 아니다.

## 두 제품의 역할 (2026-08 기준)

- **[Seeds](https://github.com/webfic/seeds)**가 `.seed` 네이티브 데스크톱 집필 스튜디오다(신기능 전담). `@seedcoat/wasm` 0.7.0을 vendoring하며, 문서 생성·집필·AI 공저·이력 UI를 제공한다.
- **Storyboard**(이 저장소)는 유지보수 모드다 — 버그 수정과 파이프라인 품질 대응만 하며, `.seed` 가져오기/내보내기 3개 커맨드로 Seeds와 교환한다.
- 두 제품은 **코드를 공유하지 않는다**. 호환은 오직 seedcoat 포맷 계약으로 보장한다(Seeds `PLAN.md` §7).

**Storyboard 쪽 구현**

- 인코딩·디코딩: [`apps/desktop/src/infrastructure/seedcoat/projectAdapter.ts`](apps/desktop/src/infrastructure/seedcoat/projectAdapter.ts)
- VS Code 명령: [`apps/desktop/src/presentation/commands/importSeed.ts`](apps/desktop/src/presentation/commands/importSeed.ts)

## 디스크 매핑 (Storyboard 워크스페이스)

| `SeedState` 필드 | 경로 |
|------|------|
| `project` | `.storyboard/project.json` |
| `characters[]` | `character/<id>.card` (YAML) |
| `backgrounds[]` | `background/<id>.card` (YAML, `type ∈ {location, temporal, social}`) |
| `scenes[]` (`stem`, `content`) | `scene/<stem>.txt` (raw) |
| `drafts[]` (v3 신설) | 대응 없음 — 아래 "드래프트" 절 참조 |

Seeds는 디스크 매핑 없이 seedcoat 엔티티를 직접 편집한다.

## 저장소 포맷: v3와 마이그레이션 비대칭

seedcoat 0.7.0이 저장소 포맷을 **v3**로 올렸다(스냅숏이 그룹 트리를 참조, `drafts` 1급 그룹 신설). 교환에 중요한 비대칭이 생겼다:

- **Storyboard(v2) → Seeds(v3): 성립.** v3 엔진은 v2 아카이브를 로드 시 자동 마이그레이션한다. 모든 상태·이력이 보존되지만 **change id는 재계산**되므로, change id를 외부에 기록해 둔 워크플로우는 id가 달라짐을 감안한다.
- **Seeds(v3) → Storyboard(현행 wasm 0.6.0): 불가.** v0.6.0 엔진은 v3 아카이브를 `UNSUPPORTED_FORMAT`으로 거부한다. **Storyboard의 vendored `@seedcoat/wasm`을 0.7.0으로 올리는 것이 유지보수 백로그**이며, 그 전까지 Seeds→Storyboard 방향 교환은 성립하지 않는다.
- v1(0.4.x 이전) 아카이브는 양쪽 모두 거부한다(마이그레이션은 직전 포맷 한 단계만 — seedcoat `docs/adr/0004-format-migration-policy.md`).

## 드래프트 교환

v3의 `drafts[]`는 씬별 후보 원고의 1급 엔티티다(`id`·`sceneStem`·`label`·`status`·`content`·`origin`). Seeds는 다음 관례로 Storyboard와 교환한다:

- **가져오기**: extensions의 `storyboard/draft/<stem>.md` 항목을 `status: candidate` 드래프트로 승격한다(다른 네임스페이스는 불투명 보존, 같은 씬·같은 내용은 중복 생략).
- **내보내기**: `status: accepted` 드래프트만 씬당 1개씩 `storyboard/draft/<stem>.md`로 기록한다.

Storyboard는 현행대로 `draft/`를 아카이브 소스로 취급하지 않는다. Storyboard가 이 extensions 네임스페이스를 읽어 `draft/<stem>.md`로 복원하는 것은 wasm 0.7.0 전환과 함께 검토할 후속 항목이다.

## `.seed` 정책 (현행 유지 항목)

- 디스크 교환용 `.seed`는 seedcoat 아카이브만 지원한다. 구 암호화 바이너리(v0.2)·평문 JSON envelope는 `UNSUPPORTED_FORMAT`으로 거부한다.
- `.seed`는 암호화되지 않는다. 내보내기 시 비암호화 고지를 1회 표시한다.
- Storyboard **가져오기**는 `load` 검증 후 HEAD 스냅샷을 디스크에 반영하고, 노트 없는 아카이브는 거부한다. **내보내기**는 새 저장소를 만들어 노트 1개를 기록하며 기존 이력을 이어가지 않는다. (Seeds는 문서 이력을 직접 이어간다.)
- 캐릭터 `arc` / `recentDialogues` / `profile` / `attributes`는 `.seed` 왕복에서 보존되지 않는다(canonical 스키마 외 필드는 드롭). Seeds의 카드 프로필 이미지도 아카이브 밖 사이드카(`<문서>.seed.assets/`)라 교환 대상이 아니다.
- `project.json`의 `editor.trackDraft` 등 로컬 전용 값은 동기화 시 보존되지 않을 수 있다 — 동기화 전 백업.

## 씬 stem 정책 차이

- seedcoat 기준 stem은 숫자 prefix(`^[0-9]+-`)면 유효하다.
- **Storyboard 내보내기는 두 자리 prefix**(`^\d{2}-`, `scenePrefixDigits === 2`)를 [`seedExportPreflight.ts`](apps/desktop/src/infrastructure/seedcoat/seedExportPreflight.ts)로 강제한다.
- **Seeds 신규 문서는 세 자리**(`scenePrefixDigits: 3`)가 기본이다. Storyboard에서 가져온 문서는 그 문서의 자릿수를 유지하므로 왕복에 문제없지만, Seeds에서 새로 만든 문서를 Storyboard 워크스페이스로 옮기려면 Storyboard 쪽 preflight 정책과 어긋날 수 있음을 감안한다.
- Storyboard는 디코드된 stem을 raw 보존하고, Seeds도 stem을 임의 재번호하지 않는다.

## 기타

- 오류 코드 → 한국어 메시지: Storyboard는 [`projectStorageMessages.ts`](apps/desktop/src/infrastructure/seedcoat/projectStorageMessages.ts), Seeds는 자체 로케일 리소스에서 매핑한다.
- 구 `type: background` 단일 타입 카드는 Zod 검증에 실패한다 — `location` / `temporal` / `social`로 수동 수정 후 교환.
- 이력 조회·되돌리기 UI: Seeds는 제공한다. Storyboard는 노출하지 않는다(유지보수 모드).
