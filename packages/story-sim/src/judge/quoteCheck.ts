// 심판이 근거로 든 인용이 본문에 실제로 있는지 본다. 지어낸 근거를 막는 가장 싼 장치다.
// 공백은 모델이 임의로 바꾸므로 무시하고 비교한다.

// NOTE: 생성 모델은 대사를 굽은 따옴표로 쓰고, 심판은 JSON 으로 답하면서 곧은 따옴표로 옮긴다.
// 글자가 그대로인 인용이 따옴표 모양 하나 때문에 «지어낸 근거» 로 몰리면 그 독자는 거기서 끊기고,
// 공통 독자가 하나라도 빠지면 회차 전체가 버려진다. 표기 차이는 흡수하되 속살이 다른 인용은
// 그대로 걸러야 하므로, 따옴표류만 한 모양으로 모은다.
// 꺾쇠 「」『』 도 같은 이유로 접는다. 생성 모델은 한 회차 안에서도 5화까지 곧은 따옴표를 쓰다가
// 6화부터 꺾쇠로 바꿔 쓴 적이 있다.
// 홑따옴표와 겹따옴표도 한 모양으로 모은다. 본문이 '신문의 생존' 이라 쓴 것을 심판이 "신문의 생존" 으로
// 옮긴 일이 있었다. 따옴표 종류는 인용의 속살이 아니다.
const quoteFolding: readonly (readonly [RegExp, string])[] = [
  [/[“”„‟«»〝〞「」『』‘’‚‛‹›']/g, '"'],
];

// NOTE: 생성 모델은 문장을 굵게(**…**) 감싸 쓰기도 한다. 심판은 그 표시를 옮기지 않으므로 비교에서 뺀다.
function normalize(text: string): string {
  return quoteFolding.reduce(
    (folded, [pattern, replacement]) => folded.replace(pattern, replacement),
    text.replace(/\s/g, '').replace(/\*/g, ''),
  );
}

// 심판은 서술문을 인용할 때도 따옴표로 감싸 답한다("그 흉터는 …"). 본문에는 그 따옴표가 없으니
// 감싼 한 겹만 벗기고도 찾아본다. 실측에서 독자 셋이 같은 문장으로 한꺼번에 막혔다.
function unwrapped(needle: string): string {
  const match = /^(")(.*)\1$/.exec(needle);
  return match === null ? needle : (match[2] as string);
}

// NOTE: 심판은 가까운 문장 셋을 하나로 이어 인용하기도 한다. 조각마다 본문에 그대로 있는데 이어진
// 순서만 본문과 다른 경우다. 실측에서 그런 인용으로 회차가 버려졌다. 문장 단위 조각이 전부 본문에
// 있으면 근거로 본다 — 조각 하나라도 없으면(지어낸 문장이 섞이면) 여전히 걸린다. 조각은 되묻기 안내와
// 같은 기준으로 짧은 것(4자 미만)은 세지 않되, 그런 조각만 남는 인용은 근거가 아니다.
const pieceBoundary = /(?<=[.!?…"])\s*/u;
const minimumPieceLength = 4;

function piecesOf(quote: string): readonly string[] {
  return quote
    .split(pieceBoundary)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);
}

export function isQuoteGrounded(quote: string, draft: string): boolean {
  const needle = normalize(quote);
  const haystack = normalize(draft);
  const inner = unwrapped(needle);

  if (needle.length === 0) {
    return false;
  }

  if (haystack.includes(needle) || (inner.length > 0 && haystack.includes(inner))) {
    return true;
  }

  const pieces = piecesOf(quote)
    .map((piece) => unwrapped(normalize(piece)))
    .filter((piece) => piece.length >= minimumPieceLength);

  return pieces.length > 1 && pieces.every((piece) => haystack.includes(piece));
}
