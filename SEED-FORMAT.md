# Seeds `.seed` 파일 형식 명세 (v2 envelope)

이 파일(`SEED-FORMAT.md`, 저장소 루트)이 Seeds **디스크 교환용** `.seed` 형식의 **유일한 공식 명세**다.

Seeds가 **파일로 보내고·가져오는** 교환 형식은 **단일 JSON 텍스트**(UTF-8)인 **v2 envelope**(`version: "2.0.0"`)이다. 브라우저 **IndexedDB**용 직렬화(`serializeProject` / `deserializeProject`, `version: "1.2.0"` 등)와는 별도이며, 그 관계와 호환 정책은 §8을 따른다.

**구현 단일 진실원:** `src/models/serialization/seedFile.ts`의 `SEED_ENVELOPE_VERSION`, `serializeSeed`, `parseSeed` 및 같은 디렉터리의 Zod 스키마(`projectJsonSchema`, `characterCardSchema`, `backgroundCardSchema`, `sceneEnvelopeEntrySchema` 등). 명세와 코드가 어긋나면 **코드를 우선**하고 이 문서를 맞춘다.

**관련(도메인·정책):** [doc/migration/storyboard-alignment.md](doc/migration/storyboard-alignment.md)

`.seed`는 사람이 텍스트 에디터로 열어 직접 편집할 수 있도록, 최상위 키를 storyboard 워크스페이스의 **논리적 파일 트리**와 1:1에 가깝게 둔다. **바이너리 zip은 사용하지 않는다.**

---

## 1. 버전과 최상위 구조

| 키 | 타입 | 의미 |
|----|------|------|
| `version` | string | **envelope** 포맷 버전. 마이그레이션 분기에 사용. v2는 `"2.0.0"`. |
| `project` | object | storyboard `.storyboard/project.json`과 동일 스키마의 JSON 객체. |
| `characters` | array | 각 요소는 storyboard `characterCardSchema`가 정의한 키를 갖는 **파싱된 객체**(YAML이 아님). |
| `backgrounds` | array | 각 요소는 `backgroundCardSchema` 키를 갖는 객체. |
| `scenes` | array | 각 요소는 `stem` + 원본 씬 파일 전체 문자열 `content`. |

**포함하지 않는 것**

- `draft/`에 대응하는 AI 산출물은 envelope에 넣지 않는다(메모리·IndexedDB만).
- v1에서 존재하던 revisions, snapshots, story 전용 래핑 구조 등은 v2 envelope에 없다.

---

## 2. 직렬화 규칙(바이트)

- 인코딩: **UTF-8**.
- 직렬화 함수의 권장 출력: `JSON.stringify(value, null, 2) + "\n"` (마지막 개행 포함).
- 파싱 실패·스키마 불일치는 구현에서 `SeedParseError` 등으로 래핑하여 원인을 노출한다.

---

## 3. `project` 객체 (요약)

storyboard `project.json`과 동일한 의미를 갖는다. 필드 예시는 다음과 같다(실제 필수·선택 여부는 Zod 스키마가 단일 진실원).

- `version`: `"1.0.0"` (프로젝트 메타 스키마 버전)
- `id`: UUID v4 등
- `name`, `format`, `language`
- `createdAt`: ISO-8601 문자열
- `settings`: `{ "scenePrefixDigits": number }`

Seeds는 `trackDraft` 같은 storyboard 호환 키가 들어와도 **사용하지 않으며 envelope 파싱 시 무시·폐기**한다.

---

## 4. `characters[]` / `backgrounds[]`

- 각 원소는 **이미 파싱된 카드 객체**다. 디스크의 `character/<id>.card`, `background/<id>.card`에 대응하지만, envelope 안에서는 YAML 문자열이 아니다.
- storyboard로 폴더를 풀 때는 `serializeCard` 규칙(`js-yaml` dump: `lineWidth: -1`, `noRefs: true`, `sortKeys: false`, 키 순서 고정)으로 YAML을 생성한다. Seeds 쪽은 round-trip 테스트를 위해 동일 규칙의 `parseCard` / `serializeCard` 유틸을 둔다.

---

## 5. `scenes[]`

각 원소는 객체이며 최소한 다음을 갖는다.

