import type { AiTextGateway } from './AiTextGateway';
import { toPromptMessages } from './aiResponseCoercion';
import {
  StudioAgentPrompt,
  type StudioAgentPatchShape,
  type StudioAgentPromptInput,
} from './prompts/studioAgent';
import { StudioValidationPrompt } from './prompts/studioValidation';
import type { GenerateTextOptions } from './aiServiceTypes';
import {
  coerceStudioAgentAction,
  type StudioAgentAction,
  type StudioAgentLookupRequest,
} from '../contracts/studioAgent';
import {
  coerceStudioValidationVerdict,
  type StudioValidationVerdict,
} from '../contracts/studioValidation';

export interface StudioAgentMessage {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export type StudioLookupResolver = (
  requests: readonly StudioAgentLookupRequest[],
) => Promise<string>;

export interface StudioAgentRunInput {
  readonly entityKind: StudioAgentPromptInput['entityKind'];
  readonly patchShape: StudioAgentPatchShape;
  readonly entityLabel: string;
  readonly targetFile: string;
  readonly context: string;
  readonly history: readonly StudioAgentMessage[];
  readonly instruction: string;
  readonly hasSelection: boolean;
  readonly remainingQuestions: number;
  readonly resolveLookup?: StudioLookupResolver;
}

export interface StudioValidationInput {
  readonly entityLabel: string;
  readonly context: string;
  readonly summary: string;
  readonly diff: string;
}

export type StudioAgentStage = 'thinking' | 'looking-up';

export interface StudioAgentRunOptions extends GenerateTextOptions {
  readonly onStage?: (stage: StudioAgentStage) => void;
}

// NOTE: one turn may fan out into extra provider calls for lookups; the cap keeps a confused model
// from spending the author's budget in a loop.
const maxLookupRounds = 3;

const unreadableResponseMessage =
  '응답을 이해하지 못했어요. 조금 더 구체적으로 말씀해 주시겠어요?';

export class StudioAgentService {
  public constructor(private readonly gateway: AiTextGateway) {}

  public async run(
    input: StudioAgentRunInput,
    options: StudioAgentRunOptions = {},
  ): Promise<StudioAgentAction> {
    const { onStage, ...generateOptions } = options;
    const lookedUp: string[] = [];

    for (let round = 0; round <= maxLookupRounds; round += 1) {
      onStage?.(round === 0 ? 'thinking' : 'looking-up');

      const action = await this.requestAction(input, lookedUp, round, generateOptions);

      if (action.kind !== 'lookup') {
        return action;
      }

      if (!input.resolveLookup || round === maxLookupRounds) {
        return { kind: 'say', message: unresolvedLookupMessage(action.requests) };
      }

      lookedUp.push(await input.resolveLookup(action.requests));
    }

    return { kind: 'say', message: unreadableResponseMessage };
  }

  public async validate(
    input: StudioValidationInput,
    options: GenerateTextOptions = {},
  ): Promise<StudioValidationVerdict> {
    const prompt = StudioValidationPrompt.build(input);
    const response = await this.gateway.generate('studioValidation', toPromptMessages(prompt), {
      ...StudioValidationPrompt.config,
      ...options,
    });

    return coerceStudioValidationVerdict(response.text);
  }

  private async requestAction(
    input: StudioAgentRunInput,
    lookedUp: readonly string[],
    round: number,
    options: GenerateTextOptions,
  ): Promise<StudioAgentAction> {
    const prompt = StudioAgentPrompt.build({
      entityKind: input.entityKind,
      patchShape: input.patchShape,
      entityLabel: input.entityLabel,
      targetFile: input.targetFile,
      context: joinContext(input.context, lookedUp),
      conversation: formatConversation(input.history),
      instruction: input.instruction,
      canAsk: input.remainingQuestions > 0,
      canLookup: Boolean(input.resolveLookup) && round < maxLookupRounds,
      hasSelection: input.hasSelection,
    });

    const response = await this.gateway.generate('studioAgent', toPromptMessages(prompt), {
      ...StudioAgentPrompt.config,
      ...options,
    });

    const action = coerceStudioAgentAction(response.text);

    if (!action) {
      return { kind: 'say', message: unreadableResponseMessage };
    }

    // NOTE: the question budget is enforced here rather than trusted to the prompt, so an
    // over-eager model turns into a plain remark instead of another round of questions.
    return action.kind === 'ask' && input.remainingQuestions <= 0
      ? { kind: 'say', message: action.question }
      : action;
  }
}

function joinContext(context: string, lookedUp: readonly string[]): string {
  return lookedUp.length === 0 ? context : [context, ...lookedUp].join('\n\n');
}

function formatConversation(history: readonly StudioAgentMessage[]): string {
  return history.map((message) => `${roleLabel(message.role)}: ${message.text}`).join('\n');
}

function roleLabel(role: StudioAgentMessage['role']): string {
  return role === 'user' ? '작가' : '조수';
}

function unresolvedLookupMessage(requests: readonly StudioAgentLookupRequest[]): string {
  const names = requests.map((request) => request.key).join(', ');

  return `판단하려면 ${names} 내용을 확인해야 하는데 지금은 읽을 수 없어요. 필요한 내용을 알려주시겠어요?`;
}
