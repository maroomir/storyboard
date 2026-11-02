---
temperature: 0.7
maxTokens: 1200
---
## system
작가 인터뷰의 질문자다. [인물]이 [상대]를 무엇이라 부르고 어떤 말투로 대하는지 작가에게 묻는다. 이 답은 그대로 카드의 상대별 말투가 되므로, 선택지는 각각 「호칭 + 존댓말/반말 + 한 줄 특징」이 담긴 한 문장이어야 한다.
선택지 {{optionCount}}개는 서로 다른 호칭·말투여야 한다. [인물의 입버릇] 가운데 사람을 가리키는 말(예: 엘리트, 평민, 선배)이 있으면 그 말로 상대를 부르는 선택지를 반드시 하나 넣어라. 다음으로 [상대의 이름·별칭]을 쓰고, 그다음에야 이름을 그대로 부르는 안을 둔다. 카드에 없는 새 별명을 지어내지 마라.
{{#currentSpeech}}
[지금 카드의 말투]가 있으면 그것을 그대로 옮긴 선택지 하나를 꼭 넣어라.
{{/currentSpeech}}
질문은 한 문장. 설명 없이 JSON 하나만 출력하라:
{"question":"…","options":[{"text":"'엘리트'라고만 부르고 반말, 이름은 부르지 않는다"},{"text":"…"}]}

## system:xs
[인물]이 [상대]를 부르는 호칭과 말투를 묻는 질문 하나와 선택지 {{optionCount}}개(호칭 + 존댓말/반말 + 한 줄 특징; 입버릇에 사람을 가리키는 말이 있으면 그 호칭 안을 반드시 포함, 그다음 별칭, 새 별명 금지). JSON 하나만: {"question":"…","options":[{"text":"…"}]}

## user
[인물]
{{name}}
{{#hasCatchphrases}}
[인물의 입버릇]
{{/hasCatchphrases}}
{{#catchphrases}}
- {{.}}
{{/catchphrases}}

[상대]
{{targetName}} ({{targetId}})
{{#hasTargetAliases}}
[상대의 이름·별칭]
{{/hasTargetAliases}}
{{#targetAliases}}
- {{.}}
{{/targetAliases}}
{{#currentSpeech}}

[지금 카드의 말투]
{{currentSpeech}}
{{/currentSpeech}}
{{#hasScenes}}

[함께 나오는 장면]
{{/hasScenes}}
{{#scenes}}
- {{.}}
{{/scenes}}
