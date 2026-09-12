import type { AiMessage } from '@storyboard/story-ai';

// NOTE: 이 프롬프트는 story-sim 소유다. 제품의 promptTuning 카탈로그에 넣으면 계측기가 측정
// 대상의 일부가 되어, 스윕이 눈금을 함께 흔들게 된다.

export interface ReaderPersona {
  readonly id: string;
  readonly name: string;
  readonly watches: string;
  // 공통 독자만 AUC 에 들어간다. 장르 독자의 말은 기록만 한다.
  readonly scope: 'common' | 'genre';
}

export const commonReaders: readonly ReaderPersona[] = [
  {
    id: 'pace',
    name: '전개 속도를 보는 독자',
    watches: '사건이 언제 움직이는지. 같은 자리에서 맴돌면 덮는다.',
    scope: 'common',
  },
  {
    id: 'prose',
    name: '문장 결을 보는 독자',
    watches: '문장이 살아 있는지. 상투구와 되풀이가 눈에 밟히면 덮는다.',
    scope: 'common',
  },
  {
    id: 'canon',
    name: '설정 충돌을 보는 독자',
    watches: '앞에서 정한 사실이 뒤에서 어긋나는지. 어긋나면 덮는다.',
    scope: 'common',
  },
  {
    id: 'pov',
    name: '시점 경계를 보는 독자',
    watches: '초점 인물이 모를 것을 서술이 알고 있는지. 새면 덮는다.',
    scope: 'common',
  },
];

export function genreReader(genre: string): ReaderPersona {
  return {
    id: 'genre',
    name: `${genre} 독자`,
    watches: `${genre}의 관습이 지켜지는지. 이 장르를 찾아 읽는 사람이 기대하는 것이 있는지.`,
    scope: 'genre',
  };
}

function personaSystem(persona: ReaderPersona): string {
  return [
    `당신은 웹소설을 읽는 한 사람이다. ${persona.name}.`,
    `무엇을 보는가: ${persona.watches}`,
    '',
    '규칙:',
    '- 평론가가 아니라 독자다. 읽다가 재미없으면 덮는다.',
    '- 매 회차 끝에 계속 읽을지 결정한다. 한 번 덮으면 다시 열지 않는다.',
    '- 근거로 드는 인용은 반드시 본문에 그대로 있는 구절이어야 한다. 지어내지 마라.',
    '- 답은 JSON 한 덩어리로만 낸다. 다른 말을 덧붙이지 마라.',
  ].join('\n');
}

const turnSchema = [
  '{',
  '  "engagement": 0에서 5 사이 정수,',
  '  "continueReading": true 또는 false,',
  '  "reason": "한 문장",',
  '  "quote": "본문에서 그대로 옮긴 한 구절"',
  '}',
].join('\n');

export function buildReaderTurn(input: {
  readonly persona: ReaderPersona;
  readonly sceneNumber: number;
  readonly sceneCount: number;
  readonly draft: string;
  readonly priorTurns: readonly { readonly sceneNumber: number; readonly answer: string }[];
}): readonly AiMessage[] {
  const history = input.priorTurns.flatMap((turn): AiMessage[] => [
    { role: 'user', content: `${turn.sceneNumber}화입니다.` },
    { role: 'assistant', content: turn.answer },
  ]);

  return [
    { role: 'system', content: personaSystem(input.persona) },
    ...history,
    {
      role: 'user',
      content: [
        `${input.sceneNumber}화입니다. (전체 ${input.sceneCount}화)`,
        '',
        input.draft,
        '',
        '읽고 아래 형식으로 답하라.',
        turnSchema,
      ].join('\n'),
    },
  ];
}

// 하한선 관문. 훼손본을 꼴찌로 못 밀면 그 회차의 눈금을 믿을 수 없다.
export function buildFloorRanking(input: {
  readonly persona: ReaderPersona;
  readonly candidates: readonly { readonly label: string; readonly draft: string }[];
}): readonly AiMessage[] {
  const body = input.candidates
    .map((candidate, index) => `### ${index + 1}번 (${candidate.label})\n\n${candidate.draft}`)
    .join('\n\n');

  return [
    { role: 'system', content: personaSystem(input.persona) },
    {
      role: 'user',
      content: [
        '같은 장면을 쓴 원고가 여러 편 있다. 읽고 좋은 순서대로 줄을 세워라.',
        '',
        body,
        '',
        '답은 JSON 한 덩어리로만 낸다.',
        '{ "ranking": ["가장 좋은 것의 라벨", "…", "가장 나쁜 것의 라벨"] }',
      ].join('\n'),
    },
  ];
}

// 축 트랙은 씬마다 새 대화로 독립해 읽고 그 씬의 축 하나만 본다.
export function buildAxisVerdict(input: {
  readonly axis: string;
  readonly question: string;
  readonly draft: string;
}): readonly AiMessage[] {
  return [
    {
      role: 'system',
      content: [
        '당신은 원고 한 편을 읽고 한 가지만 판정한다. 다른 것은 보지 않는다.',
        '근거로 드는 인용은 반드시 본문에 그대로 있는 구절이어야 한다.',
        '답은 JSON 한 덩어리로만 낸다.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `판정할 축: ${input.axis}`,
        `판정 기준: ${input.question}`,
        '',
        input.draft,
        '',
        '{ "verdict": "pass" | "partial" | "fail", "reason": "한 문장", "quote": "본문에서 그대로 옮긴 한 구절" }',
      ].join('\n'),
    },
  ];
}
