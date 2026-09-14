import { describe, expect, it, vi } from 'vitest';

import type { AiGenerateResponse, AiMessage } from '@storyboard/story-ai';
import {
  SelfJudgingError,
  createFactRecallJudge,
  createSimJudge,
  judgeAxis,
  judgeChain,
  labelFloorCandidates,
  parseFactLedger,
  resolveFloorRanking,
  type SimJudge,
} from '@storyboard/story-sim';

// 심판은 돈이 드는 유일한 부분이지만, 무엇을 묻고 무엇을 버리는지는 전부 결정론적으로 잴 수 있다.

const sceneText = '엘리아가 문을 열었다. 비가 내리고 있었다.';

function scenes(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    sceneStem: `0${index + 1}-scene`,
    draft: `${sceneText} (${index + 1}화)`,
  }));
}

// 대본대로 답하는 심판. 실제 호출은 하지 않는다.
function scriptedJudge(reply: (messages: readonly AiMessage[], call: number) => string): SimJudge {
  let call = 0;

  return {
    providerId: 'openai',
    model: 'gpt-5-mini',
    ask: async (messages) => {
      call += 1;
      return { providerId: 'openai', model: 'gpt-5-mini', text: reply(messages, call) } as AiGenerateResponse;
    },
    usage: () => [],
  };
}

function turn(engagement: number, continueReading: boolean, quote = '문을 열었다') {
  return JSON.stringify({ engagement, continueReading, reason: '이유', quote });
}

const floorText = '망가진 원고';

// 심판은 후보의 정체를 모른 채 기호로만 답한다. 보여 준 차례는 독자마다 뒤집히므로, 제대로 읽는
// 심판은 어느 기호 아래에 훼손본이 있는지 본문으로 찾아 그 기호를 꼴찌에 둔다.
function floorShownFirst(messages: readonly AiMessage[]): boolean {
  const prompt = messages.at(-1)?.content ?? '';
  return prompt.indexOf(floorText) < prompt.indexOf(sceneText);
}

function rankFloorLast(messages: readonly AiMessage[]): string {
  return JSON.stringify({ ranking: floorShownFirst(messages) ? ['나', '가'] : ['가', '나'] });
}

function floorCandidates() {
  return [
    { kind: 'generated' as const, draft: sceneText },
    { kind: 'floor' as const, draft: floorText },
  ];
}

describe('judge selection', () => {
  it('refuses a judge running the same weights as the generator', () => {
    expect(() =>
      createSimJudge({
        registry: {} as never,
        judge: { providerId: 'claude', model: 'claude-sonnet-5' },
        generation: { providerId: 'claude', model: 'claude-sonnet-5' },
      }),
    ).toThrow(SelfJudgingError);
  });

  // 로컬 런타임 하나에 qwen 과 gemma 를 올려 두는 것은 자기채점이 아니다.
  it('allows two different models on one local runtime', () => {
    expect(() =>
      createSimJudge({
        registry: {} as never,
        judge: { providerId: 'ollama', model: 'gemma3:12b' },
        generation: { providerId: 'ollama', model: 'qwen3:14b' },
      }),
    ).not.toThrow();
  });

  it('allows the same model only when the caller says so out loud', () => {
    expect(() =>
      createSimJudge({
        registry: {} as never,
        judge: { providerId: 'claude', model: 'claude-sonnet-5' },
        generation: { providerId: 'claude', model: 'claude-sonnet-5' },
        allowSelfJudging: true,
      }),
    ).not.toThrow();
  });
});

describe('floor gate runs first', () => {
  // 망가진 심판이 패널 전체가 아니라 네 번만 축내야 한다.
  it('stops after the ranking round when a reader ranks the floor above the draft', async () => {
    const ask = vi.fn(
      async () =>
        ({ text: JSON.stringify({ ranking: ['나', '가'] }) }) as AiGenerateResponse,
    );
    const judge: SimJudge = { providerId: 'openai', model: 'gpt-5-mini', ask, usage: () => [] };

    const verdict = await judgeChain({
      judge,
      scenes: scenes(8),
      genre: '스릴러',
      floorCandidates: floorCandidates(),
    });

    expect(verdict.discarded).toBe(true);
    expect(verdict.floor.passed).toBe(false);
    // 공통 독자 4인 × 양쪽 차례의 순위 판정만. 8화 읽기는 시작하지 않았다.
    expect(ask).toHaveBeenCalledTimes(8);
  });

  it('reads the scenes once the floor was ranked last', async () => {
    const judge = scriptedJudge((messages, call) => (call <= 8 ? rankFloorLast(messages) : turn(5, true)));

    const verdict = await judgeChain({
      judge,
      scenes: scenes(3),
      genre: '스릴러',
      floorCandidates: floorCandidates(),
    });

    expect(verdict.floor.passed).toBe(true);
    expect(verdict.auc.auc).toBe(1);
    expect(verdict.discarded).toBe(false);
  });
});

