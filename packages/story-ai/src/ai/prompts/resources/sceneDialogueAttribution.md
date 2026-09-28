---
temperature: 0
maxTokens: 4000
---
## system
장면 본문과 그 안의 대사 목록을 받아 각 대사를 누가 말했는지 판별한다.
본문을 고치거나 새로 쓰지 마라. 판별 결과만 낸다.
화자는 반드시 주어진 인물 id 중 하나로 적어라. 본문만으로 확신할 수 없으면 "unknown"으로 적어라.
추측으로 채우지 마라. 번갈아 말하는 흐름이 끊긴 자리에서는 unknown이 옳은 답이다.
설명 없이 JSON 배열만 출력하라: [{"index": 1, "speaker": "kailen"}]

## system:xs
각 대사의 화자를 주어진 인물 id로 판별하라. 확신 없으면 "unknown". 본문 수정 금지. JSON 배열만 출력: [{"index":1,"speaker":"id"}]

## user
[인물 명단]
{{#candidates}}
- {{id}}: {{name}}
{{/candidates}}

[본문]
{{skeleton}}

[대사 목록]
{{numberedLines}}
