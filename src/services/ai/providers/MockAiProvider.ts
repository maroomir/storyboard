import { aiGenerateResponseWithUsage } from '../cost';
import {
  type AiGenerateRequest,
  type AiGenerateResponse,
  type AiProvider,
  type AiProviderId,
  type AiTaskName,
  type AiUsage,
} from '../types';

const mockCatalogModelId = 'mock-default';

export class MockAiProvider implements AiProvider {
  public readonly id: AiProviderId = 'mock';
  public readonly displayName = 'Mock AI';

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
    case 'personaDialogue':
      return createMockPersonaOrDialogue(promptSummary);
    case 'sceneDraft':
      return [`[Mock AI: ${taskName}]`, extractDraftInput(promptSummary)].join('\n');
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
    case 'cardFactVerification':
      return '[]';
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

function createMockPersonaOrDialogue(prompt: string): string {
  if (prompt.includes('캐릭터 정보를 바탕으로 1인칭 페르소나')) {
    return '나는 모의 응답으로 생성된 캐릭터 페르소나다. 상황에 맞춰 일관되게 말하고 행동한다.';
  }

  const speaker = extractFirstPersonaName(prompt) ?? '화자';
  return `${speaker}: "모의 초안 생성을 위한 대사입니다."\n${speaker}는 현재 상황을 차분히 받아들였다.`;
}

function extractFirstPersonaName(prompt: string): string | undefined {
  const match = /^\[([^\]]+)\]$/m.exec(prompt);
  return match?.[1]?.trim();
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