describe('the floor gate measures the judge, not the labels', () => {
  // 후보에 «훼손본» 이라고 써 붙여 주면 심판은 원고를 읽지 않고도 답을 맞힌다. 그러면 관문은
  // 아무것도 걸러내지 못하면서 언제나 통과한다.
  it('never tells the judge which candidate is the floor', async () => {
    const prompts: string[] = [];
    const judge = scriptedJudge((messages, call) => {
      prompts.push(messages.map((message) => message.content).join('\n'));
      return call <= 8 ? rankFloorLast(messages) : turn(5, true);
    });

    await judgeChain({
      judge,
      scenes: scenes(1),
      genre: '스릴러',
      floorCandidates: floorCandidates(),
    });

    const rankingPrompts = prompts.filter((prompt) => prompt.includes('줄을 세워라'));

    expect(rankingPrompts).toHaveLength(8);
    for (const prompt of rankingPrompts) {
      expect(prompt).not.toContain('floor');
      expect(prompt).not.toContain('generated');
    }
  });

  // 실측에서 관문이 독자 셋을 한꺼번에 막았는데, 후보가 늘 생성본·훼손본 차례로 보였다. 첫 자리를
  // 고르는 버릇이라면 그 회차는 심판이 아니라 자리를 잰 것이다. 차례를 독자마다 뒤집으면 그 버릇은
  // 반드시 독자 둘에서 드러난다.
  it('shows every reader the candidates in both orders', async () => {
    const prompts: readonly AiMessage[][] = [];
    const judge = scriptedJudge((messages, call) => {
      prompts.push(messages);
      return call <= 8 ? rankFloorLast(messages) : turn(5, true);
    });

    const verdict = await judgeChain({
      judge,
      scenes: scenes(1),
      genre: '스릴러',
      floorCandidates: floorCandidates(),
    });

    expect(verdict.floor.passed).toBe(true);
    expect(prompts.slice(0, 8).map(floorShownFirst)).toEqual([
      false, true, false, true, false, true, false, true,
    ]);
  });

  // 순위만 물으면 작은 심판은 자리를 답한다. 결함을 먼저 적게 해야 읽는다.
  it('asks for a note on each candidate before the ranking', async () => {
    const prompts: string[] = [];
    const judge = scriptedJudge((messages, call) => {
      prompts.push(messages.at(-1)?.content ?? '');
      return call <= 8 ? rankFloorLast(messages) : turn(5, true);
    });

    await judgeChain({ judge, scenes: scenes(1), genre: '스릴러', floorCandidates: floorCandidates() });

    expect(prompts[0]).toContain('결함을 한 문장으로');
    expect(prompts[0]).toContain('"notes"');
    expect(prompts[0]).toContain('"ranking"');
  });

  it('catches a judge that always prefers the first candidate', async () => {
    const judge = scriptedJudge((_messages, call) =>
      call <= 8 ? JSON.stringify({ ranking: ['가', '나'] }) : turn(5, true),
    );

    const verdict = await judgeChain({
      judge,
      scenes: scenes(1),
      genre: '스릴러',
      floorCandidates: floorCandidates(),
    });

    // 넷 다 자리를 답했다. 실패도 통과도 아니고, 판정이 없으니 관문은 막힌다.
    expect(verdict.floor.passed).toBe(false);
    expect(verdict.floor.abstained).toHaveLength(4);
    expect(verdict.discardReasons.join(' ')).toContain('자리와 무관하게');
  });

  // 작은 심판은 기호를 줘도 자리를 세어 답하는 일이 잦다. 그 답을 못 읽으면 관문이 심판의 눈이
  // 아니라 형식을 재게 되어 모든 회차가 폐기된다.
  it('reads a ranking the judge answered by position', async () => {
    const judge = scriptedJudge((messages, call) =>
      call <= 8
        ? JSON.stringify({ ranking: floorShownFirst(messages) ? ['2번', '1번'] : ['1번', '2번'] })
        : turn(5, true),
    );

    const verdict = await judgeChain({
      judge,
      scenes: scenes(2),
      genre: '스릴러',
      floorCandidates: floorCandidates(),
    });

    expect(verdict.floor.passed).toBe(true);
    expect(verdict.discarded).toBe(false);
  });

  it('still fails the gate when the position the judge named is the floor', async () => {
    const ask = vi.fn(
      async () => ({ text: JSON.stringify({ ranking: ['2', '1'] }) }) as AiGenerateResponse,
    );
    const judge: SimJudge = { providerId: 'openai', model: 'gpt-5-mini', ask, usage: () => [] };

    const verdict = await judgeChain({
      judge,
      scenes: scenes(8),
      genre: '스릴러',
      floorCandidates: floorCandidates(),
    });

    expect(verdict.floor.passed).toBe(false);
    expect(ask).toHaveBeenCalledTimes(8);
  });

  // 되돌릴 수 없는 답을 통과로 세면 그 회차의 눈금이 조용히 틀어진다.
  it('discards the round when no answer maps onto the candidates', async () => {
    const ask = vi.fn(
      async () => ({ text: JSON.stringify({ ranking: ['첫째', '둘째'] }) }) as AiGenerateResponse,
    );
    const judge: SimJudge = { providerId: 'openai', model: 'gpt-5-mini', ask, usage: () => [] };

    const verdict = await judgeChain({
      judge,
      scenes: scenes(8),
      genre: '스릴러',
      floorCandidates: floorCandidates(),
    });

    expect(verdict.discarded).toBe(true);
    expect(verdict.floor.passed).toBe(false);
    expect(verdict.discardReasons.join(' ')).toContain('되돌릴 수 없습니다');
    // 독자 4인 × 차례 둘 × (원답 + 되묻기).
    expect(ask).toHaveBeenCalledTimes(16);
  });

  // 결함 문장에 본문을 따옴표로 인용해 JSON 이 깨진 답이 실측에 있었다. 한 번은 되묻는다.
  it('asks again when the ranking could not be read, saying why', async () => {
    const prompts: string[] = [];
    let rankingCalls = 0;
    const judge = scriptedJudge((messages, call) => {
      const isRanking = messages.some((message) => message.content.includes('줄을 세워라'));
      if (!isRanking) {
        return turn(5, true);
      }
      rankingCalls += 1;
      prompts.push(messages.at(-1)?.content ?? '');
      // 홀수 번째는 깨진 JSON, 되물으면 제대로 답한다.
      return rankingCalls % 2 === 1 ? '{ "notes": { "가": "그는 "문"을 열었다" }, "ranking": ["가", "나"] }' : rankFloorLast(messages);
    });

    const verdict = await judgeChain({
      judge,
      scenes: scenes(1),
      genre: '스릴러',
      floorCandidates: floorCandidates(),
    });

    expect(verdict.floor.passed).toBe(true);
    expect(prompts[0]).not.toContain('읽을 수 없었다');
    expect(prompts[1]).toContain('JSON 으로 읽을 수 없었다');
    expect(prompts[0]).toContain('따옴표를 쓰지 말고');
  });

  it('refuses a ranking that leaves a candidate out or names one twice', () => {
    const labelled = labelFloorCandidates(floorCandidates());

    expect(resolveFloorRanking(['가', '나'], labelled)).toEqual(['generated', 'floor']);
    expect(resolveFloorRanking(['가', '가'], labelled)).toBeUndefined();
    expect(resolveFloorRanking(['가'], labelled)).toBeUndefined();
  });
});

