import { z } from 'zod';

import type { AiGenerateResponse, AiMessage } from '@storyboard/story-model';

import { readCritiqueLeniently } from '#sim/judge/lenientAnswer';
import { isQuoteGrounded } from '#sim/judge/quoteCheck';
import type { SceneDraft } from '#sim/judge/readerPanel';
import type { SimJudge } from '#sim/ports/judge';

export interface CriticCriterion {
  readonly id: string;
  readonly name: string;
  readonly question: string;
  readonly grounded: boolean;
}

export const criticCriteria: readonly CriticCriterion[] = [
  {
    id: 'arc',
    name: '인물 아크',
    question: '이야기가 진행되며 인물의 내면·가치관·관계가 변하는가. 첫 화의 인물과 끝 화의 인물이 다른 사람이 되었는가.',
    grounded: true,
  },
  {
    id: 'unity',
    name: '통일성',
    question: '곁가지 사건이 중심 사건과 묶여 있는가. 중심 사건과 겉도는 화가 있는가.',
    grounded: true,
  },
  {
    id: 'payoff',
    name: '복선 회수',
    question: '앞 화에서 던진 암시와 미스터리가 뒤 화에서 해소되는가. 던지고 잊힌 것이 있는가.',
    grounded: true,
  },
  {
    id: 'resolution',
    name: '완결성',
    question: '중심 갈등과 인물의 서사가 마지막 화에서 유보 없이 수습되는가.',
    grounded: true,
  },
  {
    id: 'theme',
    name: '주제적 공명',
    question: '이야기가 던지는 메시지가 사람의 본성이나 시대의 정서와 얼마나 깊게 호응하는가.',
    grounded: false,
  },
  {
    id: 'originality',
    name: '독창성',
    question: '익숙한 틀을 신선하게 비틀거나 관계·시공간을 새롭게 짰는가.',
    grounded: false,
  },
];

export const criticScoreMax: number = 5;
export const criticGateMargin: number = 2;

const scoreRubric: string[] = [
  '0: 기준을 전혀 못 지켰다.',
  '1: 기준을 거의 못 지켰고 결함이 여럿이다.',
  '2: 결함이 눈에 띈다.',
  '3: 지켜지되 평범하다.',
  '4: 잘 지켰다.',
  '5: 흠잡을 데 없다.',
];

export interface CriticScore {
  readonly criterion: string;
  readonly score: number;
  readonly reason: string;
  readonly quote?: string;
  readonly opinion: boolean;
  readonly ungrounded?: boolean;
}

export interface CriticVerdict {
  readonly scores: readonly CriticScore[];
  readonly groundedTotal: number;
  readonly opinionTotal: number;
  readonly gate: {
    readonly passed: boolean;
    readonly corruptedGroundedTotal: number;
    readonly reason: string;
  };
  readonly problems: readonly string[];
}

export function joinManuscript(scenes: readonly SceneDraft[]): string {
  return scenes
    .map((scene, index) => `## ${index + 1}화 (${scene.sceneStem})\n\n${stripFrontMatter(scene.draft)}`)
    .join('\n\n');
}

function stripFrontMatter(draft: string): string {
  const match: RegExpExecArray | null = /^---\n[\s\S]*?\n---\n?/u.exec(draft);
  return match === null ? draft : draft.slice(match[0].length);
}

export function corruptManuscript(scenes: readonly SceneDraft[], names: readonly string[]): string {
  const swapped: readonly string[] = swapNames(scenes.map((scene) => stripFrontMatter(scene.draft)), names);
  const reordered: string[] = [...swapped];

  if (reordered.length >= 6) {
    [reordered[2], reordered[5]] = [reordered[5] as string, reordered[2] as string];
  }
  if (reordered.length >= 4) {
    [reordered[0], reordered[3]] = [reordered[3] as string, reordered[0] as string];
  }

  const notes: string[] = [
    '[작가 메모: 이 장면은 뼈대만 있음. 나중에 다시 씀]',
    '[여기서 회상 장면을 추가할 것. 감각 묘사 3문장 이상]',
    '[TODO: 이 화의 장소가 어디인지 카드 확인]',
    '[편집자: 앞 화와 시각이 안 맞음. 9시인지 10시인지 정할 것]',
  ];
  const paragraphsOf = (draft: string): string[] =>
    draft.split(/\n{2,}/u).filter((paragraph) => paragraph.trim().length > 0);
  const all: string[][] = reordered.map(paragraphsOf);

  return all
    .map((paragraphs, index) => {
      const shuffled: string[] = index % 2 === 0 ? [...paragraphs].reverse() : [...paragraphs];
      const foreign: string | undefined = all[(index + 3) % all.length]?.[0];
      if (foreign !== undefined && shuffled.length > 1) {
        shuffled.splice(Math.floor(shuffled.length / 2), 0, foreign);
      }
      const withNote: string[] = [notes[index % notes.length] as string, ...shuffled];
      const repeated: string[] = shuffled.length > 0 ? [...withNote, shuffled[0] as string] : withNote;
      const body: string[] = index === all.length - 1 ? repeated.slice(0, 2) : repeated;
      return `## ${index + 1}화\n\n${body.join('\n\n')}`;
    })
    .join('\n\n');
}

