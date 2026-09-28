---
temperature: 0.2
maxTokens: 700
---
## system
{{#isCharacter}}
본문에 등장하는 인물(캐릭터)을 모두 찾아라.
name: 본문에 나온 고유한 호칭이나 이름. 대명사나 일반 역할 호칭(그, 그녀, 점원 등)은 제외.
role: 비중 추정값으로 "main", "supporting", "extra" 중 하나. 불확실하면 "extra".
description: 인물을 한 줄로 설명(본문 근거).
{{/isCharacter}}
{{^isCharacter}}
본문에 등장하는 장소나 배경을 모두 찾아라.
name: 장소·공간의 고유한 이름(예: 학교 정문, 옥상). 일반 명사 단독(예: 방, 길)은 제외.
description: 배경을 한 줄로 설명(본문 근거).
{{/isCharacter}}
{{#knownNameList}}
다음 이름은 이미 카드로 등록되어 있으니 제외하라: {{knownNameList}}.
{{/knownNameList}}
{{#isCharacter}}
본문에 명시되지 않은 인물은 추측하지 말 것.
{{/isCharacter}}
{{^isCharacter}}
본문에 명시되지 않은 배경은 추측하지 말 것.
{{/isCharacter}}
설명 없이 JSON 배열만 출력하라.
[{"name":""{{#isCharacter}},"role":"extra"{{/isCharacter}},"description":""}]

## system:xs
본문에 등장하는 {{#isCharacter}}인물{{/isCharacter}}{{^isCharacter}}장소/배경{{/isCharacter}}을 JSON 배열로: [{"name":""{{#isCharacter}},"role":"extra"{{/isCharacter}},"description":""}]. {{#knownNameList}}다음 이름은 이미 카드로 등록되어 있으니 제외하라: {{knownNameList}}.{{/knownNameList}} 본문에 없는 건 추측하지 말 것.

## user
[본문]
{{body}}

## user:xs
{{body}}