describe('reading in order', () => {
  it('stops calling a reader who closed the book', async () => {
    const ask = vi.fn(async (messages: readonly AiMessage[]) => {
      const isRanking = messages.some((message) => message.content.includes('줄을 세워라'));
      if (isRanking) {
        return { text: rankFloorLast(messages) } as AiGenerateResponse;
      }
      const isSecondScene = messages.some((message) => message.content.startsWith('2화입니다'));
      return { text: isSecondScene ? turn(1, false) : turn(4, true) } as AiGenerateResponse;
    });
    const judge: SimJudge = { providerId: 'openai', model: 'gpt-5-mini', ask, usage: () => [] };

    const verdict = await judgeChain({
      judge,
      scenes: scenes(8),
      genre: '스릴러',
      floorCandidates: floorCandidates(),
    });

    // 하한선 8회 + 독자 5인이 각각 2화까지만 = 18회. 8화를 끝까지 읽었다면 48회였다.
    expect(ask).toHaveBeenCalledTimes(8 + 5 * 2);
    expect(verdict.curves[0]?.turns).toHaveLength(2);
  });

  it('keeps the genre reader out of the AUC', async () => {
    const judge = scriptedJudge((messages, call) => {
      if (call <= 8) {
        return rankFloorLast(messages);
      }
      const isGenre = messages[0]?.content.includes('스릴러 독자') === true;
      return turn(isGenre ? 0 : 5, true);
    });

    const verdict = await judgeChain({
      judge,
      scenes: scenes(2),
      genre: '스릴러',
      floorCandidates: floorCandidates(),
    });

    expect(verdict.auc.auc).toBe(1);
    expect(verdict.genreNotes).toHaveLength(2);
    expect(verdict.genreNotes[0]?.engagement).toBe(0);
  });
});

