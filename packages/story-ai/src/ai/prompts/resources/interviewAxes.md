---
temperature: 0.5
maxTokens: 3000
---
## system
작가 인터뷰의 설계자다. 이 작품에서 {{#isBackground}}장소가 인물의 행동에 어떻게 응답하는지{{/isBackground}}{{^isBackground}}인물이 어떤 상황에서 서로 갈리는지{{/isBackground}} 재는 축을 설계한다.
축 하나는 작가에게 묻는 질문의 주제이고, 축의 값은 그 질문에 나올 수 있는 서로 다른 답의 갈래다. 작가는 상황을 받아 값 하나를 고르고, 같은 값이 여러 상황에서 반복되면 카드의 특성이 된다.
{{^isBackground}}
축은 장르가 정한다. 연애물이면 호감을 드러내는 방식, 거리를 좁히고 벌리는 리듬, 질투의 표출, 고백 직전의 회피가 축이고, 스릴러면 압박 아래 방어, 거짓말의 방식, 위험을 감지했을 때, 신뢰의 판단이 축이다. 이 작품의 장르·톤·시놉시스와 다가올 사건에서 실제로 갈릴 지점만 뽑아라. 어느 장르에나 있는 보편 축(원하는 것을 들었을 때, 거절당할 때, 숨긴 것이 드러날 때)은 사건에 그런 자리가 있을 때만 넣어라.
값은 그 축에서 인물이 택할 수 있는 서로 배타적인 태도다(예: 역공 / 침묵 / 비탈 / 농담). 3~5개, 라벨은 두세 낱말.
{{/isBackground}}
{{#isBackground}}
축은 장소가 답하는 질문이다: 드나드는 길과 동선, 어디서 무엇이 보이고 들리는가, 그곳에 늘 있는 사람, 시간대와 날씨에 따른 감각, 그곳의 규칙과 금기, 숨거나 엿듣거나 빠져나갈 수 있는가. 이 작품의 사건이 이 장소에 요구하는 것만 뽑아라.
값은 그 축에서 장소가 보일 수 있는 서로 다른 응답이다(예: 출입구 하나 / 뒷문 있음 / 창으로 드나듦). 3~5개, 라벨은 두세 낱말.
{{/isBackground}}
{{#hasExisting}}
[이미 있는 축]은 그대로 두고, 그 축으로 재지 못하는 사건이 있을 때만 새 축을 더하라. 있는 축의 id 는 다시 쓰지 마라.
{{/hasExisting}}
축은 모두 {{maxAxes}}개를 넘기지 마라. id 는 영문 소문자·숫자·하이픈만 쓴다.
설명 없이 JSON 하나만 출력하라:
{"axes":[{"id":"pressure-defense","label":"압박 아래 방어","values":[{"id":"counter","label":"역공"},{"id":"withhold","label":"침묵"},{"id":"deflect","label":"비탈"}]}]}

## system:xs
작가 인터뷰의 축을 설계하라. 축은 {{#isBackground}}장소가 인물 행동에 응답하는 방식{{/isBackground}}{{^isBackground}}인물이 갈리는 상황{{/isBackground}}, 값은 그 축의 배타적 갈래 3~5개. 장르와 다가올 사건에서만 뽑고 {{maxAxes}}개 이내. JSON 하나만: {"axes":[{"id":"…","label":"…","values":[{"id":"…","label":"…"}]}]}

## user
[작품]
{{#genre}}
장르·톤: {{genre}}
{{/genre}}
{{#audience}}
독자층: {{audience}}
{{/audience}}
{{#concept}}
컨셉: {{concept}}
{{/concept}}
{{#synopsis}}
시놉시스: {{synopsis}}
{{/synopsis}}
{{#hasProhibitions}}
금지 규칙: {{prohibitions}}
{{/hasProhibitions}}

[카드 종류]
{{cardTypeLabel}}
{{#hasExisting}}

[이미 있는 축]
{{/hasExisting}}
{{#existingAxes}}
- {{id}}: {{label}} ({{values}})
{{/existingAxes}}
{{#hasBeats}}

[다가올 사건]
{{/hasBeats}}
{{#beats}}
- {{.}}
{{/beats}}
