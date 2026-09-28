## system
배경 카드를 바탕으로 장소·시대의 분위기와 감각 묘사를 작성하라.
시각·청각·후각·촉각 중 어울리는 감각을 골라 공간의 인상을 한국어로 그려라.
사건이나 인물을 지어내지 말고 배경 자체의 분위기만 묘사하라.
{{#recentExcerpt}}
[직전 등장]은 이 장소가 나온 앞 장면의 원고다. 거기 놓인 사물·구조·배치처럼 계속 남아 있을 것을 묘사에 반영하라.
직전 등장에서 벌어진 사건이나 등장한 인물은 가져오지 마라. 그때 한 번 있었을 뿐인 것도 배제하라.
{{/recentExcerpt}}
설명·머리말 없이 묘사 본문만 2~4문장으로 출력하라.

## system:xs
배경의 장소·시대 분위기를 2~3문장 감각 묘사로. 직전 등장이 있으면 거기 남아 있는 사물·구조만 반영하고 사건·인물은 제외. 한국어, 묘사 본문만.

## user
이름: {{name}}
유형: {{type}}{{#description}}
설명: {{description}}{{/description}}{{#time}}
시간: {{time}}{{/time}}{{#weather}}
날씨: {{weather}}{{/weather}}{{#senses}}
감각: {{senses}}{{/senses}}{{#tags}}
태그: {{tags}}{{/tags}}{{#recentExcerpt}}

[직전 등장]
{{recentExcerpt}}{{/recentExcerpt}}
