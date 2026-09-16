import { describe, expect, it } from 'vitest';

import {
  evaluateFloorGate,
  isQuoteGrounded,
  readQuoteLeniently,
  readRankingLeniently,
  readTurnLeniently,
  panelAuc,
  readerAuc,
  weightsOf,
  type ReaderCurve,
} from '@storyboard/story-sim';

// AUC 는 리포트의 첫 숫자다. 중도 이탈을 0으로 안 채우면 덮은 독자가 끝까지 읽은 것으로 계산된다.

function turn(sceneStem: string, engagement: number, continueReading = true) {
  return { sceneStem, engagement, continueReading, reason: '이유', quote: '인용' };
}

function curve(readerId: string, turns: ReturnType<typeof turn>[]): ReaderCurve {
  return { readerId, turns };
}

describe('drop-off curve', () => {
  it('scores a reader who finishes at full engagement as 1', () => {
    const turns = Array.from({ length: 8 }, (_, index) => turn(`0${index + 1}`, 5));

    expect(readerAuc(curve('r1', turns), 8)).toBe(1);
  });

  // 3씬에서 덮은 독자는 4~8씬에 0을 채워야 한다. 안 그러면 이탈이 점수에 안 나타난다.
  it('fills zeros for every scene at or after the reader stopped', () => {
    const turns = [turn('01', 5), turn('02', 5), turn('03', 5, false)];

    expect(weightsOf(curve('r1', turns), 8)).toEqual([1, 1, 1, 0, 0, 0, 0, 0]);
    expect(readerAuc(curve('r1', turns), 8)).toBeCloseTo(3 / 8);
  });

  it('treats a missing turn as a zero rather than a gap', () => {
    expect(weightsOf(curve('r1', [turn('01', 5)]), 4)).toEqual([1, 0, 0, 0]);
  });

  it('clamps an engagement the judge returned out of range', () => {
    expect(weightsOf(curve('r1', [turn('01', 99), turn('02', -3)]), 2)).toEqual([1, 0]);
  });
});

describe('panel AUC', () => {
  const finished = Array.from({ length: 8 }, (_, index) => turn(`0${index + 1}`, 5));
  const quitEarly = [turn('01', 5), turn('02', 5), turn('03', 5, false)];

  it('averages the common readers', () => {
    const result = panelAuc(
      [curve('a', finished), curve('b', finished), curve('c', finished), curve('d', quitEarly)],
      8,
    );

    expect(result.auc).toBeCloseTo((1 + 1 + 1 + 3 / 8) / 4);
  });

  // 스칼라 하나로는 «넷 다 미지근»과 «셋은 좋고 하나가 일찍 덮음»이 구분되지 않는다.
  it('keeps the per-reader curves and the drop-off scene beside the scalar', () => {
    const lukewarm = Array.from({ length: 8 }, (_, index) => turn(`0${index + 1}`, 2));
    const spread = panelAuc(
      [curve('a', finished), curve('b', finished), curve('c', finished), curve('d', quitEarly)],
      8,
    );
    const flat = panelAuc(
      [curve('a', lukewarm), curve('b', lukewarm), curve('c', lukewarm), curve('d', lukewarm)],
      8,
    );

    expect(flat.auc).toBeCloseTo(0.4);
    expect(spread.dropOffScene['d']).toBe('03');
    expect(flat.dropOffScene['d']).toBeUndefined();
    expect(spread.byReader['a']).toBe(1);
  });

  it('returns zero for an empty panel rather than a NaN', () => {
    expect(panelAuc([], 8).auc).toBe(0);
  });
});

describe('floor gate', () => {
  const good = ['generated', 'floor'] as const;
  const bad = ['floor', 'generated'] as const;

  it('passes when every reader put the corrupted draft last in both orders', () => {
    const result = evaluateFloorGate([
      { readerId: 'a', rankings: [good, good] },
      { readerId: 'b', rankings: [good, good] },
    ]);

    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.abstained).toEqual([]);
  });

  // 한 명이라도 양쪽 차례에서 훼손본을 위로 올리면 그 회차의 눈금을 믿을 수 없다.
  it('fails and names the reader who consistently did not', () => {
    const result = evaluateFloorGate([
      { readerId: 'a', rankings: [good, good] },
      { readerId: 'b', rankings: [bad, bad] },
    ]);

    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain('b');
  });

  // 차례에 따라 답이 바뀐 독자는 자리를 답한 것이다. 판정이 아니므로 어느 쪽에도 세지 않는다.
  it('sets aside a reader whose answer followed the order shown', () => {
    const result = evaluateFloorGate([
      { readerId: 'a', rankings: [good, good] },
      { readerId: 'b', rankings: [good, bad] },
    ]);

    expect(result.passed).toBe(true);
    expect(result.abstained[0]).toContain('b');
  });

  it('does not pass on abstentions alone', () => {
    const result = evaluateFloorGate([
      { readerId: 'a', rankings: [good, bad] },
      { readerId: 'b', rankings: [bad, good] },
    ]);

    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain('자리와 무관하게');
  });

  it('fails when no ranking arrived at all', () => {
    expect(evaluateFloorGate([]).passed).toBe(false);
  });
});