| 필드 | 타입 | 의미 |
|------|------|------|
| `stem` | string | storyboard `sceneFileNamePattern`을 만족하는 `NN-slug` 형식(예: `01-prologue`). |
| `content` | string | `scene/<stem>.txt` 파일의 **원본 raw 전체**. frontmatter 유무·줄바꿈·끝 공백까지 디스크에 쓸 때와 동일하게 보존. |

storyboard 쪽 어댑터는 `content`를 그대로 `scene/<stem>.txt`에 기록하면 된다.

---

## 6. 예시(JSON, 설명용)

아래는 구조 이해를 위한 예시이며, 필수 필드 전부를 나열하지는 않는다.

```jsonc
{
  "version": "2.0.0",
  "project": {
    "version": "1.0.0",
    "id": "uuid-v4",
    "name": "엘리아의 모험",
    "format": "novel",
    "language": "ko",
    "createdAt": "2026-05-13T07:30:00.000Z",
    "settings": { "scenePrefixDigits": 2 }
  },
  "characters": [
    {
      "type": "character",
      "id": "elia",
      "name": "엘리아",
      "role": "main",
      "tags": ["용감한"],
      "traits": ["활발하게 움직임"],
      "description": "주인공.",
      "relations": [{ "target": "jihoon", "type": "친구" }],
      "arc": [{ "stage": "발단", "summary": "학교 도착", "sceneRef": "01-prologue" }],
      "recentDialogues": ["이건 우리가 해낼 수 있어!"]
    }
  ],
  "backgrounds": [
    {
      "type": "background",
      "id": "school",
      "name": "학교 정문",
      "country": "한국",
      "category": "일상/학교",
      "tags": ["학교"],
      "description": "주인공이 처음 등교하는 고등학교 정문."
    }
  ],
  "scenes": [
    {
      "stem": "01-prologue",
      "content": "---\ntitle: 프롤로그\ncharacters: [elia, jihoon]\nlocation: school\nmood: 시작\n---\n주인공이 학교에 도착했다..."
    }
  ]
}
```

---

## 7. storyboard 폴더 트리로의 매핑(참고)

Seeds 구현 범위는 envelope까지다. storyboard가 이 JSON을 받아 워크스페이스로 풀 때의 대응 관계는 다음과 같다.

| envelope | 디스크 경로 |
|----------|-------------|
| `project` | `.storyboard/project.json` (`JSON.stringify(..., null, 2) + "\n"`) |
| `characters[i]` | `character/<id>.card` (YAML, `serializeCard`) |
| `backgrounds[i]` | `background/<id>.card` (동일) |
| `scenes[i]` | `scene/<stem>.txt` (`content` 그대로) |

---

## 8. v1 `.seed`·이전 저장 데이터와의 관계

- **자동 변환 없음.** 이전 Seeds가 쓰던 `version: "1.2.0"` + 중첩 `project` 형태의 JSON(IndexedDB 직렬화와 동일한 형태)을 `.seed`로 가져오는 것은 지원하지 않는다. `parseSeed`는 **`version: "2.0.0"` envelope만** 허용한다.
- 위 레거시 형식이나 스키마 불일치는 `SeedParseError`로 래핑되며, 사용자에게는 **한국어 메시지**로 이전 형식·지원 버전을 안내한다(`src/constants/projectStorageMessages.ts`의 `UNSUPPORTED_LEGACY_SEED_FILE_MESSAGE` 등).
- **IndexedDB**: 앱이 현재 지원하는 직렬화(`version: "1.2.0"`, `project` 중심)가 아닌 레코드는 **프로젝트 목록에서 제외**되며, 직접 열기를 시도하면 동일 계열의 미지원 안내(`UNSUPPORTED_STORED_PROJECT_MESSAGE`)로 실패한다. 자동 마이그레이션·손실 필드 안내 다이얼로그는 구현하지 않는다.
- 정책·필드 매핑 요약은 [storyboard-alignment.md](doc/migration/storyboard-alignment.md)의 「저장·import 미지원 정책」 절을 따른다.

---

## 9. 의존성(구현)

- 검증·정규화: `zod`
- 카드 round-trip 테스트: `js-yaml`(storyboard `serializeCard`와 동일 dump 옵션)
- zip 라이브러리: **불필요**
