import { describe, expect, it } from 'vitest';

import {
  buildCritique,
  commonReaders,
  corruptManuscript,
  criticCriteria,
  evaluateFloorGate,
  joinManuscript,
  judgeManuscript,
  readCritiqueLeniently,
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

describe('engagement mean', () => {
  // 덮음과 무관한 둘째 눈금. 심판이 짤수록 AUC 는 0 에 뭉치지만 몰입도 평균은 남는다.
  it('averages engagement over every scene read, ignoring the intention to quit', () => {
    const turns = [turn('01', 3, false), turn('02', 2), turn('03', 4)];
    const result = panelAuc([curve('r1', turns)], 3);

    expect(result.byReader['r1']).toBeCloseTo(0.6 / 3);
    expect(result.engagementByReader['r1']).toBeCloseTo((3 + 2 + 4) / 5 / 3);
    expect(result.engagement).toBeCloseTo((3 + 2 + 4) / 5 / 3);
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

describe('reader panel makeup', () => {
  // 2026-09 에 개연성·핍진성·감정·동기 독자를 더했다. AUC 는 여덟 독자의 평균이다.
  it('has eight common readers, each watching one thing', () => {
    expect(commonReaders.map((reader) => reader.id)).toEqual([
      'pace', 'prose', 'canon', 'pov', 'cause', 'world', 'feeling', 'motive',
    ]);
    expect(new Set(commonReaders.map((reader) => reader.watches)).size).toBe(8);
  });
});

describe('manuscript critic', () => {
  const scenes = [
    { sceneStem: '01-a', draft: '---\nsceneStem: 01-a\n---\n서지운은 문을 열었다.\n\n한도경이 웃었다.' },
    { sceneStem: '02-b', draft: '서지운이 물었다.\n\n한도경은 답하지 않았다.' },
  ];

  it('joins the scenes into one manuscript without their front matter', () => {
    const manuscript = joinManuscript(scenes);

    expect(manuscript).toContain('## 1화 (01-a)');
    expect(manuscript).not.toContain('sceneStem:');
    expect(manuscript).toContain('서지운은 문을 열었다.');
  });

  // 비평가의 눈금을 믿으려면 망가진 원고를 낮게 주는지 봐야 한다. 훼손본은 사람이 새로 쓰지 않고 기계가 부순다.
  it('corrupts the manuscript deterministically with swapped names and leftover notes', () => {
    const once = corruptManuscript(scenes, ['서지운', '한도경']);
    const twice = corruptManuscript(scenes, ['서지운', '한도경']);

    expect(once).toBe(twice);
    expect(once).toContain('한도경은 문을 열었다.');
    expect(once).toContain('서지운이 웃었다.');
    expect(once).toContain('[작가 메모');
    expect(once).not.toBe(joinManuscript(scenes));
    // 마지막 화는 첫 문단만 남아 결말이 사라진다.
    const lastScene = once.split('## 2화')[1] ?? '';
    expect(lastScene.split(/\n{2,}/u).filter((line) => line.trim().length > 0)).toHaveLength(2);
  });

  it('asks for a quote only on criteria a sentence can prove', () => {
    const grounded = criticCriteria.find((criterion) => criterion.id === 'payoff');
    const opinion = criticCriteria.find((criterion) => criterion.id === 'theme');
    const withQuote = buildCritique({ genre: '스릴러', manuscript: '본문', criterion: grounded! });
    const withoutQuote = buildCritique({ genre: '스릴러', manuscript: '본문', criterion: opinion! });

    expect(withQuote.at(-1)?.content).toContain('"quote"');
    expect(withoutQuote.at(-1)?.content).not.toContain('"quote"');
    expect(withoutQuote.at(-1)?.content).toContain('인용 없이');
    // 원고까지는 기준 여섯 개에 똑같아야 접두 캐시가 맞는다. 기준은 원고 뒤에만 나온다.
    expect(withQuote.slice(0, 2)).toEqual(withoutQuote.slice(0, 2));
    expect(withQuote[1]).toEqual({ role: 'user', content: '본문', cacheBoundary: true });
    // 점수의 뜻이 앞에 못박혀 있되, 훼손의 종류는 적지 않는다. 적으면 심판이 멀쩡한 원고에서도 그것을 찾아낸다.
    expect(withQuote[0]?.content).toContain('0: 기준을 전혀 못 지켰다');
    expect(withQuote[0]?.content).not.toContain('작가 메모');
  });

  it('scores the six criteria, marks opinions, and gates on the corrupted manuscript', async () => {
    let call = 0;
    const judge = {
      providerId: 'ollama' as const,
      model: 'gemma3:12b',
      ask: async (messages: readonly { content: string }[]) => {
        call += 1;
        const isCorrupted = messages.some((message) => message.content.includes('[작가 메모'));
        const score = isCorrupted ? 1 : 4;
        return {
          providerId: 'ollama' as const,
          model: 'gemma3:12b',
          text: JSON.stringify({ score, reason: '이유', quote: '서지운은 문을 열었다.' }),
        } as never;
      },
      usage: () => [],
    };

    const verdict = await judgeManuscript({ judge, genre: '스릴러', scenes, names: ['서지운', '한도경'] });

    expect(call).toBe(12);
    expect(verdict.scores).toHaveLength(6);
    expect(verdict.groundedTotal).toBe(16);
    expect(verdict.opinionTotal).toBe(8);
    expect(verdict.scores.filter((entry) => entry.opinion).map((entry) => entry.criterion)).toEqual([
      'theme',
      'originality',
    ]);
    // 16 - 4 = 12 ≥ 최소 격차 2.
    expect(verdict.gate.passed).toBe(true);
    expect(verdict.gate.corruptedGroundedTotal).toBe(4);
  });

  // 훼손본이 늘 8점을 받아 2~4점 차이로 관문을 넘던 일이 있었다. 인용 기준 넷에서 한 점씩은 벌어져야 한다.
  it('fails the gate when the corrupted manuscript scores within the margin', async () => {
    const judge = {
      providerId: 'ollama' as const,
      model: 'gemma3:12b',
      ask: async (messages: readonly { content: string }[]) => {
        const isCorrupted = messages.some((message) => message.content.includes('[작가 메모'));
        return {
          providerId: 'ollama' as const,
          model: 'gemma3:12b',
          text: JSON.stringify({ score: isCorrupted ? 2 : 3, reason: '이유', quote: '서지운은 문을 열었다.' }),
        } as never;
      },
      usage: () => [],
    };

    const verdict = await judgeManuscript({ judge, genre: '스릴러', scenes, names: ['서지운', '한도경'] });

    expect(verdict.groundedTotal - verdict.gate.corruptedGroundedTotal).toBe(4);
    expect(verdict.gate.passed).toBe(true);
    // 격차 1 이면 막힌다: 훼손본의 첫 기준(인물 아크)만 2점, 나머지는 생성본과 같은 3점을 받는다.
    let corruptedCalls = 0;
    const narrow = await judgeManuscript({
      judge: {
        ...judge,
        ask: async (messages: readonly { content: string }[]) => {
          const isCorrupted = messages.some((message) => message.content.includes('[작가 메모'));
          if (isCorrupted) corruptedCalls += 1;
          const score = isCorrupted ? (corruptedCalls === 1 ? 2 : 3) : 3;
          return { providerId: 'ollama', model: 'gemma3:12b', text: JSON.stringify({ score, reason: '이유', quote: '서지운은 문을 열었다.' }) } as never;
        },
      },
      genre: '스릴러',
      scenes,
      names: ['서지운', '한도경'],
    });
    expect(narrow.gate.passed).toBe(false);
  });

  it('marks a grounded criterion as opinion when its quote is not in the manuscript', async () => {
    const judge = {
      providerId: 'ollama' as const,
      model: 'gemma3:12b',
      ask: async () =>
        ({ providerId: 'ollama', model: 'gemma3:12b', text: '{ "score": 3, "reason": "이유", "quote": "없는 문장" }' }) as never,
      usage: () => [],
    };

    const verdict = await judgeManuscript({ judge, genre: '스릴러', scenes, names: [] });

    expect(verdict.scores.find((entry) => entry.criterion === 'arc')?.ungrounded).toBe(true);
    expect(verdict.gate.passed).toBe(false);
  });

  it('reads a critique whose JSON broke', () => {
    expect(readCritiqueLeniently('```json\n{ "score": 4, "reason": "그는 "문"을 열었다" }\n```')).toEqual({
      score: 4,
      reason: '그는 "문"을 열었다',
    });
  });
});
