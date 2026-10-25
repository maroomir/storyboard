import { parseJsonObject, type AiGenerateResponse } from '@storyboard/story-model';
import { z } from 'zod';

import { simDefaults } from '#sim/simDefaults';
import { panelAuc, type PanelAuc, type ReaderCurve, type ReaderTurn } from '#sim/judge/auc';
import {
  evaluateFloorGate,
  labelFloorCandidates,
  resolveFloorRanking,
  type FloorRanking,
  type FloorCandidateKind,
  type FloorGateResult,
} from '#sim/judge/floorAnchor';
import {
  buildAxisVerdict,
  buildFactRecall,
  buildFloorRanking,
  buildQuoteRepair,
  buildReaderTurn,
  commonReaders,
  genreReader,
  type ReaderPersona,
} from '#sim/judge/panelPrompts';
import {
  readQuoteLeniently,
  readRankingLeniently,
  readTurnLeniently,
} from '#sim/judge/lenientAnswer';
import { judgeManuscript, type CriticVerdict } from '#sim/judge/manuscriptCritic';
import { isQuoteGrounded } from '#sim/judge/quoteCheck';
import type { SimJudge } from '#sim/ports/judge';
import type { JudgeRecall } from '#sim/score/factRecall';

function readJsonObject(text: string | undefined): Record<string, unknown> | null {
  return typeof text === 'string' && text.length > 0 ? parseJsonObject(text) : null;
}

interface Turn {
  engagement: number;
  continueReading: boolean;
  reason: string;
  quote: string;
}

const turnSchema: z.ZodType<Turn> = z.object({
  engagement: z.number(),
  continueReading: z.boolean(),
  reason: z.string().min(1),
  quote: z.string(),
});

interface Ranking {
  ranking: string[];
}

const rankingSchema: z.ZodType<Ranking> = z.object({
  ranking: z.array(z.string()).min(2),
});

export interface SceneDraft {
  readonly sceneStem: string;
  readonly draft: string;
}

export interface PanelVerdict {
  readonly auc: PanelAuc;
  readonly curves: readonly ReaderCurve[];
  readonly genreNotes: readonly ReaderTurn[];
  readonly floor: {
    readonly passed: boolean;
    readonly failures: readonly string[];
    readonly abstained: readonly string[];
  };
  readonly discarded: boolean;
  readonly discardReasons: readonly string[];
  readonly genreProblems: readonly string[];
  readonly critic?: CriticVerdict;
}

interface Repair {
  quote: string;
}

const repairSchema: z.ZodType<Repair> = z.object({ quote: z.string() });

interface TurnOutcome {
  readonly turn?: ReaderTurn;
  readonly raw?: string;
  readonly problem?: string;
}

async function askTurn(
  judge: SimJudge,
  persona: ReaderPersona,
  scene: SceneDraft,
  sceneNumber: number,
  sceneCount: number,
  priorTurns: { sceneNumber: number; answer: string }[],
): Promise<TurnOutcome> {
  const response: AiGenerateResponse = await judge.ask(
    buildReaderTurn({ persona, sceneNumber, sceneCount, draft: scene.draft, priorTurns }),
  );
  const parsed: z.ZodSafeParseResult<Turn> = turnSchema.safeParse(
    readJsonObject(response.text) ?? readTurnLeniently(response.text ?? ''),
  );

  if (!parsed.success) {
    return { problem: `${persona.id} 가 ${scene.sceneStem} 에서 읽을 수 있는 답을 주지 않았습니다.` };
  }

  const raw: string = JSON.stringify({
    engagement: parsed.data.engagement,
    continueReading: parsed.data.continueReading,
    reason: parsed.data.reason,
  });

  if (isQuoteGrounded(parsed.data.quote, scene.draft)) {
    return { turn: { sceneStem: scene.sceneStem, ...parsed.data }, raw };
  }

  let rejectedQuote: string = parsed.data.quote;

  for (let attempt: number = 0; attempt < simDefaults.panel.quoteRetryLimit; attempt += 1) {
    const repair: AiGenerateResponse = await judge.ask(
      buildQuoteRepair({ persona, draft: scene.draft, reason: parsed.data.reason }),
    );
    const repaired: z.ZodSafeParseResult<Repair> = repairSchema.safeParse(
      readJsonObject(repair.text) ?? readQuoteLeniently(repair.text ?? ''),
    );

    if (!repaired.success) {
      continue;
    }

    if (isQuoteGrounded(repaired.data.quote, scene.draft)) {
      return { turn: { sceneStem: scene.sceneStem, ...parsed.data, quote: repaired.data.quote }, raw };
    }

    rejectedQuote = repaired.data.quote;
  }

  return {
    problem: `${persona.id} 가 ${scene.sceneStem} 에서 본문에 없는 근거를 들었습니다: «${clip(rejectedQuote)}»`,
  };
}

