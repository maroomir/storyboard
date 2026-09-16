import { z } from 'zod';

import type { AiMessage } from '@storyboard/story-ai';

import { readCritiqueLeniently } from '#sim/judge/lenientAnswer';
import { isQuoteGrounded } from '#sim/judge/quoteCheck';
import type { SceneDraft } from '#sim/judge/readerPanel';
import type { SimJudge } from '#sim/ports/judge';

// NOTE: 독자 패널은 화 하나씩 읽으며 «계속 읽을까» 만 답한다. 인물 아크·통일성·복선 회수·완결성처럼
// 8화를 다 읽어야 보이는 것은 원고 전체를 한 번에 읽는 비평가가 따로 채점한다. 이 점수는 AUC 에
// 섞지 않는다 — 이탈 곡선과 절대 점수는 다른 눈금이다.

export interface CriticCriterion {
  readonly id: string;
  readonly name: string;
  readonly question: string;
  // 본문의 한 구절로 증명할 수 있는 기준인가. 주제·독창성은 그렇지 않아 인용 없이 «의견» 으로만 받는다.
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

export const criticScoreMax = 5;
// 관문의 최소 격차. 인용 기준 넷에서 한 점씩은 벌어져야 «훼손본을 가려냈다» 고 본다. 실측에서 훼손본이
// 늘 정확히 8점(기준마다 2점)을 받아, 격차 없이 «더 높으면 통과» 로는 2~4점 차이로 넘어갔다.
export const criticGateMargin = 4;

// 점수의 뜻을 앞에 못박는다. 없으면 작은 심판은 무엇이든 2~3점으로 준다.
const scoreRubric = [
  '0: 원고로 읽을 수 없다 — 작가 메모나 지시문이 남아 있거나, 인물 이름이 뒤바뀌거나, 화 순서가 어긋난다.',
  '1: 기준을 거의 못 지켰고 결함이 여럿이다.',
  '2: 결함이 눈에 띈다.',
  '3: 지켜지되 평범하다.',
  '4: 잘 지켰다.',
  '5: 흠잡을 데 없다.',
  '편집되지 않은 흔적(작가 메모, 뒤바뀐 이름, 어긋난 순서, 같은 문단의 되풀이)이 하나라도 보이면 그 기준은 1을 넘을 수 없다.',
];

export interface CriticScore {
  readonly criterion: string;
  readonly score: number;
  readonly reason: string;
  readonly quote?: string;
  // 인용을 요구하지 않은 기준(의견)이거나, 요구했는데 본문에 없는 구절을 든 경우.
  readonly opinion: boolean;
  readonly ungrounded?: boolean;
}

export interface CriticVerdict {
  readonly scores: readonly CriticScore[];
  // 인용으로 지킨 기준의 합(최대 20)과 의견 기준의 합(최대 10).
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
  const match = /^---\n[\s\S]*?\n---\n?/u.exec(draft);
  return match === null ? draft : draft.slice(match[0].length);
}

// NOTE: 비평가의 눈금을 믿으려면 «망가진 원고를 낮게 주는가» 를 봐야 한다. 훼손본은 사람이 8화를 새로
// 쓰는 대신 생성본을 기계적으로 부순다 — 이름 뒤바꾸기, 문단 순서 뒤집기, 화 순서 바꾸기, 다른 화의
// 문단 끼워 넣기, 작가 메모 남기기, 문단 되풀이, 마지막 화 잘라내기(완결을 없앤다). 씨앗 없이
// 결정적이라 같은 원고에는 같은 훼손본이 나온다. 처음 판본은 이보다 약해서 심판이 늘 8/20 을 줬다.
export function corruptManuscript(scenes: readonly SceneDraft[], names: readonly string[]): string {
  const swapped = swapNames(scenes.map((scene) => stripFrontMatter(scene.draft)), names);
  const reordered = [...swapped];

  if (reordered.length >= 6) {
    [reordered[2], reordered[5]] = [reordered[5] as string, reordered[2] as string];
  }
  if (reordered.length >= 4) {
    [reordered[0], reordered[3]] = [reordered[3] as string, reordered[0] as string];
  }

  const notes = [
    '[작가 메모: 이 장면은 뼈대만 있음. 나중에 다시 씀]',
    '[여기서 회상 장면을 추가할 것. 감각 묘사 3문장 이상]',
    '[TODO: 이 화의 장소가 어디인지 카드 확인]',
    '[편집자: 앞 화와 시각이 안 맞음. 9시인지 10시인지 정할 것]',
  ];
  const paragraphsOf = (draft: string): string[] =>
    draft.split(/\n{2,}/u).filter((paragraph) => paragraph.trim().length > 0);
  const all = reordered.map(paragraphsOf);

  return all
    .map((paragraphs, index) => {
      const shuffled = index % 2 === 0 ? [...paragraphs].reverse() : [...paragraphs];
      // 다른 화의 문단을 한가운데에 끼운다. 통일성·복선이 같이 무너진다.
      const foreign = all[(index + 3) % all.length]?.[0];
      if (foreign !== undefined && shuffled.length > 1) {
        shuffled.splice(Math.floor(shuffled.length / 2), 0, foreign);
      }
      const withNote = [notes[index % notes.length] as string, ...shuffled];
      const repeated = shuffled.length > 0 ? [...withNote, shuffled[0] as string] : withNote;
      // 마지막 화는 첫 문단만 남긴다. 결말이 사라진다.
      const body = index === all.length - 1 ? repeated.slice(0, 2) : repeated;
      return `## ${index + 1}화\n\n${body.join('\n\n')}`;
    })
    .join('\n\n');
}

function swapNames(drafts: readonly string[], names: readonly string[]): readonly string[] {
  const pairs: (readonly [string, string])[] = [];
  for (let index = 0; index + 1 < names.length; index += 2) {
    pairs.push([names[index] as string, names[index + 1] as string]);
  }

  return drafts.map((draft) =>
    pairs.reduce((text, [left, right]) => {
      const marker = `\u0000${left}\u0000`;
      return text.split(left).join(marker).split(right).join(left).split(marker).join(right);
    }, draft),
  );
}

const critiqueSchema = z.object({
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
        ...(criterion.grounded
          ? ['근거로 드는 인용은 반드시 본문에 그대로 있는 구절이어야 한다. 지어내지 마라.']
          : ['이 기준은 한 구절로 증명되지 않는다. 인용 없이 이유만 적어라.']),
        '답은 JSON 한 덩어리로만 낸다. 다른 말을 덧붙이지 마라.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `기준: ${criterion.name}`,
        `판정 질문: ${criterion.question}`,
        '',
        input.manuscript,
        '',
        criterion.grounded
          ? '{ "score": 0에서 5 사이 정수, "reason": "한 문장", "quote": "본문에서 그대로 옮긴 한 구절" }'
          : '{ "score": 0에서 5 사이 정수, "reason": "한 문장" }',
      ].join('\n'),
    },
  ];
}

