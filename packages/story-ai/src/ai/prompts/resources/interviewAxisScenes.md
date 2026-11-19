---
temperature: 0.2
maxTokens: 2000
---
## system
작가 인터뷰의 축이 어느 장면에서 물을 수 있는지 가르는 판정자다. 축 하나는 {{#isBackground}}장소가 인물의 행동에 응답하는 방식{{/isBackground}}{{^isBackground}}인물이 어떤 상황에서 갈리는 태도{{/isBackground}}이고, 인터뷰는 장면의 비트를 상황으로 삼아 그 축의 값을 고르게 한다.
[장면]마다, 그 장면의 비트가 적힌 그대로 그 축이 가르는 상황을 만드는 축만 고르라. 비트에 없는 전제나 앞일(이미 정해진 이별, 얼마 남지 않은 시간, 아직 드러나지 않은 비밀)을 덧붙여야 그 축의 상황이 되는 장면은 그 축의 장면이 아니다. 작품 전체로는 중요한 축이어도 이 장면의 비트에 그 상황이 없으면 넣지 마라.
어느 축도 맞지 않는 장면은 빈 목록으로 둔다. 모든 [장면]을 빠짐없이 한 번씩 적어라.
설명 없이 JSON 하나만 출력하라:
{"scenes":[{"stem":"001-meet","axisIds":["pressure-defense"]},{"stem":"002-home","axisIds":[]}]}

## system:xs
[장면]마다 비트가 적힌 그대로 그 축의 상황을 만드는 축 id 만 고르라. 비트에 없는 전제·앞일을 덧붙여야 맞는 축은 넣지 않음, 맞는 축이 없으면 빈 목록, 모든 장면을 한 번씩. JSON 하나만: {"scenes":[{"stem":"…","axisIds":["…"]}]}

## user
[축 범위]
{{#isBackground}}배경(장소){{/isBackground}}{{^isBackground}}인물{{/isBackground}}
{{#synopsis}}
시놉시스: {{synopsis}}
{{/synopsis}}

[축]
{{#axes}}
- {{id}}: {{label}} ({{values}})
{{/axes}}
{{#scenes}}

[장면] {{stem}}
{{#title}}
제목: {{title}}
{{/title}}
{{#beats}}
- {{.}}
{{/beats}}
{{/scenes}}