function clip(text: string, limit = 80): string {
  const flat: string = text.replace(/\s+/g, ' ').trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`;
}

interface ReaderReading {
  readonly curve: ReaderCurve;
  readonly problems: readonly string[];
}

async function readInOrder(
  judge: SimJudge,
  persona: ReaderPersona,
  scenes: readonly SceneDraft[],
): Promise<ReaderReading> {
  const turns: ReaderTurn[] = [];
  const priorTurns: { sceneNumber: number; answer: string }[] = [];
  const problems: string[] = [];

  for (const [index, scene] of scenes.entries()) {
    const outcome: TurnOutcome = await askTurn(judge, persona, scene, index + 1, scenes.length, priorTurns);

    if (outcome.turn === undefined) {
      problems.push(outcome.problem as string);
      break;
    }

    turns.push(outcome.turn);
    priorTurns.push({ sceneNumber: index + 1, answer: outcome.raw as string });
  }

  return { curve: { readerId: persona.id, turns }, problems };
}

export interface FloorCandidate {
  readonly kind: FloorCandidateKind;
  readonly draft: string;
}

interface FloorGateAnswers {
  readonly rankings: readonly FloorRanking[];
  readonly problems: readonly string[];
}

async function runFloorGate(
  judge: SimJudge,
  readers: readonly ReaderPersona[],
  candidates: readonly FloorCandidate[],
): Promise<FloorGateAnswers> {
  const rankings: FloorRanking[] = [];
  const problems: string[] = [];

  const orders: readonly (readonly FloorCandidate[])[] = [candidates, [...candidates].reverse()];

  for (const persona of readers) {
    const answers: (readonly FloorCandidateKind[])[] = [];

    for (const shown of orders) {
      const labelled: readonly LabelledDraftCandidate[] = labelFloorCandidates(shown);
      const outcome: RankingOutcome = await askRanking(judge, persona, labelled);

      if (outcome.ranking === undefined) {
        problems.push(outcome.problem as string);
        continue;
      }

      answers.push(outcome.ranking);
    }

    if (answers.length > 0) {
      rankings.push({ readerId: persona.id, rankings: answers });
    }
  }

  return { rankings, problems };
}

type LabelledDraftCandidate = FloorCandidate & { readonly label: string };

interface RankingOutcome {
  readonly ranking?: readonly FloorCandidateKind[];
  readonly problem?: string;
}

async function askRanking(
  judge: SimJudge,
  persona: ReaderPersona,
  labelled: readonly LabelledDraftCandidate[],
): Promise<RankingOutcome> {
  let problem: string = `${persona.id} 의 순위 판정을 읽을 수 없습니다.`;
  let retryNotice: string | undefined;

  for (let attempt: number = 0; attempt <= simDefaults.panel.quoteRetryLimit; attempt += 1) {
    const response: AiGenerateResponse = await judge.ask(
      buildFloorRanking({
        persona,
        candidates: labelled.map((candidate) => ({
          label: candidate.label,
          draft: candidate.draft,
        })),
        ...(retryNotice === undefined ? {} : { retryNotice }),
      }),
    );

    const parsed: z.ZodSafeParseResult<Ranking> = rankingSchema.safeParse(
      readJsonObject(response.text) ?? readRankingLeniently(response.text ?? ''),
    );

    if (!parsed.success) {
      problem = `${persona.id} 의 순위 판정을 읽을 수 없습니다.`;
      retryNotice = '앞선 답은 JSON 으로 읽을 수 없었다. 결함 문장에 따옴표를 넣지 말고 JSON 한 덩어리로만 다시 답하라.';
      continue;
    }

    const ranking: readonly FloorCandidateKind[] | undefined = resolveFloorRanking(parsed.data.ranking, labelled);

    if (ranking !== undefined) {
      return { ranking };
    }

    problem = `${persona.id} 의 순위 판정을 후보로 되돌릴 수 없습니다 (${parsed.data.ranking.join(' > ')}).`;
    retryNotice = `앞선 답의 순위 «${parsed.data.ranking.join(' > ')}» 는 기호로 되돌릴 수 없었다. 기호 ${labelled.map((candidate) => candidate.label).join(' · ')} 를 하나씩 빠짐없이 써서 다시 답하라.`;
  }

  return { problem };
}

export async function judgeChain(input: {
  readonly judge: SimJudge;
  readonly scenes: readonly SceneDraft[];
  readonly genre: string;
  readonly floorCandidates: readonly FloorCandidate[];
  readonly critic?: { readonly names: readonly string[] };
}): Promise<PanelVerdict> {
  const floor: FloorGateAnswers = await runFloorGate(input.judge, commonReaders, input.floorCandidates);
  const gate: FloorGateResult = evaluateFloorGate(floor.rankings);

  const discardReasons: string[] = [...floor.problems];

  if (discardReasons.length > 0) {
    return {
      auc: panelAuc([], input.scenes.length),
      curves: [],
      genreNotes: [],
      floor: { passed: gate.passed, failures: gate.failures, abstained: gate.abstained },
      discarded: true,
      discardReasons,
      genreProblems: [],
    };
  }

  const curves: ReaderCurve[] = [];

  for (const persona of commonReaders) {
    const outcome: ReaderReading = await readInOrder(input.judge, persona, input.scenes);
    curves.push(outcome.curve);
    discardReasons.push(...outcome.problems);
  }

  const genre: ReaderReading = await readInOrder(input.judge, genreReader(input.genre), input.scenes);

  const critic: CriticVerdict | undefined =
    input.critic === undefined
      ? undefined
      : await judgeManuscript({
          judge: input.judge,
          genre: input.genre,
          scenes: input.scenes,
          names: input.critic.names,
        });

  return {
    auc: panelAuc(curves, input.scenes.length),
    curves,
    genreNotes: genre.curve.turns,
    floor: { passed: gate.passed, failures: gate.failures, abstained: gate.abstained },
    discarded: discardReasons.length > 0,
    discardReasons,
    genreProblems: genre.problems,
    ...(critic === undefined ? {} : { critic }),
  };
}

interface FactRecall {
  status: 'recalled' | 'missing' | 'contradicted';
  quote: string;
}

const factRecallSchema: z.ZodType<FactRecall> = z.object({
  status: z.enum(['recalled', 'missing', 'contradicted']),
  quote: z.string(),
});

export function createFactRecallJudge(judge: SimJudge): JudgeRecall {
  return async ({ fact, draft }) => {
    for (let attempt: number = 0; attempt <= simDefaults.panel.quoteRetryLimit; attempt += 1) {
      const response: AiGenerateResponse = await judge.ask(
        buildFactRecall({ statement: fact.statement, check: fact.check, draft }),
      );
      const parsed: z.ZodSafeParseResult<FactRecall> = factRecallSchema.safeParse(readJsonObject(response.text));

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

interface AxisVerdictPayload {
  verdict: 'pass' | 'partial' | 'fail';
  reason: string;
  quote: string;
}

const axisVerdictSchema: z.ZodType<AxisVerdictPayload> = z.object({
  verdict: z.enum(['pass', 'partial', 'fail']),
  reason: z.string().min(1),
  quote: z.string(),
});

export interface AxisScene {
  readonly sceneStem: string;
  readonly axis: string;
  readonly question: string;
  readonly draft: string;
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
): Promise<AxisVerdictPayload | undefined> {
  for (let attempt: number = 0; attempt <= simDefaults.panel.quoteRetryLimit; attempt += 1) {
    const response: AiGenerateResponse = await judge.ask(
      buildAxisVerdict({ axis: scene.axis, question: scene.question, draft }),
    );
    const parsed: z.ZodSafeParseResult<AxisVerdictPayload> = axisVerdictSchema.safeParse(readJsonObject(response.text));

    if (parsed.success && isQuoteGrounded(parsed.data.quote, draft)) {
      return parsed.data;
    }
  }

  return undefined;
}

export async function judgeAxis(input: {
  readonly judge: SimJudge;
  readonly scenes: readonly AxisScene[];
}): Promise<readonly AxisVerdict[]> {
  const verdicts: AxisVerdict[] = [];

  for (const scene of input.scenes) {
    if (scene.floorDraft !== undefined) {
      const floor: AxisVerdictPayload | undefined = await askAxis(input.judge, scene, scene.floorDraft);
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

    const answer: AxisVerdictPayload | undefined = await askAxis(input.judge, scene, scene.draft);

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
