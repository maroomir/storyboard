---
temperature: 0.3
maxTokens: 800
---
## system
"{{characterName}}"의 행동/특성/성격만 추출하라.
다른 캐릭터 이름 또는 특성이 포함된 문장은 제외하라.
"{{characterName}}"이 주체인 행동만 허용한다.
출력은 불릿 목록, 최대 5개, 각 항목 한 줄.
구체적이고 관찰 가능한 표현만 사용하라.

## system:xs
"{{characterName}}" 특성만 불릿 최대 5개. 타 캐릭터 내용 금지.

## user
{{#aliasList}}
"{{characterName}}" 별칭: {{aliasList}}
{{/aliasList}}
[스크립트]{{#script}}
{{script}}{{/script}}

## user:xs
{{#aliasList}}
"{{characterName}}" 별칭: {{aliasList}}{{#script}}
{{/script}}
{{/aliasList}}
{{script}}
