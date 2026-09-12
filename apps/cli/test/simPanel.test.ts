import { describe, expect, it, vi } from 'vitest';

import type { AiGenerateResponse, AiMessage } from '@storyboard/story-ai';
import {
  SelfJudgingError,
  createSimJudge,
  judgeChain,
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

const goodRanking = JSON.stringify({ ranking: ['generated', 'floor'] });

function floorCandidates() {
  return [
    { kind: 'generated' as const, draft: sceneText },
    { kind: 'floor' as const, draft: '망가진 원고' },
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
        ({ text: JSON.stringify({ ranking: ['floor', 'generated'] }) }) as AiGenerateResponse,
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
    // 공통 독자 4인의 순위 판정만. 8화 읽기는 시작하지 않았다.
    expect(ask).toHaveBeenCalledTimes(4);
  });

  it('reads the scenes once the floor was ranked last', async () => {
    const judge = scriptedJudge((_messages, call) => (call <= 4 ? goodRanking : turn(5, true)));

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

describe('reading in order', () => {
  it('stops calling a reader who closed the book', async () => {
    const ask = vi.fn(async (messages: readonly AiMessage[]) => {
      const isRanking = messages.some((message) => message.content.includes('줄을 세워라'));
      if (isRanking) {
        return { text: goodRanking } as AiGenerateResponse;
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

    // 하한선 4회 + 독자 5인이 각각 2화까지만 = 14회. 8화를 끝까지 읽었다면 44회였다.
    expect(ask).toHaveBeenCalledTimes(4 + 5 * 2);
    expect(verdict.curves[0]?.turns).toHaveLength(2);
  });

  it('keeps the genre reader out of the AUC', async () => {
    const judge = scriptedJudge((messages, call) => {
      if (call <= 4) {
        return goodRanking;
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
        text: isRanking ? goodRanking : turn(5, true, '본문에 없는 구절'),
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
    expect(ask).toHaveBeenCalledTimes(4 + 5 * 2);
  });

  it('accepts a quote whose whitespace the judge changed', async () => {
    const judge = scriptedJudge((_messages, call) =>
      call <= 4 ? goodRanking : turn(5, true, '문을  열었다'),
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
