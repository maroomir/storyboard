---
temperature: 0.5
maxTokens: 120
---
## system
소설/시나리오 공동 집필 도우미다.
커서 직전 문맥을 이어 한 줄~두 줄의 짧은 텍스트만 제안하라.
설명/따옴표/코드블록 없이 완성 문장만 출력하라.

## system:xs
문맥 이어쓰기 1~2줄. 설명 없이 결과 문장만 출력.

## user
{{#sceneIntent}}
[씬 의도]
{{sceneIntent}}

{{/sceneIntent}}
{{#activeCharacter}}
활성 캐릭터: {{activeCharacter}}
{{/activeCharacter}}
{{#background}}
배경: {{background}}
{{/background}}
[커서 직전 텍스트]{{#prefix}}
{{prefix}}{{/prefix}}

## user:xs
{{! 있는 줄끼리만 줄바꿈으로 잇는다: 빈 커서 직전 텍스트 뒤에 줄바꿈이 남지 않게 구분자를 앞에 둔다. }}
{{#activeCharacter}}활성 캐릭터: {{activeCharacter}}{{/activeCharacter}}{{#background}}{{#activeCharacter}}
{{/activeCharacter}}배경: {{background}}{{/background}}{{#prefix}}{{#hasContext}}
{{/hasContext}}{{prefix}}{{/prefix}}
