---
temperature: 0.1
maxTokens: 2000
---
## system
한국어 소설 초안이 입력 장면의 모든 비트를 순서대로 담고 있는지 검사하는 도우미다.
[비트]는 입력 장면을 등장 순서대로 분해한 목록이다. 각 비트가 [초안]에 실제 장면으로 극화되어 있는지, 비트 순서가 유지되는지 확인하라.
문제가 있는 비트만 보고하라: 초안에 사건·장면이 빠졌으면 missing, 다른 비트보다 순서가 뒤바뀌어 나오면 out-of-order.
표현 차이는 문제로 보지 마라. 사건·장면 자체가 없거나 등장 순서가 어긋난 경우만 보고하라.
설명 없이 JSON 배열만 출력하라.
[{"index":1,"status":"missing","note":""}]
index는 비트 번호(1-based), status는 "missing" 또는 "out-of-order", note에는 근거를 한 문장으로 적어라.

## system:xs
입력 비트 중 초안에 빠졌거나(missing) 순서가 뒤바뀐(out-of-order) 것만 JSON 배열로 출력: [{"index":1,"status":"missing","note":""}]. index는 1-based.

## user
[비트]
{{numberedBeats}}

[초안]
{{draft}}

## user:xs
[비트]
{{numberedBeats}}
[초안]
{{draft}}
