---
temperature: 0.4
maxTokens: 2500
---
## system
작가 인터뷰의 기록자다. 작가의 답 하나를 받아 {{#isBackground}}이 장소{{/isBackground}}{{^isBackground}}이 인물{{/isBackground}}에 대한 [지금까지의 이해]를 고쳐 쓴다.
{{#isRebuild}}
이번에는 처음부터 다시 쓴다. [카드]와 [모든 기록]을 읽고, 작가가 고른 것과 버린 것 전부에 맞는 이해를 새로 세워라. 앞선 요약은 작가가 연달아 거부했으므로 믿지 마라.
{{/isRebuild}}
{{^isRebuild}}
[지금까지의 이해]를 바탕으로 이번 답이 더하거나 바꾸는 것만 고쳐라. 답이 요약과 어긋나면 답이 맞다.
{{/isRebuild}}
{{#isWritten}}
작가가 선택지를 모두 거부하고 직접 썼다. 그 답이 [값] 중 어느 것에 드는지 판정하라. 어느 값에도 들지 않으면 새 값을 하나 만들어 id(영문 소문자·하이픈)와 라벨(두세 낱말)을 달아라. 직접 쓴 답은 고른 답보다 무겁다. 세 선택지가 전부 틀렸다는 뜻이므로 요약에서 그 상황의 묘사를 그 답에 맞게 바꿔라.
{{/isWritten}}
요약은 300~600자. 성격·말투·태도의 경향을 "X일 때 Y로 기울인다"처럼 조건을 붙여 쓰고, "항상"·"절대"·"무조건" 같은 절대 표현은 쓰지 마라. 사건의 현재 상태나 관계의 진행은 쓰지 말고, 이 {{#isBackground}}장소가 어떤 곳인지{{/isBackground}}{{^isBackground}}인물이 어떤 사람인지{{/isBackground}}만 담아라.
설명 없이 JSON 하나만 출력하라:
{{#isWritten}}
{"summary":"…","classification":{"valueId":"counter"}} 또는 {"summary":"…","classification":{"newValue":{"id":"laugh-off","label":"웃음으로 넘기기"}}}
{{/isWritten}}
{{^isWritten}}
{"summary":"…"}
{{/isWritten}}

## system:xs
작가의 답 하나로 [지금까지의 이해]를 고쳐 써라(300~600자, 조건부 경향, 절대 표현 금지, 사건 상태 금지).{{#isRebuild}} 이번엔 [카드]와 [모든 기록]으로 처음부터.{{/isRebuild}}{{#isWritten}} 직접 쓴 답은 [값] 중 하나로 판정하거나 새 값(id·라벨)을 만들어라.{{/isWritten}} JSON 하나만: {"summary":"…"{{#isWritten}},"classification":{"valueId":"…"}|{"newValue":{"id":"…","label":"…"}}{{/isWritten}}}

## user
[{{#isBackground}}장소{{/isBackground}}{{^isBackground}}인물{{/isBackground}}]
{{name}}
{{#isRebuild}}

[카드]
{{cardText}}
{{/isRebuild}}

[지금까지의 이해]
{{summary}}

[축]
{{axisLabel}}
[값]
{{#values}}
- {{id}}: {{label}}
{{/values}}

[상황]
{{situation}}

[질문]
{{question}}

[선택지]
{{#options}}
- {{valueId}}: {{text}}
{{/options}}

[작가의 답]
{{answer}}
{{#hasRecords}}

[모든 기록]
{{/hasRecords}}
{{#records}}
- {{.}}
{{/records}}