describe('quote grounding', () => {
  // 심판이 근거를 지어내면 그 판정은 근거 없는 숫자다. 한 번 되묻고 그래도 안 되면 회차를 버린다.
  it('retries once and then discards the round', async () => {
    const ask = vi.fn(async (messages: readonly AiMessage[]) => {
      const isRanking = messages.some((message) => message.content.includes('줄을 세워라'));
      return {
        text: isRanking ? rankFloorLast(messages) : turn(5, true, '본문에 없는 구절'),
      } as AiGenerateResponse;
    });
    const judge: SimJudge = { providerId: 'openai', model: 'gpt-5-mini', ask, usage: () => [] };

    const verdict = await judgeChain({
      judge,
      scenes: scenes(4),
      genre: '스릴러',
      floorCandidates: floorCandidates(),
    });

    expect(verdict.discarded).toBe(true);
    expect(verdict.discardReasons.join(' ')).toContain('본문에 없는 근거');
    // 독자마다 1화에서 두 번(원답 + 되묻기) 만에 포기한다.
    expect(ask).toHaveBeenCalledTimes(8 + 5 * 2);
  });

  // 장르 독자는 AUC 에 안 들어간다. 그 독자가 근거를 지어냈다고 공통 독자 넷의 곡선까지 버리면
  // 8화 판정 한 회차가 통째로 사라진다. 실측에서 그 일이 있었다.
  it('keeps the round when only the genre reader loses its grounding', async () => {
    const judge = scriptedJudge((messages, call) => {
      if (call <= 8) {
        return rankFloorLast(messages);
      }
      const isGenre = messages[0]?.content.includes('스릴러 독자') === true;
      return turn(5, true, isGenre ? '본문에 없는 구절' : '문을 열었다');
    });

    const verdict = await judgeChain({
      judge,
      scenes: scenes(2),
      genre: '스릴러',
      floorCandidates: floorCandidates(),
    });

    expect(verdict.discarded).toBe(false);
    expect(verdict.auc.auc).toBe(1);
    expect(verdict.genreNotes).toHaveLength(0);
    expect(verdict.genreProblems).toHaveLength(1);
    expect(verdict.genreProblems[0]).toContain('genre');
  });

  // «본문에 없는 근거» 만 남으면 심판이 무엇을 지어냈는지 되짚을 수 없다.
  it('names the rejected quote in the reason', async () => {
    const judge = scriptedJudge((messages, call) =>
      call <= 8 ? rankFloorLast(messages) : turn(5, true, '본문에 없는 구절'),
    );

    const verdict = await judgeChain({
      judge,
      scenes: scenes(1),
      genre: '스릴러',
      floorCandidates: floorCandidates(),
    });

    expect(verdict.discardReasons[0]).toContain('«본문에 없는 구절»');
  });

  // 온도 0 에서 같은 프롬프트를 다시 보내면 같은 답이 온다. 되묻기는 무엇이 틀렸는지 말해야 한다.
  it('tells the judge which quote was rejected when it asks again', async () => {
    const prompts: string[] = [];
    let turnCalls = 0;
    const judge = scriptedJudge((messages, call) => {
      if (call <= 8) {
        return rankFloorLast(messages);
      }
      turnCalls += 1;
      prompts.push(messages.at(-1)?.content ?? '');
      // 첫 답은 지어낸 인용, 되물으면 본문 구절.
      return turn(5, true, turnCalls % 2 === 1 ? '본문에 없는 구절' : '문을 열었다');
    });

    const verdict = await judgeChain({
      judge,
      scenes: scenes(1),
      genre: '스릴러',
      floorCandidates: floorCandidates(),
    });

    expect(verdict.discarded).toBe(false);
    expect(prompts[0]).not.toContain('앞선 답의 인용');
    expect(prompts[1]).toContain('«본문에 없는 구절»');
  });

  it('accepts a quote whose whitespace the judge changed', async () => {
    const judge = scriptedJudge((messages, call) =>
      call <= 8 ? rankFloorLast(messages) : turn(5, true, '문을  열었다'),
    );

    const verdict = await judgeChain({
      judge,
      scenes: scenes(2),
      genre: '스릴러',
      floorCandidates: floorCandidates(),
    });

    expect(verdict.discarded).toBe(false);
  });
});

