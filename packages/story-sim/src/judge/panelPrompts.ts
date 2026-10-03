import type { AiMessage } from '@storyboard/story-model';

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
  // NOTE: 아래 넷은 2026-09 에 더한 독자다. 그 전의 AUC 는 위 넷의 평균이라 눈금이 다르다 — 리포트는
  // 엔진 커밋으로 묶으므로 섞이지 않지만, 옛 값과 나란히 읽을 때는 그 점을 안다.
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

// 인용 고치기. 판정은 그대로 두고 근거만 다시 받는다.
// NOTE: 같은 프롬프트로 되물으면 온도 0 심판은 같은 답을 내고, 사유를 붙여 되물어도 앞 화에서 든
// 인용을 기억에서 꺼내 다시 썼다 — 이력에 앞 답이 들어 있기 때문이다. 그래서 이력 없이, 본문과 방금
// 든 이유만 주고 «한 문장을 글자 그대로 복사하라» 는 좁은 일 하나만 시킨다.
// NOTE: 퇴짜 맞은 인용을 프롬프트에 보여 주면 심판은 그 문장을 그대로 다시 낸다. 실측의 같은 사례에서
// 인용을 보여 주면 100% 되풀이했고, 감추면 세 가지 물음 모두 본문의 문장을 복사했다. 사유에는 남기되
// 심판에게는 보여 주지 않는다.
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

// 하한선 관문. 훼손본을 꼴찌로 못 밀면 그 회차의 눈금을 믿을 수 없다.
// NOTE: 후보는 뜻 없는 기호로만 부른다. 어느 쪽이 훼손본인지 라벨로 알려 주면 관문이 심판의
// 눈이 아니라 독해력을 재게 된다. 기호를 후보로 되돌리는 일은 floorAnchor 가 한다.
export function buildFloorRanking(input: {
  readonly persona: ReaderPersona;
  readonly candidates: readonly { readonly label: string; readonly draft: string }[];
  // 앞선 답을 읽지 못해 되묻는 차례면 그 사유. 온도 0 이라 같은 프롬프트로는 같은 답이 온다.
  readonly retryNotice?: string;
}): readonly AiMessage[] {
  const body = input.candidates
    .map((candidate) => `### 원고 ${candidate.label}\n\n${candidate.draft}`)
    .join('\n\n');
  const labels = input.candidates.map((candidate) => candidate.label);

  return [
    { role: 'system', content: personaSystem(input.persona) },
    {
      role: 'user',
      content: [
        // NOTE: 순위만 바로 물으면 gemma3:12b 는 내용과 무관하게 뒤에 보인 원고를 앞에 놓았다.
        // 같은 두 원고를 양쪽 차례로 독자 넷에게 물어 여덟 번 모두 «나 > 가» 였다. 원고마다 결함을 먼저
        // 적게 하면 같은 모델이 양쪽 차례에서 같은 답을 낸다. 관문은 자리가 아니라 읽기를 재야 한다.
        '같은 장면을 쓴 원고가 여러 편 있다. 먼저 원고마다 결함을 한 문장으로 적고, 그 다음 좋은 순서대로 줄을 세워라.',
        '',
        body,
        '',
        ...(input.retryNotice === undefined ? [] : [input.retryNotice, '']),
        `기호는 ${labels.join(' · ')} 뿐이다. 이 기호를 그대로 쓰고 번호로 바꾸지 마라.`,
        // NOTE: 결함 문장에 본문을 따옴표로 인용하면 JSON 문자열이 깨진다. 실측에서 그렇게 읽지 못한 답이 있었다.
        '결함 문장에는 따옴표를 쓰지 말고 본문을 인용하지 마라.',
        '답은 JSON 한 덩어리로만 낸다.',
        `{ "notes": { ${labels.map((label) => `"${label}": "결함 한 문장"`).join(', ')} }, "ranking": ["가장 좋은 원고의 기호", "…", "가장 나쁜 원고의 기호"] }`,
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

// 사실 원장의 attribute·knowledge·object·relation 은 문자열로 셀 수 없어 심판이 본다.
// 사실 하나, 씬 하나, 판정 하나. 다른 것은 보지 않는다.
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
