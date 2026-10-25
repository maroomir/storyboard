import type { AiMessage } from '@storyboard/story-model';

export interface ReaderPersona {
  readonly id: string;
  readonly name: string;
  readonly watches: string;
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
  {
    id: 'cause',
    name: '개연성을 보는 독자',
    watches: '사건의 원인과 결과가 맞물리는지. 이유 없이 일이 벌어지면 덮는다.',
    scope: 'common',
  },
  {
    id: 'world',
    name: '핍진성을 보는 독자',
    watches: '이야기가 세운 규칙(장소·시간·물건·제도)을 스스로 지키는지. 규칙이 편의대로 바뀌면 덮는다.',
    scope: 'common',
  },
  {
    id: 'feeling',
    name: '감정의 개연성을 보는 독자',
    watches: '인물의 감정과 반응이 닥친 일에 맞는지. 이유 없이 울고 웃으면 덮는다.',
    scope: 'common',
  },
  {
    id: 'motive',
    name: '동기를 보는 독자',
    watches: '인물이 왜 그 선택을 하는지 보이는지. 이유 없이 움직이면 덮는다.',
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
    '- 매 회차 끝에 «다음 화를 열 것인가» 를 답한다. 덮겠다고 답한 뒤에도 판정을 위해 다음 화를 받지만, 덮겠다는 답은 그대로 남는다.',
    '- 몰입도 0: 한 줄도 더 읽기 싫다 · 1: 억지로 읽었다 · 2: 지루하지만 읽힌다 · 3: 무난하다 · 4: 다음이 궁금하다 · 5: 손을 못 뗐다.',
    '- 근거로 드는 인용은 반드시 본문에 그대로 있는 구절이어야 한다. 지어내지 마라.',
    '- 답은 JSON 한 덩어리로만 낸다. 다른 말을 덧붙이지 마라.',
  ].join('\n');
}

const turnSchema: string = [
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
  const history: AiMessage[] = input.priorTurns.flatMap((turn): AiMessage[] => [
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

export function buildQuoteRepair(input: {
  readonly persona: ReaderPersona;
  readonly draft: string;
  readonly reason: string;
}): readonly AiMessage[] {
  return [
    { role: 'system', content: personaSystem(input.persona) },
    {
      role: 'user',
      content: [
        '아래 본문을 읽고 방금 든 이유를 뒷받침하는 문장 하나를 본문에서 글자 그대로 복사하라.',
        `이유: ${input.reason}`,
        '바꿔 쓰거나 줄이거나 이어 붙이지 마라. 본문에 없는 문장은 무효다.',
        '',
        input.draft,
        '',
        '답은 JSON 한 덩어리로만 낸다.',
        '{ "quote": "본문에서 그대로 복사한 한 문장" }',
      ].join('\n'),
    },
  ];
}

export function buildFloorRanking(input: {
  readonly persona: ReaderPersona;
  readonly candidates: readonly { readonly label: string; readonly draft: string }[];
  readonly retryNotice?: string;
}): readonly AiMessage[] {
  const body: string = input.candidates
    .map((candidate) => `### 원고 ${candidate.label}\n\n${candidate.draft}`)
    .join('\n\n');
  const labels: string[] = input.candidates.map((candidate) => candidate.label);

  return [
    { role: 'system', content: personaSystem(input.persona) },
    {
      role: 'user',
      content: [
        '같은 장면을 쓴 원고가 여러 편 있다. 먼저 원고마다 결함을 한 문장으로 적고, 그 다음 좋은 순서대로 줄을 세워라.',
        '',
        body,
        '',
        ...(input.retryNotice === undefined ? [] : [input.retryNotice, '']),
        `기호는 ${labels.join(' · ')} 뿐이다. 이 기호를 그대로 쓰고 번호로 바꾸지 마라.`,
        '결함 문장에는 따옴표를 쓰지 말고 본문을 인용하지 마라.',
        '답은 JSON 한 덩어리로만 낸다.',
        `{ "notes": { ${labels.map((label) => `"${label}": "결함 한 문장"`).join(', ')} }, "ranking": ["가장 좋은 원고의 기호", "…", "가장 나쁜 원고의 기호"] }`,
      ].join('\n'),
    },
  ];
}

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

export function buildFactRecall(input: {
  readonly statement: string;
  readonly check: string;
  readonly draft: string;
}): readonly AiMessage[] {
  return [
    {
      role: 'system',
      content: [
        '당신은 원고 한 편이 앞서 정해진 사실 하나를 지키는지만 판정한다.',
        '사실이 그대로 나오면 recalled, 언급이 없으면 missing, 뒤집혀 나오면 contradicted 다.',
        '근거로 드는 인용은 반드시 본문에 그대로 있는 구절이어야 한다. missing 이면 인용은 빈 문자열이다.',
        '답은 JSON 한 덩어리로만 낸다.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `사실: ${input.statement}`,
        `판정 기준: ${input.check}`,
        '',
        input.draft,
        '',
        '{ "status": "recalled" | "missing" | "contradicted", "quote": "본문에서 그대로 옮긴 한 구절 또는 빈 문자열" }',
      ].join('\n'),
    },
  ];
}
