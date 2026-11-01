import { aiGenerateResponseWithUsage } from '#ai/ai/cost';
import {
  type AiGenerateRequest,
  type AiGenerateResponse,
  type AiProvider,
  type AiProviderId,
  type AiTaskName,
  type AiUsage,
  getProviderDisplayName,
} from '@storyboard/story-model';
import { registerProviderFactory } from '#ai/ai/providerFactory';

const mockCatalogModelId: string = 'mock-default';


interface MockLineRewrite {
  readonly n: number;
  readonly text: string;
}

export class MockAiProvider implements AiProvider {
  public readonly id: AiProviderId = 'mock';
  public readonly displayName: string = getProviderDisplayName('mock');

  public async checkConnection(): Promise<boolean> {
    return true;
  }

  public async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    const userPrompt: string = request.messages
      .filter((message) => message.role === 'user')
      .map((message) => message.content.trim())
      .filter((content) => content.length > 0)
      .join('\n\n');

    const text: string = createMockResponse(request.taskName, userPrompt);
    const usage: AiUsage = syntheticUsageFromMessages(request, text);
    return aiGenerateResponseWithUsage({
      providerId: this.id,
      model: mockCatalogModelId,
      text,
      usage,
    });
  }
}

function syntheticUsageFromMessages(request: AiGenerateRequest, responseText: string): AiUsage {
  const promptChars: number = request.messages.map((message) => message.content).join('').length;

  return {
    inputTokens: Math.floor(promptChars / 4),
    outputTokens: Math.floor(responseText.length / 4),
  };
}

type MockResponseBuilder = (promptSummary: string) => string;

function createMockStoryCompletion(): string {
  return JSON.stringify({
    scenes: [
      {
        slug: 'the-last-recall',
        title: '마지막 기억의 행방',
        characterIds: [],
        body: '[목적]\n기억세공소의 중심 갈등을 선택으로 매듭짓는다.\n\n[결말]\n주인공은 잃어버린 기억을 돌려주고, 대가를 감당하며 다음 이야기를 위한 작은 여지를 남긴다.',
        resolvedThreads: ['중심 갈등'],
        openThreads: ['새로운 의뢰'],
      },
    ],
    centralQuestion: '무엇을 기억으로 남길 것인가?',
    climaxChoice: '기억을 소유하지 않고 돌려준다.',
  });
}

function createMockSceneStructure(): string {
  return JSON.stringify({
    purpose: '모의 목적',
    conflict: '모의 갈등',
    twist: '모의 반전',
    emotionalShift: '모의 감정 변화',
    foreshadowing: ['모의 복선'],
    neededCanon: ['모의 설정'],
  });
}

function createMockChapterPlan(): string {
  return JSON.stringify({
    acts: [
      {
        title: '1막',
        chapters: [
          {
            title: '1장',
            scenes: [
              {
                id: 'sc-1-1',
                title: '첫 만남',
                purpose: '두 사람이 만난다',
                characters: ['hana'],
              },
              {
                id: 'sc-1-2',
                title: '엇갈림',
                purpose: '오해가 생긴다',
                characters: ['hana', 'jun'],
              },
            ],
          },
        ],
      },
    ],
  });
}

function createMockOutlineCharacters(): string {
  return JSON.stringify({
    characters: [
      { id: 'hana', name: '하나', role: 'main', description: ['모의 주인공'] },
      { id: 'jun', name: '준', role: 'supporting', description: ['모의 조연'] },
    ],
  });
}

function extractMockValueIds(prompt: string): string[] {
  const block: string = prompt.split('[값]')[1]?.split(/\n\n|\n[a-z0-9-]+: /)[0] ?? '';

  return block
    .split('\n')
    .map((line) => /^- ([a-z0-9-]+):/.exec(line.trim())?.[1])
    .filter((id): id is string => id !== undefined);
}

function isMockBackgroundPrompt(prompt: string): boolean {
  return prompt.includes('[카드 종류]\n배경') || prompt.startsWith('[장소]');
}

function createMockInterviewAxes(prompt: string): string {
  const axes: readonly { id: string; label: string; values: { id: string; label: string }[] }[] =
    isMockBackgroundPrompt(prompt)
      ? [
          {
            id: 'exits',
            label: '드나드는 길',
            values: [
              { id: 'single-door', label: '정문 하나' },
              { id: 'back-door', label: '뒷문 있음' },
              { id: 'window', label: '창으로 드나듦' },
            ],
          },
          {
            id: 'watchers',
            label: '늘 있는 사람',
            values: [
              { id: 'owner', label: '주인이 지킨다' },
              { id: 'nobody', label: '아무도 없다' },
              { id: 'crowd', label: '손님이 붐빈다' },
            ],
          },
        ]
      : [
          {
            id: 'pressure-defense',
            label: '압박 아래 방어',
            values: [
              { id: 'counter', label: '역공' },
              { id: 'withhold', label: '침묵' },
              { id: 'deflect', label: '비탈' },
            ],
          },
          {
            id: 'affection',
            label: '호감 표출',
            values: [
              { id: 'direct', label: '직접' },
              { id: 'indirect', label: '우회' },
              { id: 'deny', label: '부정' },
            ],
          },
        ];

  return JSON.stringify({ axes });
}

