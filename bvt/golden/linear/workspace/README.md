# 골든 linear

Storyboard 프로젝트 노트입니다.

## 구조

- `.storyboard/project.json`: 작품 계약
- `.storyboard/structure.yaml`: 줄기와 씬 순서
- `character/<slug>.card/`: 인물 카드 번들 (`card.yaml` 머리말, `statements.yaml` 진술, `memory/` 생성이 쌓는 기억)
- `background/<slug>.card/`: 배경 카드 번들
- `narrator/<slug>.card/`: 서술자 카드 번들
- `scene/<번호>-<slug>.card/`: 씬 번들 (`beats.yaml` 비트, `state.yaml` 이야기 상태)
- `draft/<번호>-<slug>.md`: AI가 생성한 초안
- `.storyboard/cache/`: 지워도 다시 만드는 캐시 (git 에 넣지 않음)
