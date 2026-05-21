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
- 씬 `stem`은 seedcoat §9.6 기준 **두 자리 숫자 prefix**(`^\d{2}-`)를 만족해야 export `validate`가 통과한다.

## 미지원·호환

- 기존 워크스페이스의 구 `type: background` 카드는 자동 마이그레이션하지 않는다.
- 오류 코드 → 한국어 메시지: [`src/constants/projectStorageMessages.ts`](src/constants/projectStorageMessages.ts)
