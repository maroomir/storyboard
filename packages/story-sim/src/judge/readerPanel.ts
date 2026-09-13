import { parseJsonObject } from '@storyboard/story-ai';
import { z } from 'zod';

import { simDefaults } from '#sim/simDefaults';
import { panelAuc, type PanelAuc, type ReaderCurve, type ReaderTurn } from '#sim/judge/auc';
import { evaluateFloorGate, type FloorRanking, type FloorCandidateKind } from '#sim/judge/floorAnchor';
import {
  buildAxisVerdict,
  buildFactRecall,
  buildFloorRanking,
  buildReaderTurn,
  commonReaders,
  genreReader,
  type ReaderPersona,
} from '#sim/judge/panelPrompts';
import { isQuoteGrounded } from '#sim/judge/quoteCheck';
import type { SimJudge } from '#sim/ports/judge';
import type { JudgeRecall } from '#sim/score/factRecall';

// 프로바이더가 본문 없이 돌아오는 경우가 있다. 그때 파서가 던지면 회차 전체가 예외로 끝나므로,
// 읽을 수 없는 답은 «판정 실패» 로 다루고 되묻기 흐름에 태운다.
function readJsonObject(text: string | undefined): Record<string, unknown> | null {
  return typeof text === 'string' && text.length > 0 ? parseJsonObject(text) : null;
}

const turnSchema = z.object({
  engagement: z.number(),
  continueReading: z.boolean(),
  reason: z.string().min(1),
  quote: z.string(),
});

const rankingSchema = z.object({
  ranking: z.array(z.string()).min(2),
});

export interface SceneDraft {
  readonly sceneStem: string;
  readonly draft: string;
}

export interface PanelVerdict {
  readonly auc: PanelAuc;
  readonly curves: readonly ReaderCurve[];
  // 장르 독자의 말. AUC 에 들어가지 않는다.
  readonly genreNotes: readonly ReaderTurn[];
  readonly floor: { readonly passed: boolean; readonly failures: readonly string[] };
  // 회차를 버려야 하는지. 하한선 관문 실패나 검증 못 한 인용이 이유다.
  readonly discarded: boolean;
  readonly discardReasons: readonly string[];
}

// 인용이 본문에 없으면 한 번 다시 묻고, 그래도 안 되면 그 회차를 버린다.
async function askTurn(
  judge: SimJudge,
  persona: ReaderPersona,
  scene: SceneDraft,
  sceneNumber: number,
  sceneCount: number,
  priorTurns: { sceneNumber: number; answer: string }[],
): Promise<{ readonly turn?: ReaderTurn; readonly raw?: string; readonly problem?: string }> {
  for (let attempt = 0; attempt <= simDefaults.panel.quoteRetryLimit; attempt += 1) {
    const messages = buildReaderTurn({
      persona,
      sceneNumber,
      sceneCount,
      draft: scene.draft,
      priorTurns,
    });

    const response = await judge.ask(messages);
    const parsed = turnSchema.safeParse(readJsonObject(response.text));

    if (!parsed.success) {
      continue;
    }

    if (!isQuoteGrounded(parsed.data.quote, scene.draft)) {
      continue;
    }

    return {
      turn: { sceneStem: scene.sceneStem, ...parsed.data },
      raw: response.text,
    };
  }

  return { problem: `${persona.id} 가 ${scene.sceneStem} 에서 본문에 없는 근거를 들었습니다.` };
}

async function readInOrder(
  judge: SimJudge,
  persona: ReaderPersona,
  scenes: readonly SceneDraft[],
): Promise<{ readonly curve: ReaderCurve; readonly problems: readonly string[] }> {
  const turns: ReaderTurn[] = [];
  const priorTurns: { sceneNumber: number; answer: string }[] = [];
  const problems: string[] = [];

  for (const [index, scene] of scenes.entries()) {
    const outcome = await askTurn(judge, persona, scene, index + 1, scenes.length, priorTurns);

    if (outcome.turn === undefined) {
      problems.push(outcome.problem as string);
      break;
    }

    turns.push(outcome.turn);
    priorTurns.push({ sceneNumber: index + 1, answer: outcome.raw as string });

    // 덮은 독자는 더 부르지 않는다. 계속 부르면 돈도 들고 되살아나기도 한다.
    if (!outcome.turn.continueReading) {
      break;
    }
  }

  return { curve: { readerId: persona.id, turns }, problems };
}

export interface FloorCandidate {
  readonly kind: FloorCandidateKind;
  readonly draft: string;
}

async function runFloorGate(
  judge: SimJudge,
  readers: readonly ReaderPersona[],
  candidates: readonly FloorCandidate[],
): Promise<{ readonly rankings: readonly FloorRanking[]; readonly problems: readonly string[] }> {
  const rankings: FloorRanking[] = [];
  const problems: string[] = [];

  for (const persona of readers) {
    const response = await judge.ask(
      buildFloorRanking({
        persona,
        candidates: candidates.map((candidate) => ({
          label: candidate.kind,
          draft: candidate.draft,
        })),
      }),
    );

    const parsed = rankingSchema.safeParse(readJsonObject(response.text));

    if (!parsed.success) {
      problems.push(`${persona.id} 의 순위 판정을 읽을 수 없습니다.`);
      continue;
    }

    rankings.push({
      readerId: persona.id,
      ranking: parsed.data.ranking as readonly FloorCandidateKind[],
    });
  }

  return { rankings, problems };
}