async function scoreManuscript(
  judge: SimJudge,
  genre: string,
  manuscript: string,
): Promise<{ readonly scores: CriticScore[]; readonly problems: string[] }> {
  const scores: CriticScore[] = [];
  const problems: string[] = [];

  for (const criterion of criticCriteria) {
    const response = await judge.ask(buildCritique({ genre, manuscript, criterion }));
    const parsed = critiqueSchema.safeParse(
      readJson(response.text) ?? readCritiqueLeniently(response.text ?? ''),
    );

    if (!parsed.success) {
      problems.push(`비평가가 ${criterion.name} 에서 읽을 수 있는 답을 주지 않았습니다.`);
      continue;
    }

    const score = Math.min(Math.max(Math.round(parsed.data.score), 0), criticScoreMax);
    const quote = parsed.data.quote?.trim();
    const ungrounded = criterion.grounded && (quote === undefined || !isQuoteGrounded(quote, manuscript));

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
  const match = /\{[\s\S]*\}/u.exec(text);
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

// 생성본과 훼손본을 각각 채점한다. 절대 점수라 차례 편향은 없고, 후하게 주는 버릇만 남는다 — 훼손본이
// 생성본보다 낮지 않으면 이 회차의 비평 점수는 심판을 못 믿은 채 낸 값이다.
export async function judgeManuscript(input: {
  readonly judge: SimJudge;
  readonly genre: string;
  readonly scenes: readonly SceneDraft[];
  readonly names: readonly string[];
}): Promise<CriticVerdict> {
  const generated = await scoreManuscript(input.judge, input.genre, joinManuscript(input.scenes));
  const corrupted = await scoreManuscript(
    input.judge,
    input.genre,
    corruptManuscript(input.scenes, input.names),
  );

  const generatedGrounded = groundedTotal(generated.scores);
  const corruptedGrounded = groundedTotal(corrupted.scores);
  const passed = generatedGrounded - corruptedGrounded >= criticGateMargin;

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