function swapNames(drafts: readonly string[], names: readonly string[]): readonly string[] {
  const pairs: (readonly [string, string])[] = [];
  for (let index: number = 0; index + 1 < names.length; index += 2) {
    pairs.push([names[index] as string, names[index + 1] as string]);
  }

  return drafts.map((draft) =>
    pairs.reduce((text, [left, right]) => {
      const marker: string = `\u0000${left}\u0000`;
      return text.split(left).join(marker).split(right).join(left).split(marker).join(right);
    }, draft),
  );
}

interface Critique {
  score: number;
  reason: string;
  quote?: string;
}

const critiqueSchema: z.ZodType<Critique> = z.object({
  score: z.number(),
  reason: z.string().min(1),
  quote: z.string().optional(),
});

export function buildCritique(input: {
  readonly genre: string;
  readonly manuscript: string;
  readonly criterion: CriticCriterion;
}): readonly AiMessage[] {
  const { criterion } = input;
  return [
    {
      role: 'system',
      content: [
        `당신은 ${input.genre} 소설 원고 한 편을 끝까지 읽고 기준 하나만 채점하는 비평가다.`,
        '점수는 0에서 5 사이 정수다.',
        ...scoreRubric,
        '답은 JSON 한 덩어리로만 낸다. 다른 말을 덧붙이지 마라.',
      ].join('\n'),
    },
    { role: 'user', content: input.manuscript, cacheBoundary: true },
    {
      role: 'user',
      content: [
        `기준: ${criterion.name}`,
        `판정 질문: ${criterion.question}`,
        criterion.grounded
          ? '근거로 드는 인용은 반드시 본문에 그대로 있는 구절이어야 한다. 지어내지 마라.'
          : '이 기준은 한 구절로 증명되지 않는다. 인용 없이 이유만 적어라.',
        '',
        criterion.grounded
          ? '{ "score": 0에서 5 사이 정수, "reason": "한 문장", "quote": "본문에서 그대로 옮긴 한 구절" }'
          : '{ "score": 0에서 5 사이 정수, "reason": "한 문장" }',
      ].join('\n'),
    },
  ];
}

interface ManuscriptScoring {
  readonly scores: CriticScore[];
  readonly problems: string[];
}

async function scoreManuscript(
  judge: SimJudge,
  genre: string,
  manuscript: string,
): Promise<ManuscriptScoring> {
  const scores: CriticScore[] = [];
  const problems: string[] = [];

  for (const criterion of criticCriteria) {
    const response: AiGenerateResponse = await judge.ask(buildCritique({ genre, manuscript, criterion }));
    const parsed: z.ZodSafeParseResult<Critique> = critiqueSchema.safeParse(
      readJson(response.text) ?? readCritiqueLeniently(response.text ?? ''),
    );

    if (!parsed.success) {
      problems.push(`비평가가 ${criterion.name} 에서 읽을 수 있는 답을 주지 않았습니다.`);
      continue;
    }

    const score: number = Math.min(Math.max(Math.round(parsed.data.score), 0), criticScoreMax);
    const quote: string | undefined = parsed.data.quote?.trim();
    const ungrounded: boolean = criterion.grounded && (quote === undefined || !isQuoteGrounded(quote, manuscript));

    scores.push({
      criterion: criterion.id,
      score,
      reason: parsed.data.reason,
      ...(quote === undefined || quote.length === 0 ? {} : { quote }),
      opinion: !criterion.grounded || ungrounded,
      ...(ungrounded ? { ungrounded: true } : {}),
    });
  }

  return { scores, problems };
}

function readJson(text: string | undefined): unknown {
  if (typeof text !== 'string') {
    return null;
  }
  const match: RegExpExecArray | null = /\{[\s\S]*\}/u.exec(text);
  if (match === null) {
    return null;
  }
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function groundedTotal(scores: readonly CriticScore[]): number {
  return scores
    .filter((entry) => criticCriteria.find((criterion) => criterion.id === entry.criterion)?.grounded)
    .reduce((sum, entry) => sum + entry.score, 0);
}

function opinionTotal(scores: readonly CriticScore[]): number {
  return scores
    .filter((entry) => !criticCriteria.find((criterion) => criterion.id === entry.criterion)?.grounded)
    .reduce((sum, entry) => sum + entry.score, 0);
}

export async function judgeManuscript(input: {
  readonly judge: SimJudge;
  readonly genre: string;
  readonly scenes: readonly SceneDraft[];
  readonly names: readonly string[];
}): Promise<CriticVerdict> {
  const generated: ManuscriptScoring = await scoreManuscript(input.judge, input.genre, joinManuscript(input.scenes));
  const corrupted: ManuscriptScoring = await scoreManuscript(
    input.judge,
    input.genre,
    corruptManuscript(input.scenes, input.names),
  );

  const generatedGrounded: number = groundedTotal(generated.scores);
  const corruptedGrounded: number = groundedTotal(corrupted.scores);
  const passed: boolean = generatedGrounded - corruptedGrounded >= criticGateMargin;

  return {
    scores: generated.scores,
    groundedTotal: generatedGrounded,
    opinionTotal: opinionTotal(generated.scores),
    gate: {
      passed,
      corruptedGroundedTotal: corruptedGrounded,
      reason: passed
        ? `생성본 ${generatedGrounded} ≥ 훼손본 ${corruptedGrounded} + ${criticGateMargin}`
        : `생성본 ${generatedGrounded} 과 훼손본 ${corruptedGrounded} 의 차이가 ${criticGateMargin} 미만입니다`,
    },
    problems: [...generated.problems, ...corrupted.problems.map((problem) => `(훼손본) ${problem}`)],
  };
}
