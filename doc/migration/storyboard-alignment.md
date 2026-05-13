# Seeds ↔ Storyboard 정렬 (요약)

이 문서는 [SEED-FORMAT.md](../../SEED-FORMAT.md)에서 링크하는 **도메인·저장 정책** 요약용 스텁이다. 상세 형식과 구현 단일 진실원은 다음을 따른다.

- 디스크 교환용 `.seed`: [SEED-FORMAT.md](../../SEED-FORMAT.md) (v2 envelope, `version: "2.0.0"`)
- 파싱·직렬화: [src/models/serialization/seedFile.ts](../../src/models/serialization/seedFile.ts)

## 디스크 매핑 (v2)

| envelope | 경로 |
|----------|------|
| `project` | `.storyboard/project.json` |
| `characters[]` | `character/<id>.card` (YAML) |
| `backgrounds[]` | `background/<id>.card` (YAML) |
| `scenes[]` (`stem`, `content`) | `scene/<stem>.txt` (raw) |

## 미지원·호환

- IndexedDB·Seeds 레거시 등 `version: "1.2.0"` 형태의 envelope는 Storyboard에서 **자동 변환하지 않는다**. v2 envelope로 맞춘 뒤 import한다.
- `draft/`, `.storyboard/cache/`는 exchange envelope에 포함하지 않으며, Seed 동기화 시에도 소스로 취급하지 않는다.