function createMockInterviewQuestion(prompt: string): string {
  const valueIds: string[] = extractMockValueIds(prompt);
  const axisId: string = /^([a-z0-9-]+): /m.exec(prompt.split('[열린 축]')[1] ?? '')?.[1] ?? '';

  return JSON.stringify({
    axisId,
    question: '[Mock AI] 이 상황에서 어떻게 하는가?',
    options: valueIds.slice(0, 3).map((valueId) => ({ valueId, text: `[Mock AI] ${valueId} 반응` })),
  });
}

function createMockInterviewUpdate(prompt: string): string {
  const [firstValueId] = extractMockValueIds(prompt);

  return JSON.stringify({
    summary: '[Mock AI] 몰릴 때 먼저 참고, 밀리면 되묻는 쪽으로 기울인다.',
    ...(firstValueId === undefined ? {} : { classification: { valueId: firstValueId } }),
  });
}

function createMockInterviewDistill(prompt: string): string {
  return JSON.stringify(
    isMockBackgroundPrompt(prompt)
      ? { layout: ['[Mock AI] 출입구는 정문 하나다'], rules: ['[Mock AI] 밤에는 주인이 카운터를 지킨다'] }
      : { traits: ['[Mock AI] 몰릴 때 먼저 참고, 밀리면 되묻는 쪽으로 기울인다'], voice: [], relationSpeech: [] },
  );
}

const mockResponseBuilders: Readonly<Partial<Record<AiTaskName, MockResponseBuilder>>> = {
  interviewAxes: createMockInterviewAxes,
  interviewQuestion: createMockInterviewQuestion,
  interviewUpdate: createMockInterviewUpdate,
  interviewDistill: createMockInterviewDistill,
  situationExtraction: (promptSummary: string): string =>
    JSON.stringify([
      {
        characters: [],
        situation: extractSceneInput(promptSummary),
      },
    ]),
  sceneDraft: (promptSummary: string): string =>
    ['[Mock AI: sceneDraft]', extractDraftInput(promptSummary)].join('\n'),
  sceneSkeleton: createMockSceneSkeleton,
  sceneDialoguePolish: createMockDialoguePolish,
  sceneBeatActor: createMockBeatProposal,
  sceneBeatArbiter: createMockBeatPassage,
  sceneBeatJudge: createMockBeatVerdict,
  traitsExtraction: (): string =>
    ['- 상황을 관찰하고 차분하게 반응함', '- 대화 속에서 감정을 분명하게 드러냄'].join('\n'),
  grammarCheck: createMockGrammarIssues,
  continuityCheck: (): string => '[]',
  factExtraction: (): string => '[]',
  cardFactExtraction: (): string =>
    JSON.stringify({ attributes: [], relations: [], arc: { summary: '' } }),
  backgroundFactConflicts: (): string => JSON.stringify({ conflicts: [] }),
  backgroundFactExtraction: (): string =>
    JSON.stringify({
      description: [],
      senses: [],
      time: '',
      weather: '',
      characterNames: [],
    }),
  cardRecommendation: (): string => '[]',
  storyCompletion: createMockStoryCompletion,
  storyCardBuild: (): string => JSON.stringify({ entities: [] }),
  noteExtraction: (): string =>
    JSON.stringify({ notes: [], entities: [], scenes: [], premise: [] }),
  noteSynthesis: (): string => JSON.stringify({ setting: {}, synopsis: {} }),
  noteCardConsolidation: (): string => JSON.stringify({ cards: [] }),
  cardFactVerification: (): string => '[]',
  sceneGrounding: (): string =>
    JSON.stringify({
      incident: '모의 사건',
      place: '모의 장소',
      relation: '모의 관계',
      time: '모의 시점',
    }),
  sceneBeats: (): string => JSON.stringify(['모의 비트 하나', '모의 비트 둘', '모의 비트 셋']),
  sceneStructure: createMockSceneStructure,
  outlineSynopsis: (): string =>
    JSON.stringify({
      logline: '모의 로그라인',
      mainConflicts: ['모의 갈등'],
      ending: '모의 결말',
    }),
  chapterPlan: createMockChapterPlan,
  outlineCharacters: createMockOutlineCharacters,
  inlineCompletion: createMockInlineCompletion,
  draftExpansion: createMockDraftExpansion,
};

function createMockResponse(taskName: AiTaskName, userPrompt: string): string {
  const promptSummary: string = userPrompt.length > 0 ? userPrompt : '입력된 프롬프트가 없습니다.';
  const buildResponse: MockResponseBuilder | undefined = mockResponseBuilders[taskName];

  return buildResponse === undefined
    ? `[Mock AI: ${taskName}] ${promptSummary}`
    : buildResponse(promptSummary);
}

