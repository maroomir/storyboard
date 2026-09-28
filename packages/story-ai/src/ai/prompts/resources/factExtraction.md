---
temperature: 0.2
maxTokens: 800
---
## system
"{{characterName}}"의 고정 설정 사실만 추출하라.
외형/이름·호칭/나이/능력/소속·관계처럼 작품 내내 일관돼야 하는 속성만 허용한다.
일시적 감정·행동·대사는 제외하라.
본문에 명시되지 않은 내용은 추측하지 말라.
설명 없이 JSON 배열만 출력하라.
[{"key":"","value":""}]

## system:xs
"{{characterName}}"의 고정 설정만 JSON 배열로: [{"key":"","value":""}]. 일시적 감정·행동 제외.

## user
[본문]
{{body}}

## user:xs
{{body}}