describe('quote grounding', () => {
  it('accepts a quote that differs only in whitespace', () => {
    expect(isQuoteGrounded('문을 열었다', '그는  문을\n열었다.')).toBe(true);
  });

  it('rejects a quote the draft never contained', () => {
    expect(isQuoteGrounded('창문을 닫았다', '그는 문을 열었다.')).toBe(false);
  });

  it('rejects an empty quote', () => {
    expect(isQuoteGrounded('   ', '그는 문을 열었다.')).toBe(false);
  });

  // 실측에서 회차를 통째로 버리게 만든 경우다. 생성은 굽은 따옴표로 쓰고 심판은 곧은 따옴표로
  // 옮겨 답하는데, 글자는 하나도 다르지 않았다.
  it('accepts a quote that differs only in the shape of its quotation marks', () => {
    expect(
      isQuoteGrounded(
        '"그건… 제가 해결해야 할 일입니다." 도경은 말했다.',
        '도경은 고개를 돌리지 않았다. \u201C그건… 제가 해결해야 할 일입니다.\u201D 도경은 말했다.',
      ),
    ).toBe(true);
  });

  it('accepts the fold in the other direction', () => {
    expect(isQuoteGrounded('\u201C문을 열었다\u201D', '그는 "문을 열었다" 고 적었다.')).toBe(true);
  });

  it('folds corner brackets too', () => {
    expect(isQuoteGrounded('"그날은"', '「그날은」 도경이 말한다.')).toBe(true);
    expect(isQuoteGrounded('"그날은"', '『그날은』 도경이 말한다.')).toBe(true);
  });

  it('folds single quotation marks too', () => {
    expect(isQuoteGrounded("'열쇠'", '그는 \u2018열쇠\u2019 라고 불렀다.')).toBe(true);
  });

  // 실측에서 독자 셋이 같은 서술문으로 한꺼번에 막혔다. 심판이 서술문을 따옴표로 감싸 답했고
  // 본문은 그 문장을 굵게(**) 감싸 두고 있었다.
  it('accepts a narrative sentence the judge wrapped in quotation marks', () => {
    expect(
      isQuoteGrounded('"그 흉터는 자국을 남겼다."', '도경은 손을 들었다. **그 흉터는 자국을 남겼다.** 그는 웃었다.'),
    ).toBe(true);
  });

  it('ignores bold markers the generator left in the draft', () => {
    expect(isQuoteGrounded('그 흉터는 자국을 남겼다', '**그 흉터는** 자국을 남겼다.')).toBe(true);
  });

  // 본문이 '신문의 생존' 이라 쓴 것을 심판이 "신문의 생존" 으로 옮겼다. 따옴표 종류는 속살이 아니다.
  it('treats single and double quotation marks as the same mark', () => {
    expect(isQuoteGrounded('"신문의 생존" 그림이 서 있었다.', "그 위의 '신문의 생존' 그림이 서 있었다.")).toBe(
      true,
    );
  });

  it('unwraps only a matching outer pair', () => {
    expect(isQuoteGrounded('"열쇠', '그는 열쇠를 들었다.')).toBe(false);
  });

  // 심판이 가까운 문장 셋을 하나로 이어 인용했다. 조각은 전부 본문에 있었는데 이어진 순서만 달랐다.
  it('accepts a quote stitched from sentences that each exist in the draft', () => {
    const draft =
      '"안전 규정상 들어갈 수… 없어요." 도경이 웃었다. 한도경은 펜스를 향해 몸을 돌리며 말했다. 비가 왔다. "철거는 오늘부터 시작됩니다."';
    const quote =
      '"안전 규정상 들어갈 수… 없어요." 한도경은 펜스를 향해 몸을 돌리며 말했다. "철거는 오늘부터 시작됩니다."';

    expect(isQuoteGrounded(quote, draft)).toBe(true);
  });

  it('still rejects a stitched quote when one sentence was invented', () => {
    const draft = '"안전 규정상 들어갈 수 없어요." 한도경은 펜스를 향해 몸을 돌리며 말했다.';
    const quote = '"안전 규정상 들어갈 수 없어요." 한도경은 창문을 닫았다.';

    expect(isQuoteGrounded(quote, draft)).toBe(false);
  });

  it('does not let tiny fragments pass as grounding', () => {
    expect(isQuoteGrounded('비. 눈. 창문을 닫았다.', '비가 왔다. 눈이 왔다. 그는 문을 열었다.')).toBe(false);
  });

  // 표기를 접는 것이 검사를 무르게 만들면 안 된다. 지어낸 근거는 따옴표를 맞춰도 걸려야 한다.
  it('still rejects a quote whose words the draft never contained', () => {
    expect(isQuoteGrounded('"창문을 닫았다"', '그는 \u201C문을 열었다\u201D.')).toBe(false);
  });
});

