// NOTE: 심판은 인용 안에 본문의 따옴표를 그대로 넣어 JSON 을 깨뜨린다 — «"유하람이 "폐기됐다"고 대답한다"».
// 실측에서 그렇게 깨진 답 하나가 독자의 판정(2화에서 덮음)을 통째로 잃게 했다. 답의 모양은 우리가
// 정한 고정된 틀이므로, 엄격한 JSON 이 실패하면 틀에 맞춰 필드를 잘라내어 살린다. 지어내지는 않는다:
// 필드가 하나라도 없으면 그대로 실패다.

// 심판은 JSON 문자열을 곧은 따옴표 대신 굽은 따옴표(”)로 닫기도 한다 — «"…\\"”». 틀을 자르기 전에
// 굽은 겹따옴표를 곧은 것으로 접는다. 값 안의 따옴표 모양은 인용 검사가 어차피 접는다.
function foldQuotes(text: string): string {
  return text.replace(/[“”]/g, '"');
}

function unescapeJsonString(text: string): string {
  return text.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
}

// `"key": "` 뒤부터 다음 필드(`",\s*"nextKey"`) 또는 닫는 `"\s*}` 앞까지가 값이다.
function stringField(text: string, key: string, nextKey: string | undefined): string | undefined {
  const start = new RegExp(`"${key}"\\s*:\\s*"`, 'u').exec(text);

  if (start === null) {
    return undefined;
  }

  const from = start.index + start[0].length;
  const terminator =
    nextKey === undefined
      ? /"\s*\}\s*(```)?\s*$/u
      : new RegExp(`"\\s*,\\s*"${nextKey}"\\s*:`, 'u');
  const rest = text.slice(from);
  const end = terminator.exec(rest);

  if (end !== null) {
    return unescapeJsonString(rest.slice(0, end.index));
  }

  // 마지막 필드는 답이 끊겨 닫는 따옴표와 괄호가 없을 수 있다 — 실측에서 인용 중간에 끊긴 답이 있었다.
  // 남은 글 전부를 값으로 본다. 인용은 어차피 본문 대조를 거치므로 지어낸 값이 들어올 길은 없다.
  if (nextKey === undefined) {
    const tail = unescapeJsonString(rest.replace(/```\s*$/u, '').trim());
    return tail.length === 0 ? undefined : tail;
  }

  return undefined;
}

export interface LenientTurn {
  readonly engagement: number;
  readonly continueReading: boolean;
  readonly reason: string;
  readonly quote: string;
}

export function readTurnLeniently(raw: string): LenientTurn | null {
  const text = foldQuotes(raw);
  const engagement = /"engagement"\s*:\s*(-?\d+(?:\.\d+)?)/u.exec(text);
  const continueReading = /"continueReading"\s*:\s*(true|false)/u.exec(text);
  const reason = stringField(text, 'reason', 'quote');
  const quote = stringField(text, 'quote', undefined);

  if (engagement === null || continueReading === null || reason === undefined || quote === undefined) {
    return null;
  }

  return {
    engagement: Number(engagement[1]),
    continueReading: continueReading[1] === 'true',
    reason,
    quote,
  };
}

export function readQuoteLeniently(raw: string): { readonly quote: string } | null {
  const quote = stringField(foldQuotes(raw), 'quote', undefined);
  return quote === undefined ? null : { quote };
}

// 순위 답은 결함 문장(notes) 이 깨져도 ranking 배열만 온전하면 읽는다.
export function readRankingLeniently(raw: string): { readonly ranking: readonly string[] } | null {
  const text = foldQuotes(raw);
  const match = /"ranking"\s*:\s*\[([^\]]*)\]/u.exec(text);

  if (match === null) {
    return null;
  }

  const ranking = [...(match[1] as string).matchAll(/"([^"]*)"/gu)].map((entry) => entry[1] as string);
  return ranking.length === 0 ? null : { ranking };
}
