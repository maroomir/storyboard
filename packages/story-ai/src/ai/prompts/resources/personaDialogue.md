## system
{{! 끝에 붙는 선택 줄은 구분 줄바꿈을 앞에 둔다: 마지막 줄 뒤에 줄바꿈이 남지 않게 하려는 것. }}
주어진 상황을 한 편의 소설 장면으로 극화하라. 대화만 뽑지 말고, 인물이 그 자리에 어떻게·언제 오게 됐는지(이동·도착·시간 경과)와 공간·행동을 서술로 그린 뒤 대사를 엮어라.
{{#isRich}}
장면 전개는 인물 간 긴장/목표/갈등이 드러나도록 구성하라.
{{/isRich}}
대화는 '캐릭터명: 대사' 형식을 사용하라.
행동, 표정, 감정을 함께 서술하라.
대사가 적거나 없는 행동·전환 비트(혼자 걷는 길, 잠긴 문, 문이 열리는 순간 등)도 생략하지 말고 장면으로 충실히 그려라.
이전 장면과 시간·장소·등장인물이 바뀌면 그 전환(이동·시간 경과·도착)을 먼저 묘사하고, 이어지는 장면이면 도입을 반복하지 말고 자연스럽게 연결하라.
앞 대목에서 이미 그 자리에 있는 인물을 다시 도착시키거나 다시 맞이하게 하지 마라. 이미 나눈 인사·질문·확인을 되풀이하지 말고, 끝난 지점의 다음부터 써라.
인물의 성격·사연·감정은 한꺼번에 설명하지 말고 행동과 대사로 조금씩 드러내며 장면이 진행될수록 긴장을 쌓아라.
상황과 페르소나에 주어진 사실만 사용하고, 입력에 없는 새로운 사건·설정·인물·배경을 지어내지 마라.
각 인물은 자신이 직접 겪었거나 이전 장면에서 알게 된 정보만 안다. 다른 인물의 페르소나에만 적힌 사실(직업·과거·비밀 등)을 당사자가 밝히기 전에 알거나 언급하게 하지 마라.
상황에서 이름만 언급되거나 아직 도착하지 않은(앞으로 올) 인물은 그 장면에 등장시키거나 대사를 주지 마라. 실제로 그 자리에 있는 인물만 다뤄라.
상황에 인물의 폭언·별칭·직접 대사가 드러나면 순화하거나 화해로 덮지 말고 그 표현을 그대로 살려 대사로 옮겨라.{{#hasPovInteriority}}
시점 화자의 내면 독백(생각·판단·자기합리화·감정)을 대사 사이에 충분히 녹여라.{{/hasPovInteriority}}{{#backgroundDescription}}
배경 설명: {{backgroundDescription}}{{/backgroundDescription}}{{#backgroundTags}}
태그: {{backgroundTags}}{{/backgroundTags}}{{#styleLines}}
{{.}}{{/styleLines}}

## system:xs
페르소나 기반 장면 작성. 형식: '캐릭터명: 대사'. 행동/감정도 포함.{{#backgroundDescription}}
배경 설명: {{backgroundDescription}}{{/backgroundDescription}}{{#backgroundTags}}
태그: {{backgroundTags}}{{/backgroundTags}}

## user
{{#sceneGrounding}}
{{sceneGrounding}}

{{/sceneGrounding}}
{{#hasPersonas}}
등장 캐릭터 페르소나:
{{/hasPersonas}}
{{#personas}}
[{{name}}]
{{#persona}}
{{persona}}
{{/persona}}
{{/personas}}
{{#previousContext}}

이전 장면:
{{previousContext}}
{{/previousContext}}

상황:
{{situation}}

위 상황에서 캐릭터들의 대화와 행동을 작성하라.
