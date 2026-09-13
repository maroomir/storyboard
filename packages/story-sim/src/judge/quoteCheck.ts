// 심판이 근거로 든 인용이 본문에 실제로 있는지 본다. 지어낸 근거를 막는 가장 싼 장치다.
// 공백은 모델이 임의로 바꾸므로 무시하고 비교한다.

// NOTE: 생성 모델은 대사를 굽은 따옴표로 쓰고, 심판은 JSON 으로 답하면서 곧은 따옴표로 옮긴다.
// 글자가 그대로인 인용이 따옴표 모양 하나 때문에 «지어낸 근거» 로 몰리면 그 독자는 거기서 끊기고,
// 공통 독자가 하나라도 빠지면 회차 전체가 버려진다. 표기 차이는 흡수하되 속살이 다른 인용은
// 그대로 걸러야 하므로, 따옴표류만 한 모양으로 모은다.
const quoteFolding: readonly (readonly [RegExp, string])[] = [
  [/[“”„‟«»〝〞]/g, '"'],
  [/[‘’‚‛‹›]/g, "'"],
];

function normalize(text: string): string {
  return quoteFolding.reduce(
    (folded, [pattern, replacement]) => folded.replace(pattern, replacement),
    text.replace(/\s/g, ''),
  );
}

export function isQuoteGrounded(quote: string, draft: string): boolean {
  const needle = normalize(quote);

  return needle.length > 0 && normalize(draft).includes(needle);
}