describe('fact recall judge', () => {
  const fact = parseFactLedger(`
facts:
  - id: F1
    kind: attribute
    statement: 왼손에 흉터가 있다
    plant: "01"
    recall: ["03"]
    check: 왼손 흉터가 나온다
`).facts[0] as NonNullable<ReturnType<typeof parseFactLedger>['facts'][number]>;
  const draft = '도경이 왼손을 내밀었다. 화상 자국이 보였다.';

  it('accepts a recall whose quote is in the draft', async () => {
    const judge = scriptedJudge(() => JSON.stringify({ status: 'recalled', quote: '왼손을 내밀었다' }));

    await expect(createFactRecallJudge(judge)({ fact, sceneStem: '03', draft })).resolves.toEqual({
      status: 'recalled',
      evidence: '왼손을 내밀었다',
    });
  });

  it('takes missing at its word without demanding a quote', async () => {
    const judge = scriptedJudge(() => JSON.stringify({ status: 'missing', quote: '' }));

    await expect(createFactRecallJudge(judge)({ fact, sceneStem: '03', draft })).resolves.toEqual({
      status: 'missing',
    });
  });

  // 뒤집혔다는 판정도 근거가 있어야 한다. 없으면 되묻고, 그래도 없으면 모른다고 적는다.
  it('marks a contradiction unverified when its quote is invented', async () => {
    const judge = scriptedJudge(() => JSON.stringify({ status: 'contradicted', quote: '오른손 흉터' }));

    const result = await createFactRecallJudge(judge)({ fact, sceneStem: '03', draft });

    expect(result.status).toBe('unverified');
  });
});

describe('axis judge', () => {
  const scene = {
    sceneStem: '05-knowledge',
    axis: '지식 경계',
    question: '초점 인물이 모르는 사실이 서술에 새지 않았는가',
    draft: '지운이 다음 호 계획을 말했다. 선우와 미르가 눈빛을 주고받았다.',
    floorDraft: '선우는 폐간일이 당겨진 것을 알고 속으로 한숨을 쉬었다.',
  };

  function verdictJudge(reply: (draft: string) => string): SimJudge {
    return scriptedJudge((messages) => {
      const body = messages.at(-1)?.content ?? '';
      return reply(body);
    });
  }

  // 훼손본을 fail 로 못 밀면 그 씬의 눈금을 믿을 수 없다. 원고 판정 전에 확인한다.
  it('discards the scene when the judge does not fail the corrupted draft', async () => {
    const judge = verdictJudge(() => JSON.stringify({ verdict: 'pass', reason: '이유', quote: '눈빛을 주고받았다' }));

    const [verdict] = await judgeAxis({ judge, scenes: [scene] });

    expect(verdict?.discarded).toBe(true);
    expect(verdict?.discardReason).toContain('훼손본');
  });

  it('judges the draft once the floor was failed', async () => {
    const judge = verdictJudge((body) =>
      body.includes('한숨을 쉬었다')
        ? JSON.stringify({ verdict: 'fail', reason: '새었다', quote: '속으로 한숨을 쉬었다' })
        : JSON.stringify({ verdict: 'pass', reason: '본 것만 적었다', quote: '눈빛을 주고받았다' }),
    );

    const [verdict] = await judgeAxis({ judge, scenes: [scene] });

    expect(verdict).toMatchObject({ sceneStem: '05-knowledge', verdict: 'pass', discarded: false });
  });

  it('marks a verdict unverified when its quote is invented', async () => {
    const judge = verdictJudge((body) =>
      body.includes('한숨을 쉬었다')
        ? JSON.stringify({ verdict: 'fail', reason: '새었다', quote: '속으로 한숨을 쉬었다' })
        : JSON.stringify({ verdict: 'pass', reason: '이유', quote: '본문에 없는 구절' }),
    );

    const [verdict] = await judgeAxis({ judge, scenes: [scene] });

    expect(verdict?.verdict).toBe('unverified');
    expect(verdict?.discarded).toBe(true);
  });

  it('reads each scene in a fresh conversation, never carrying the last one', async () => {
    const seen: number[] = [];
    const judge = scriptedJudge((messages) => {
      seen.push(messages.length);
      return JSON.stringify({ verdict: 'fail', reason: '이유', quote: '' });
    });

    await judgeAxis({ judge, scenes: [{ ...scene, floorDraft: undefined }, { ...scene, sceneStem: '06', floorDraft: undefined }] });

    // system + user 두 개뿐. 앞 씬의 대화가 실리지 않는다.
    expect(seen.every((count) => count === 2)).toBe(true);
  });
});
