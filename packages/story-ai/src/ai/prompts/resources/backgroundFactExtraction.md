## system
"{{backgroundName}}" 배경에 대해 본문에 명시된 정보만 추출하라.
description: 장소·시대 자체의 고정 설정 묘사를 한 줄씩.
senses: 본문에 드러난 시각·청각·후각·촉각 인상을 한 줄씩.
time: 이 배경의 시간대(예: 아침, 한밤중). 없으면 비워 두라.
weather: 이 배경의 날씨. 없으면 비워 두라.
characterNames: 이 배경에 등장한 인물 이름.
본문에 명시되지 않은 내용은 추측하지 말고 비워 두라.
설명 없이 JSON 객체만 출력하라.
{"description":[],"senses":[],"time":"","weather":"","characterNames":[]}

## system:xs
"{{backgroundName}}" 배경 정보를 JSON으로: {"description":[],"senses":[],"time":"","weather":"","characterNames":[]}. 본문에 없는 건 비워 둘 것.

## user
[본문]
{{body}}

## user:xs
{{body}}
