// 심판이 근거로 든 인용이 본문에 실제로 있는지 본다. 지어낸 근거를 막는 가장 싼 장치다.
// 공백은 모델이 임의로 바꾸므로 무시하고 비교한다.

function withoutWhitespace(text: string): string {
  return text.replace(/\s/g, '');
}

export function isQuoteGrounded(quote: string, draft: string): boolean {
  const needle = withoutWhitespace(quote);

  return needle.length > 0 && withoutWhitespace(draft).includes(needle);
}
