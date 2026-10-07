# Storyboard 작품 저장소 — 에이전트 지침

이 저장소는 Storyboard 워크스페이스다. 소설 본문은 사람도 에이전트도 직접 쓰지 않는다.
`storyboard` CLI가 작품 계약·카드·정전에서 생성하고, 이야기 상태 원장과 검수가 그 위에서 돈다.

## 지켜야 할 선

- **`draft/*.md`를 직접 쓰거나 고치지 마라.** 생성은 `storyboard draft generate`, 손질은
  `storyboard draft edit`·`storyboard draft augment`·`storyboard draft condense`·
  `storyboard draft expand`. 직접 쓰면 원장·정전·검수가 전부 비껴간다.
- **`.storyboard/memory/`와 `.storyboard/bible/`를 손으로 고치지 마라.** 원장은
  `storyboard state reseal`, 정전은 `storyboard canon promote`로만 바뀐다.
  `.storyboard/cache/`는 생성물이니 고치지 마라.
- 손대도 되는 것: `character/`, `background/`, `narrator/`, `scene/*.card`(시드·비트·요약).
  작품 계약(`.storyboard/project.json`)은 `storyboard project set`으로만 바꾼다.
- **설정·프로바이더·모델·예산은 바꾸지 마라.** `storyboard config set`, `storyboard setup`,
  `storyboard apikey set`은 사람이 한다.
- 한 워크스페이스에 쓰기 프로세스는 하나다. 실행 잠금(`.storyboard/cache/run.lock`)에 막히면
  기다리지 말고 보고하라.
- push 여부는 아래 «작품 메모»의 규칙을 따른다. 적혀 있지 않으면 push하지 않는다.

## 먼저 할 일

```bash
storyboard doctor          # 빠진 것과 고칠 명령을 함께 알려 준다. 실패 항목부터 처리한다
storyboard help            # 이 파일은 명령을 다 적지 않는다. 지금 설치된 CLI의 도움말이 기준이다
```

## 한 사이클

1. 계약: `storyboard project set`, 서술자가 필요하면 `storyboard narrator create`
2. 카드: `storyboard card create character`, `storyboard card create background`,
   `storyboard card build`, `storyboard card recommend character`
3. 기획: `storyboard outline generate` → `storyboard scene seed` → `storyboard scene plot --all`
4. 생성: `storyboard draft generate <stem>` (필요한 씬만은 `storyboard draft generate --all`,
   장편 전체는 `storyboard novel generate`)
5. 검수: `storyboard draft check continuity <stem>`, `storyboard draft check grammar <stem>`,
   `storyboard draft check slop <stem>` → 문제는 `storyboard draft revise` 또는 `storyboard draft edit`
6. 반영: `storyboard canon diff` → `storyboard canon promote`, `storyboard card promote`
7. 조립: `storyboard manuscript assemble` → `storyboard manuscript review` →
   `storyboard manuscript export`

카드를 고친 뒤에는 `storyboard doctor`가 낡은 씬을 알려 준다. 초안이 여전히 맞으면
`storyboard state reseal`, 아니면 `storyboard draft generate <stem> --force`.

## 실행 규칙

- `--json`으로 결과를 받고 **종료 코드로 판단한다.** 0이 아니면 다음 단계로 가지 말고 stderr를 보고하라.
- `--force`, `--all`, `storyboard novel generate`는 비용이 크다. 사람이 시키지 않았으면 씬
  하나로 확인한 뒤 넓혀라.
- `--dry-run`이 있는 명령(`storyboard scene plot`, `storyboard card build`,
  `storyboard card promote`, `storyboard canon promote`, `storyboard draft augment`,
  `storyboard scene complete`)은 먼저 `--dry-run`으로 제안을 보고 결정하라.
- 터미널이 아닌 곳에서 진행 로그가 필요하면 `--verbose`.

## 사람에게 물어볼 것

작품 계약 변경(장르·시점·구성·분량), 서술자 추가·삭제, 예산·모델 변경, 씬 삭제나 번호 변경,
정전과 충돌하는 카드 수정.

## 작품 메모

(작가가 적는다: 문체, 금지 표현, 참고 자료, push 규칙 …)