export async function judgeChain(input: {
  readonly judge: SimJudge;
  readonly scenes: readonly SceneDraft[];
  readonly genre: string;
  // 하한선 관문에 쓸 후보. 훼손본이 반드시 들어 있어야 한다.
  readonly floorCandidates: readonly FloorCandidate[];
}): Promise<PanelVerdict> {
  // 망가진 심판이 패널 전체가 아니라 네 번만 축내도록 관문을 맨 먼저 돌린다.
  const floor = await runFloorGate(input.judge, commonReaders, input.floorCandidates);
  const gate = evaluateFloorGate(floor.rankings);

  const discardReasons = [...gate.failures, ...floor.problems];

  if (!gate.passed) {
    return {
      auc: panelAuc([], input.scenes.length),
      curves: [],
      genreNotes: [],
      floor: { passed: false, failures: gate.failures },
      discarded: true,
      discardReasons,
    };
  }

  const curves: ReaderCurve[] = [];

  for (const persona of commonReaders) {
    const outcome = await readInOrder(input.judge, persona, input.scenes);
    curves.push(outcome.curve);
    discardReasons.push(...outcome.problems);
  }

  const genre = await readInOrder(input.judge, genreReader(input.genre), input.scenes);
  discardReasons.push(...genre.problems);

  return {
    auc: panelAuc(curves, input.scenes.length),
    curves,
    genreNotes: genre.curve.turns,
    floor: { passed: true, failures: [] },
    discarded: discardReasons.length > 0,
    discardReasons,
  };
}

const factRecallSchema = z.object({
  status: z.enum(['recalled', 'missing', 'contradicted']),
  quote: z.string(),
});

// 원장 채점기가 요구하는 모양으로 심판을 감싼다. recalled·contradicted 는 근거가 본문에 있어야
// 인정하고, 없으면 한 번 되묻고 그래도 안 되면 unverified 다.
export function createFactRecallJudge(judge: SimJudge): JudgeRecall {
  return async ({ fact, draft }) => {
    for (let attempt = 0; attempt <= simDefaults.panel.quoteRetryLimit; attempt += 1) {
      const response = await judge.ask(
        buildFactRecall({ statement: fact.statement, check: fact.check, draft }),
      );
      const parsed = factRecallSchema.safeParse(readJsonObject(response.text));

      if (!parsed.success) {
        continue;
      }

      if (parsed.data.status === 'missing') {
        return { status: 'missing' };
      }

      if (isQuoteGrounded(parsed.data.quote, draft)) {
        return { status: parsed.data.status, evidence: parsed.data.quote };
      }
    }

    return { status: 'unverified', evidence: '본문에 없는 근거를 들었습니다.' };
  };
}

const axisVerdictSchema = z.object({
  verdict: z.enum(['pass', 'partial', 'fail']),
  reason: z.string().min(1),
  quote: z.string(),
});

export interface AxisScene {
  readonly sceneStem: string;
  readonly axis: string;
  readonly question: string;
  readonly draft: string;
  // 그 씬의 축을 일부러 깨뜨린 원고. 심판이 이것을 fail 로 못 밀면 그 씬의 판정은 버린다.
  readonly floorDraft?: string;
}

export interface AxisVerdict {
  readonly sceneStem: string;
  readonly axis: string;
  readonly verdict: 'pass' | 'partial' | 'fail' | 'unverified';
  readonly reason: string;
  readonly quote: string;
  readonly discarded: boolean;
  readonly discardReason?: string;
}

async function askAxis(
  judge: SimJudge,
  scene: Pick<AxisScene, 'axis' | 'question'>,
  draft: string,
): Promise<z.infer<typeof axisVerdictSchema> | undefined> {
  for (let attempt = 0; attempt <= simDefaults.panel.quoteRetryLimit; attempt += 1) {
    const response = await judge.ask(
      buildAxisVerdict({ axis: scene.axis, question: scene.question, draft }),
    );
    const parsed = axisVerdictSchema.safeParse(readJsonObject(response.text));

    if (parsed.success && isQuoteGrounded(parsed.data.quote, draft)) {
      return parsed.data;
    }
  }

  return undefined;
}

// 축 트랙은 곡선이 없다. 씬마다 새 대화로 독립해 읽고 그 씬의 축 하나만 본다.
export async function judgeAxis(input: {
  readonly judge: SimJudge;
  readonly scenes: readonly AxisScene[];
}): Promise<readonly AxisVerdict[]> {
  const verdicts: AxisVerdict[] = [];

  for (const scene of input.scenes) {
    // 씬마다 하한선. 훼손본이 fail 이 아니면 이 씬의 눈금을 믿을 수 없다.
    if (scene.floorDraft !== undefined) {
      const floor = await askAxis(input.judge, scene, scene.floorDraft);
      if (floor?.verdict !== 'fail') {
        verdicts.push({
          sceneStem: scene.sceneStem,
          axis: scene.axis,
          verdict: 'unverified',
          reason: '',
          quote: '',
          discarded: true,
          discardReason: `훼손본을 fail 로 판정하지 못했습니다 (${floor?.verdict ?? '판정 불가'}).`,
        });
        continue;
      }
    }

    const answer = await askAxis(input.judge, scene, scene.draft);

    verdicts.push(
      answer === undefined
        ? {
            sceneStem: scene.sceneStem,
            axis: scene.axis,
            verdict: 'unverified',
            reason: '',
            quote: '',
            discarded: true,
            discardReason: '본문에 없는 근거를 들었습니다.',
          }
        : { sceneStem: scene.sceneStem, axis: scene.axis, ...answer, discarded: false },
    );
  }

  return verdicts;
}