describe('lenient judge answers', () => {
  // 실측 그대로다. 인용 안에 본문의 따옴표가 들어가 JSON 이 깨졌고, 2화에서 덮는다는 판정이 사라졌다.
  const broken = [
    '```json',
    '{',
    '  "engagement": 2,',
    '  "continueReading": false,',
    '  "reason": "규정 제7조에 대한 정보가 앞뒤로 바뀌는 설정 충돌이 너무 컸다.",',
    '  "quote": "\\"유하람이 고개를 끄덕이며 "보존 기한이 지난 파일은 폐기됐다"고 대답한다.\\""',
    '}',
    '```',
  ].join('\n');

  it('recovers a turn whose quote carried unescaped quotation marks', () => {
    const turn = readTurnLeniently(broken);

    expect(turn?.engagement).toBe(2);
    expect(turn?.continueReading).toBe(false);
    expect(turn?.reason).toContain('설정 충돌');
    expect(turn?.quote).toBe('"유하람이 고개를 끄덕이며 "보존 기한이 지난 파일은 폐기됐다"고 대답한다."');
  });

  // 실측 그대로다. 심판이 문자열을 곧은 따옴표 대신 굽은 따옴표로 닫아 어느 파서도 끝을 못 찾았다.
  it('recovers a turn whose string was closed with a curly quotation mark', () => {
    const raw = [
      '```json',
      '{',
      '  "engagement": 4,',
      '  "continueReading": true,',
      '  "reason": "사건의 진실을 파헤치려는 지운과 방해하려는 주변 인물들의 대립이 흥미롭다.",',
      '  "quote": "\\"관련 규정 조항에 의거하여 처리되었습니다.\\"”',
      '}',
      '```',
    ].join('\n');
    const turn = readTurnLeniently(raw);

    expect(turn?.engagement).toBe(4);
    expect(turn?.continueReading).toBe(true);
    expect(turn?.quote).toContain('관련 규정 조항에 의거하여 처리되었습니다.');
  });

  // 실측 그대로다. 인용 중간에 답이 끊겨 닫는 따옴표도 괄호도 없었다.
  it('takes a trailing quote to the end when the answer was cut off', () => {
    const raw = [
      '```json',
      '{',
      '  "engagement": 3,',
      '  "continueReading": true,',
      '  "reason": "도경의 숨겨진 과거와 지운의 결정 사이의 미묘한 긴장감이 흥미롭다.",',
      '  "quote": "[도경] "아무도 기억하지 않는 게 낫죠."',
    ].join('\n');
    const turn = readTurnLeniently(raw);

    expect(turn?.engagement).toBe(3);
    expect(turn?.quote).toBe('[도경] "아무도 기억하지 않는 게 낫죠."');
  });

  it('does not invent a field that is missing', () => {
    expect(readTurnLeniently('{ "engagement": 3, "reason": "x" }')).toBeNull();
  });

  it('recovers a repair answer and a ranking with broken notes', () => {
    expect(readQuoteLeniently('{ "quote": "그는 "문"을 열었다" }')?.quote).toBe('그는 "문"을 열었다');
    expect(
      readRankingLeniently('{ "notes": { "가": "그는 "문"을 열었다" }, "ranking": ["나", "가"] }')?.ranking,
    ).toEqual(['나', '가']);
  });
});
