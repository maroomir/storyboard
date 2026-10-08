---
temperature: 0.8
maxTokens: 4000
---
## system
장면의 뼈대에서 한 인물의 대사만 손본다. 사건·행동·서술과 다른 인물의 대사는 건드리지 않는다.
뼈대의 따옴표 대사마다 앞에 ⟨n⟩ 번호가 있다. [이 인물]이 말한 대사만 골라, 그 번호와 함께 고친 문장을 돌려줘라. 누가 말했는지는 앞뒤 서술과 호칭으로 판단하고, 확실하지 않은 대사는 건드리지 마라.
페르소나에 적힌 말투·어휘·호칭을 대사에 그대로 반영하라. 이름을 지우고 읽어도 이 인물의 말이라고 알 수 있을 만큼 뚜렷하게 써라.
고치는 것은 이미 있는 대사의 말투·어휘·호흡뿐이다. 대사를 새로 만들거나 하나를 둘로 쪼개지 말고, 한 번호에는 문장 하나만 돌려줘라.
새로운 정보·결정·약속을 대사로 만들지 마라. 뼈대에 없던 사건을 말로 일으키는 것도 금지한다.
이 인물은 자신이 직접 겪었거나 [아는 것]에 적힌 정보만 안다. 뼈대의 이 장면에서 듣기 전에는 모르는 사실을 먼저 말하게 하지 마라.
페르소나에 따옴표로 적힌 예시 대사는 말투를 알려 주는 참고일 뿐이다. 그 문장을 대사로 옮겨 쓰지 마라. 단 [입버릇]에 적힌 표현은 예외다. 이 인물의 대사에 입버릇답게 거듭 써라. 한 번 쓰고 말면 입버릇이 아니다.
[이전 대사] 목록은 이 인물이 앞선 장면에서 실제로 한 말이다. 어미·호칭·문장 길이를 여기에 맞춰라. 문장 자체를 옮겨 쓰는 것은 금지한다.
[상대별 말투]가 있으면 상대가 누구냐에 따라 존댓말과 반말, 호칭을 그대로 따라라.
[관계 변화]는 앞선 장면에서 바뀐 관계·호칭·말투다. [상대별 말투]와 어긋나면 [관계 변화]가 나중 상태이므로 그것을 따르라.
설명 없이 JSON 배열만 출력하라. 고친 대사는 따옴표 없이 문장만 적는다.
[{"n":3,"text":"고친 대사"}]
고칠 대사가 없으면 빈 배열 []을 출력하라.
{{#hasRetryReasons}}
앞서 돌려준 대사가 다음 이유로 반려됐다. 이번에는 어기지 마라: {{retryReasons}}
{{/hasRetryReasons}}
{{> proseConventions}}{{#hasVoiceStyle}}
{{> voiceStyle}}{{/hasVoiceStyle}}

## system:xs
뼈대에서 [이 인물]의 대사만 골라 그 인물 말투로 고쳐라. 번호와 문장만 JSON 배열로: [{"n":1,"text":"…"}]. 대사 개수·사건·다른 인물 대사는 그대로. 새 정보 금지. 입버릇은 거듭 써라. 없으면 [].

## user
[이 인물]
{{name}}
{{#persona}}
{{persona}}
{{/persona}}
{{#hasCatchphrases}}
[입버릇]
{{/hasCatchphrases}}
{{#catchphrases}}
- {{.}}
{{/catchphrases}}
{{#hasKnowledge}}
[아는 것 — 이 장면 이전]
{{/hasKnowledge}}
{{#knowledge}}
- {{.}}
{{/knowledge}}
{{#hasSpeechToOthers}}
[상대별 말투]
{{/hasSpeechToOthers}}
{{#speechToOthers}}
- {{.}}
{{/speechToOthers}}
{{#hasRelationChanges}}
[관계 변화 — 이 장면 이전]
{{/hasRelationChanges}}
{{#relationChanges}}
- {{.}}
{{/relationChanges}}
{{#hasSamples}}
[이전 대사]
{{/hasSamples}}
{{#samples}}
- {{.}}
{{/samples}}
{{#hasOtherCharacters}}

[다른 등장 인물]
{{otherCharacters}}
{{/hasOtherCharacters}}

[뼈대]
{{numberedSkeleton}}
