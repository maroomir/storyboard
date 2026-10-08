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

const mockCatalogModelId = 'mock-default';

export class MockAiProvider implements AiProvider {
  public readonly id: AiProviderId = 'mock';
  public readonly displayName = getProviderDisplayName('mock');

  public async checkConnection(): Promise<boolean> {
    return true;
  }

  public async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    const userPrompt = request.messages
      .filter((message) => message.role === 'user')
      .map((message) => message.content.trim())
      .filter((content) => content.length > 0)
      .join('\n\n');

    const text = createMockResponse(request.taskName, userPrompt);
    const usage = syntheticUsageFromMessages(request, text);
    return aiGenerateResponseWithUsage({
      providerId: this.id,
      model: mockCatalogModelId,
      text,
      usage,
    });
  }
}

function syntheticUsageFromMessages(request: AiGenerateRequest, responseText: string): AiUsage {
  const promptChars = request.messages.map((message) => message.content).join('').length;

  return {
    inputTokens: Math.floor(promptChars / 4),
    outputTokens: Math.floor(responseText.length / 4),
  };
}

function createMockResponse(taskName: AiTaskName, userPrompt: string): string {
  const promptSummary = userPrompt.length > 0 ? userPrompt : '입력된 프롬프트가 없습니다.';

  switch (taskName) {
    case 'situationExtraction':
      return JSON.stringify([
        {
          characters: [],
          situation: extractSceneInput(promptSummary),
        },
      ]);
    case 'sceneDraft':
      return [`[Mock AI: ${taskName}]`, extractDraftInput(promptSummary)].join('\n');
    case 'sceneSkeleton':
      return createMockSceneSkeleton(promptSummary);
    case 'sceneDialoguePolish':
      return createMockDialoguePolish(promptSummary);
    case 'traitsExtraction':
      return ['- 상황을 관찰하고 차분하게 반응함', '- 대화 속에서 감정을 분명하게 드러냄'].join(
        '\n',
      );
    case 'grammarCheck':
      return createMockGrammarIssues(promptSummary);
    case 'continuityCheck':
      return '[]';
    case 'factExtraction':
      return '[]';
    case 'cardFactExtraction':
      return JSON.stringify({ attributes: [], relations: [], arc: { summary: '' } });
    case 'backgroundFactExtraction':
      return JSON.stringify({
        description: [],
        senses: [],
        time: '',
        weather: '',
        characterNames: [],
      });
    case 'cardRecommendation':
      return '[]';
    case 'storyCompletion':
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
    case 'storyCardBuild':
      return JSON.stringify({ entities: [] });
    case 'noteExtraction':
      return JSON.stringify({ notes: [], entities: [], scenes: [], premise: [] });
    case 'noteSynthesis':
      return JSON.stringify({ setting: {}, synopsis: {} });
    case 'noteCardConsolidation':
      return JSON.stringify({ cards: [] });
    case 'cardFactVerification':
      return '[]';
    case 'sceneGrounding':
      return JSON.stringify({
        incident: '모의 사건',
        place: '모의 장소',
        relation: '모의 관계',
        time: '모의 시점',
      });
    case 'sceneBeats':
      return JSON.stringify(['모의 비트 하나', '모의 비트 둘', '모의 비트 셋']);
    case 'sceneStructure':
      return JSON.stringify({
        purpose: '모의 목적',
        conflict: '모의 갈등',
        twist: '모의 반전',
        emotionalShift: '모의 감정 변화',
        foreshadowing: ['모의 복선'],
        neededCanon: ['모의 설정'],
      });
    case 'outlineSynopsis':
      return JSON.stringify({
        logline: '모의 로그라인',
        mainConflicts: ['모의 갈등'],
        ending: '모의 결말',
      });
    case 'chapterPlan':
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
    case 'outlineCharacters':
      return JSON.stringify({
        characters: [
          { id: 'hana', name: '하나', role: 'main', description: ['모의 주인공'] },
          { id: 'jun', name: '준', role: 'supporting', description: ['모의 조연'] },
        ],
      });
    case 'inlineCompletion':
      return createMockInlineCompletion(promptSummary);
    case 'draftExpansion':
      return createMockDraftExpansion(promptSummary);
  }

  return `[Mock AI: ${taskName}] ${promptSummary}`;
}

function extractSceneInput(prompt: string): string {
  const marker = 'User Input:\n';
  const markerIndex = prompt.indexOf(marker);

  if (markerIndex === -1) {
    return prompt;
  }

  const inputStart = markerIndex + marker.length;
  const outputMarkerIndex = prompt.indexOf('\n\nOutput only the JSON array.', inputStart);
  const input =
    outputMarkerIndex === -1
      ? prompt.slice(inputStart)
      : prompt.slice(inputStart, outputMarkerIndex);

  return input.trim() || '모의 상황';
}

// NOTE: 뼈대에 따옴표 대사가 없으면 다듬기 단계가 통째로 건너뛰어져, 골든 작품이 번호 병합 경로를
// 한 번도 지나지 않는다. 그래서 모의 뼈대는 대사 두 줄로 끝난다.
function createMockSceneSkeleton(prompt: string): string {
  return [
    `[Mock AI: sceneSkeleton] ${prompt}`,
    '“모의 대사 하나입니다.” “모의 대사 둘입니다.”',
  ].join('\n\n');
}

// 인물별 다듬기의 모의 응답. 등장 인물을 이름순으로 세워 번호를 돌아가며 나눠 가지므로 두 인물이
// 같은 번호를 가져가는 일이 없고, 손본 문장은 앞에 «다듬은»을 붙여 원고에서 알아볼 수 있다.
function createMockDialoguePolish(prompt: string): string {
  const self = /^\[이 인물\]\n(.+)$/m.exec(prompt)?.[1]?.trim();
  if (self === undefined) {
    return '[]';
  }

  const others = (/^\[다른 등장 인물\]\n(.+)$/m.exec(prompt)?.[1] ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const cast = [self, ...others].sort();
  const position = cast.indexOf(self);
  const rewrites = [...prompt.matchAll(/⟨(\d+)⟩“([^”\n]*)”/g)].flatMap((match) => {
    const index = Number(match[1]);
    return (index - 1) % cast.length === position
      ? [{ n: index, text: `다듬은 ${match[2] ?? ''}` }]
      : [];
  });

  return JSON.stringify(rewrites);
}

function extractDraftInput(prompt: string): string {
  const lastBlankLineIndex = prompt.lastIndexOf('\n\n');
  const input = lastBlankLineIndex === -1 ? prompt : prompt.slice(lastBlankLineIndex + 2);

  return input.trim() || prompt;
}

function createMockGrammarIssues(prompt: string): string {
  const subject = extractLastContentLine(prompt, '문장을 확인해주세요.');

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
  const seed = extractLastContentLine(prompt, '그는 잠시 숨을 고르고');
  return `${seed} 다음 말을 조심스럽게 이어 갔다.`;
}

function createMockDraftExpansion(prompt: string): string {
  const selection = extractLastContentLine(prompt, '그는 문을 열었다.');
  return `${selection}\n\n주변 공기는 묵직했고, 발걸음이 멈출 때마다 긴장이 더 선명해졌다.`;
}

function extractLastContentLine(prompt: string, fallback: string): string {
  const line = prompt
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .at(-1);

  return line ?? fallback;
}

registerProviderFactory('mock', () => new MockAiProvider());
