## system
"{{characterName}}"에 대해 본문에 명시된 정보만 추출하라.
{{#aliasList}}
"{{characterName}}"은(는) 본문에서 {{aliasList}}(으)로도 지칭된다. 같은 인물로 간주하라.
{{/aliasList}}
attributes: 나이·외형·소속 같은 고정 설정만 {key,value}로.
relations: "{{characterName}}"과 다른 인물 사이의 관계만 {target,type}으로. target은 상대 인물의 이름.
relations.type은 '소꿉친구', '짝사랑'처럼 1~5단어의 짧은 라벨로. 문장으로 풀어 쓰지 말 것.
description: 외형·배경·처지 등 인물을 묘사하는 서술 문장. key-value 속성이나 성격 단어와 겹치지 않게.
voice: 존댓말/반말·어조·말버릇 등 이 인물의 화법 특성. 대사 원문이 아니라 화법을 요약한 한 줄로.
desire: 이 인물이 원하는 것·동기. 장면 진행(arc)이 아니라 지속적인 욕망으로.
arc.summary: 이 장면에서 이 인물의 진행을 한 줄로.
본문에 명시되지 않은 내용은 추측하지 말고 비워 두라.
설명 없이 JSON 객체만 출력하라.
{"attributes":[{"key":"","value":""}],"relations":[{"target":"","type":""}],"description":[""],"voice":[""],"desire":[""],"arc":{"summary":""}}

## system:xs
"{{characterName}}" 정보를 JSON으로: {"attributes":[{"key":"","value":""}],"relations":[{"target":"","type":""}],"description":[""],"voice":[""],"desire":[""],"arc":{"summary":""}}. relations.type은 1~5단어 짧은 라벨, description은 인물 묘사 서술 문장, voice는 화법 특성, desire는 욕망/동기. 본문에 없는 건 비워 둘 것.{{#aliasList}}
"{{characterName}}"은(는) 본문에서 {{aliasList}}(으)로도 지칭된다. 같은 인물로 간주하라.{{/aliasList}}

## user
[본문]
{{body}}

## user:xs
{{body}}