function extractSceneInput(prompt: string): string {
  const marker: string = 'User Input:\n';
  const markerIndex: number = prompt.indexOf(marker);

  if (markerIndex === -1) {
    return prompt;
  }

  const inputStart: number = markerIndex + marker.length;
  const outputMarkerIndex: number = prompt.indexOf('\n\nOutput only the JSON array.', inputStart);
  const input: string =
    outputMarkerIndex === -1
      ? prompt.slice(inputStart)
      : prompt.slice(inputStart, outputMarkerIndex);

  return input.trim() || '모의 상황';
}

function createMockSceneSkeleton(prompt: string): string {
  return [
    `[Mock AI: sceneSkeleton] ${prompt}`,
    '“모의 대사 하나입니다.” “모의 대사 둘입니다.”',
  ].join('\n\n');
}

function createMockDialoguePolish(prompt: string): string {
  const self: string | undefined = /^\[이 인물\]\n(.+)$/m.exec(prompt)?.[1]?.trim();
  if (self === undefined) {
    return '[]';
  }

  const others: string[] = (/^\[다른 등장 인물\]\n((?:- .+\n?)+)/m.exec(prompt)?.[1] ?? '')
    .split('\n')
    .map((line) => line.replace(/^- /, '').split(':')[0]?.trim() ?? '')
    .filter((name) => name.length > 0);
  const cast: string[] = [self, ...others].sort();
  const position: number = cast.indexOf(self);
  const rewrites: MockLineRewrite[] = [...prompt.matchAll(/⟨(\d+)⟩“([^”\n]*)”/g)].flatMap((match) => {
    const index: number = Number(match[1]);
    return (index - 1) % cast.length === position
      ? [{ n: index, text: `다듬은 ${match[2] ?? ''}` }]
      : [];
  });

  return JSON.stringify(rewrites);
}

function createMockBeatProposal(prompt: string): string {
  const name: string = /^\[인물\] (.+)$/m.exec(prompt)?.[1]?.trim() ?? '인물';

  return JSON.stringify({
    inner: `${name}의 모의 속마음입니다.`,
    options: [
      { strategy: '밀어붙이기', action: `${name}이(가) 한 발 다가선다.`, lines: ['모의 대사 하나입니다.'] },
      { strategy: '물러서기', action: `${name}이(가) 시선을 피한다.`, lines: ['모의 대사 둘입니다.'] },
    ],
  });
}

function createMockBeatPassage(prompt: string): string {
  const directive: RegExpExecArray | null = /^\[감독 지시 — 대목 (\d+)\]\n(.+)$/m.exec(prompt);
  const names: (string | undefined)[] = [...prompt.matchAll(/^\[배우 제안 — (.+)\]$/gm)].map((match) => match[1]?.trim());

  return [
    `[선택: ${names.map((name) => `${name}=1`).join(', ')}]`,
    `[Mock AI: sceneBeatArbiter] ${directive?.[2] ?? prompt}`,
    '“모의 대사 하나입니다.”',
  ].join('\n');
}

function createMockBeatVerdict(prompt: string): string {
  const names: string[] = (/^인물 이름: (.+)$/m.exec(prompt)?.[1] ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  return JSON.stringify({
    scores: names.map((name) => ({ name, score: 5, reason: '모의 채점', avoid: '' })),
    beatCovered: true,
    beatMissing: '',
    earlyMaterial: '',
    repeats: '',
  });
}

function extractDraftInput(prompt: string): string {
  const lastBlankLineIndex: number = prompt.lastIndexOf('\n\n');
  const input: string = lastBlankLineIndex === -1 ? prompt : prompt.slice(lastBlankLineIndex + 2);

  return input.trim() || prompt;
}

function createMockGrammarIssues(prompt: string): string {
  const subject: string = extractLastContentLine(prompt, '문장을 확인해주세요.');

  return JSON.stringify([
    {
      start: 0,
      end: Math.min(3, subject.length),
      original: subject.slice(0, Math.min(3, subject.length)),
      suggestion: '교정',
      reason: '모의 문법 검사 결과입니다.',
    },
  ]);
}

function createMockInlineCompletion(prompt: string): string {
  const seed: string = extractLastContentLine(prompt, '그는 잠시 숨을 고르고');
  return `${seed} 다음 말을 조심스럽게 이어 갔다.`;
}

function createMockDraftExpansion(prompt: string): string {
  const selection: string = extractLastContentLine(prompt, '그는 문을 열었다.');
  return `${selection}\n\n주변 공기는 묵직했고, 발걸음이 멈출 때마다 긴장이 더 선명해졌다.`;
}

function extractLastContentLine(prompt: string, fallback: string): string {
  const line: string | undefined = prompt
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .at(-1);

  return line ?? fallback;
}

registerProviderFactory('mock', () => new MockAiProvider());
