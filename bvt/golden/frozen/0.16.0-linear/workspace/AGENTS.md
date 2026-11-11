# Storyboard 작품 저장소 — 에이전트 지침

이 저장소는 Storyboard 워크스페이스다. 소설 본문은 사람도 에이전트도 직접 쓰지 않는다.
`storyboard` CLI가 작품 계약과 카드에서 생성하고, 이야기 상태 원장과 검수가 그 위에서 돈다.

## 지켜야 할 선

- **`draft/*.md`를 직접 쓰거나 고치지 마라.** 생성은 `storyboard draft generate`, 손질은
  `storyboard draft edit`·`storyboard draft augment`·`storyboard draft condense`·
  `storyboard draft expand`. 직접 쓰면 이야기 상태와 검수가 전부 비껴간다.
- **카드·씬 번들(`*.card/` 폴더)의 파일을 손으로 고치지 마라.** `card.yaml`(머리말)·
  `statements.yaml`(진술)·`state.yaml`(이야기 상태)·`memory/`는 동사로만 바뀐다.
  `.storyboard/cache/`는 생성물이니 고치지 마라.
- **작가가 확인한 것만 `storyboard card set`으로 쓴다**(출처 `agent`). 네 생각은
  `storyboard card edit <slug> "<지시>" --propose`로 제안만 남기고, 작가가
  `storyboard card apply <slug>`로 받거나 `storyboard card discard <slug>`로 버리게 하라.
  작가의 줄(`author`)은 덮이지 않는다.
- 작품 계약(`.storyboard/project.json`)은 `storyboard project set`으로만 바꾼다.
- **설정·프로바이더·모델·예산은 바꾸지 마라.** `storyboard config set`, `storyboard setup`,
  `storyboard apikey set`은 사람이 한다.
- 한 워크스페이스에 쓰기 프로세스는 하나다. 실행 잠금(`.storyboard/cache/storyboard.db`)에 막히면
  기다리지 말고 보고하라.
- push 여부는 아래 «작품 메모»의 규칙을 따른다. 적혀 있지 않으면 push하지 않는다.

## 먼저 할 일

```bash
storyboard status          # 다음 명령과 적용을 기다리는 제안(«제안» 줄)을 알려 준다
storyboard doctor          # 빠진 것과 고칠 명령을 함께 알려 준다. 실패 항목부터 처리한다
storyboard help            # 이 파일은 명령을 다 적지 않는다. 지금 설치된 CLI의 도움말이 기준이다
```

## 한 사이클

1. 계약: `storyboard project set`, 서술자가 필요하면 `storyboard card create narrator <slug> --person …`
2. 카드: `storyboard card create character "<설명>"`·`storyboard card create background "<설명>"`
   (먼저 `--dry-run`), `storyboard card build --propose`, `storyboard card recommend character`
3. 기획: `storyboard outline generate` → `storyboard scene seed` → `storyboard scene plot --all`.
   씬은 `storyboard scene list`로 보고 `storyboard scene create "<설명>" --after <씬>`·
   `storyboard scene move <씬> --after <씬>`로 순서를 바꾼다(번호는 엔진이 다시 매긴다)
4. 생성: `storyboard draft generate <씬>` (씬은 `002-rooftop`, `2`, `rooftop` 어느 것으로도),
   필요한 씬만은 `storyboard draft generate --all`, 장편 전체는 `storyboard novel generate`
5. 검수: `storyboard draft check continuity <씬>`, `storyboard draft check grammar <씬>`,
   `storyboard draft check slop <씬>` → 문제는 `storyboard draft revise` 또는 `storyboard draft edit`
6. 제안 처리: `storyboard card apply <slug> --dry-run`으로 보고 작가에게 물은 뒤 `storyboard card apply`,
   노트가 남긴 시놉시스 후보는 `storyboard outline show --pending` → `storyboard outline apply`
7. 조립: `storyboard manuscript assemble` → `storyboard manuscript review` →
   `storyboard manuscript export` (마지막 수정 계획은 `storyboard manuscript review --show`)

카드를 고친 뒤에는 `storyboard doctor`가 낡은 씬을 알려 준다. 초안이 여전히 맞으면
`storyboard state reseal`, 아니면 `storyboard draft generate <씬> --force`. 초안은 있는데
이야기 상태가 비어 있으면 `storyboard state generate`로 초안에서 세운다.

## 실행 규칙

- `--json`으로 결과를 받고 **종료 코드로 판단한다.** 0이 아니면 다음 단계로 가지 말고 stderr를 보고하라.
- `--force`, `--all`, `storyboard novel generate`는 비용이 크다. 사람이 시키지 않았으면 씬
  하나로 확인한 뒤 넓혀라.
- `--dry-run`이 있는 명령(`storyboard card create`, `storyboard scene plot`, `storyboard card build`,
  `storyboard card apply`, `storyboard draft augment`, `storyboard scene complete`)은 먼저
  `--dry-run`으로 제안을 보고 결정하라.
- 터미널이 아닌 곳에서 진행 로그가 필요하면 `--verbose`.
- 인물·배경 인터뷰는 `storyboard card interview <slug> --step --json`으로 한 단계씩 돌린다. 질문과
  선택지를 작가에게 그대로 보여 주고 **작가가 고른 번호나 쓴 문장만** `--answer`·`--write`로 넘긴다.
  답을 지어내거나 대신 고르지 마라. 끝나면 남은 제안은 `storyboard card apply <slug>`가 받는다.
- 카드를 지울 때는 `storyboard card remove <slug>`가 먼저 보여 주는 «함께 지울 줄»을 작가에게 보이고,
  허락을 받은 뒤에만 `--force`를 준다.

## 사람에게 물어볼 것

작품 계약 변경(장르·시점·구성·분량), 서술자 추가·삭제, 예산·모델 변경, 씬 삭제나 순서 변경,
카드 삭제, 카드의 사실과 충돌하는 수정, 제안을 받을지 버릴지.

## 작품 메모

(작가가 적는다: 문체, 금지 표현, 참고 자료, push 규칙 …)
