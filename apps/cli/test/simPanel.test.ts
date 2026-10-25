import { describe, expect, it, vi } from 'vitest';

import type { AiGenerateResponse, AiMessage } from '@storyboard/story-model';
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

const sceneText = '엘리아가 문을 열었다. 비가 내리고 있었다.';

function scenes(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    sceneStem: `0${index + 1}-scene`,
    draft: `${sceneText} (${index + 1}화)`,
  }));
}

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
  it('keeps reading and records the failure when a reader ranks the floor above the draft', async () => {
    const judge = scriptedJudge((messages, call) =>
      call <= 16 ? JSON.stringify({ ranking: ['가', '나'] }) : turn(5, true),
    );

    const verdict = await judgeChain({
      judge,
      scenes: scenes(2),
      genre: '스릴러',
      floorCandidates: floorCandidates(),
    });

    expect(verdict.floor.passed).toBe(false);
    expect(verdict.discarded).toBe(false);
    expect(verdict.auc.auc).toBe(1);
    expect(verdict.curves).toHaveLength(8);
  });

  it('reads the scenes once the floor was ranked last', async () => {
    const judge = scriptedJudge((messages, call) => (call <= 16 ? rankFloorLast(messages) : turn(5, true)));

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
  it('never tells the judge which candidate is the floor', async () => {
    const prompts: string[] = [];
    const judge = scriptedJudge((messages, call) => {
      prompts.push(messages.map((message) => message.content).join('\n'));
      return call <= 16 ? rankFloorLast(messages) : turn(5, true);
    });

    await judgeChain({
      judge,
      scenes: scenes(1),
      genre: '스릴러',
      floorCandidates: floorCandidates(),
    });

    const rankingPrompts = prompts.filter((prompt) => prompt.includes('줄을 세워라'));

    expect(rankingPrompts).toHaveLength(16);
    for (const prompt of rankingPrompts) {
      expect(prompt).not.toContain('floor');
      expect(prompt).not.toContain('generated');
    }
  });

  it('shows every reader the candidates in both orders', async () => {
    const prompts: readonly AiMessage[][] = [];
    const judge = scriptedJudge((messages, call) => {
      prompts.push(messages);
      return call <= 16 ? rankFloorLast(messages) : turn(5, true);
    });

    const verdict = await judgeChain({
      judge,
      scenes: scenes(1),
      genre: '스릴러',
      floorCandidates: floorCandidates(),
    });

    expect(verdict.floor.passed).toBe(true);
    expect(prompts.slice(0, 16).map(floorShownFirst)).toEqual(
      Array.from({ length: 16 }, (_, index) => index % 2 === 1),
    );
  });

  it('asks for a note on each candidate before the ranking', async () => {
    const prompts: string[] = [];
    const judge = scriptedJudge((messages, call) => {
      prompts.push(messages.at(-1)?.content ?? '');
      return call <= 16 ? rankFloorLast(messages) : turn(5, true);
    });

    await judgeChain({ judge, scenes: scenes(1), genre: '스릴러', floorCandidates: floorCandidates() });

    expect(prompts[0]).toContain('결함을 한 문장으로');
    expect(prompts[0]).toContain('"notes"');
    expect(prompts[0]).toContain('"ranking"');
  });

  it('catches a judge that always prefers the first candidate', async () => {
    const judge = scriptedJudge((_messages, call) =>
      call <= 16 ? JSON.stringify({ ranking: ['가', '나'] }) : turn(5, true),
    );

    const verdict = await judgeChain({
      judge,
      scenes: scenes(1),
      genre: '스릴러',
      floorCandidates: floorCandidates(),
    });

    expect(verdict.floor.passed).toBe(false);
    expect(verdict.floor.abstained).toHaveLength(8);
    expect(verdict.floor.failures.join(' ')).toContain('자리와 무관하게');
    expect(verdict.discarded).toBe(false);
  });

  it('reads a ranking the judge answered by position', async () => {
    const judge = scriptedJudge((messages, call) =>
      call <= 16
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
    const judge = scriptedJudge((messages, call) =>
      call <= 16 ? JSON.stringify({ ranking: ['2', '1'] }) : turn(5, true),
    );

    const verdict = await judgeChain({
      judge,
      scenes: scenes(1),
      genre: '스릴러',
      floorCandidates: floorCandidates(),
    });

    expect(verdict.floor.passed).toBe(false);
    expect(verdict.floor.failures[0]).toContain('자리와 무관하게');
  });

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
    expect(ask).toHaveBeenCalledTimes(32);
  });

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
      return rankingCalls % 2 === 1 ? '순위: 가 > 나. 결함은 되풀이.' : rankFloorLast(messages);
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
  it('keeps reading after a reader says it would close the book', async () => {
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

    expect(ask).toHaveBeenCalledTimes(16 + 9 * 8);
    expect(verdict.curves[0]?.turns).toHaveLength(8);
    expect(verdict.auc.byReader['pace']).toBeCloseTo((0.8 + 0.2) / 8);
    expect(verdict.auc.dropOffScene['pace']).toBe('02-scene');
    expect(verdict.auc.engagementByReader['pace']).toBeCloseTo((4 + 7) / 5 / 8);
  });

  it('keeps the genre reader out of the AUC', async () => {
    const judge = scriptedJudge((messages, call) => {
      if (call <= 16) {
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
    expect(ask).toHaveBeenCalledTimes(16 + 9 * 2);
  });

  it('keeps the round when only the genre reader loses its grounding', async () => {
    const judge = scriptedJudge((messages, call) => {
      if (call <= 16) {
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

  it('names the rejected quote in the reason', async () => {
    const judge = scriptedJudge((messages, call) =>
      call <= 16 ? rankFloorLast(messages) : turn(5, true, '본문에 없는 구절'),
    );

    const verdict = await judgeChain({
      judge,
      scenes: scenes(1),
      genre: '스릴러',
      floorCandidates: floorCandidates(),
    });

    expect(verdict.discardReasons[0]).toContain('«본문에 없는 구절»');
  });

  it('repairs only the quote, without the history, when it asks again', async () => {
    const prompts: string[] = [];
    let turnCalls = 0;
    const judge = scriptedJudge((messages, call) => {
      if (call <= 16) {
        return rankFloorLast(messages);
      }
      turnCalls += 1;
      prompts.push(messages.at(-1)?.content ?? '');
      return turn(5, true, turnCalls % 2 === 1 ? '본문에 없는 구절' : '문을 열었다');
    });

    const verdict = await judgeChain({
      judge,
      scenes: scenes(1),
      genre: '스릴러',
      floorCandidates: floorCandidates(),
    });

    expect(verdict.discarded).toBe(false);
    expect(prompts[0]).not.toContain('글자 그대로 복사');
    expect(prompts[1]).toContain('글자 그대로 복사');
    expect(prompts[1]).not.toContain('본문에 없는 구절');
    expect(verdict.curves[0]?.turns[0]?.quote).toBe('문을 열었다');
  });

  it('keeps the quote out of the history it hands back to the judge', async () => {
    const prompts: readonly AiMessage[][] = [];
    const judge = scriptedJudge((messages, call) => {
      prompts.push(messages);
      return call <= 16 ? rankFloorLast(messages) : turn(5, true);
    });

    await judgeChain({ judge, scenes: scenes(2), genre: '스릴러', floorCandidates: floorCandidates() });

    const secondScene = prompts.find((messages) => messages.at(-1)?.content.startsWith('2화입니다'));
    const history = secondScene?.find((message) => message.role === 'assistant')?.content ?? '';

    expect(history).toContain('"reason"');
    expect(history).not.toContain('"quote"');
  });

  it('accepts a quote whose whitespace the judge changed', async () => {
    const judge = scriptedJudge((messages, call) =>
      call <= 16 ? rankFloorLast(messages) : turn(5, true, '문을  열었다'),
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

    expect(seen.every((count) => count === 2)).toBe(true);
  });
});
