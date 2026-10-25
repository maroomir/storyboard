import type { AiTextGateway } from './AiTextGateway';
import { toPromptMessages } from './aiResponseCoercion';
import {
  StudioAgentPrompt,
  type StudioAgentPatchShape,
  type StudioAgentPromptInput,
} from './prompts/studioAgent';
import { StudioCardAuditPrompt, type StudioCardAuditPromptInput } from './prompts/studioCardAudit';
import { StudioCardSeedPrompt } from './prompts/studioCardSeed';
import { StudioValidationPrompt } from './prompts/studioValidation';
import type { GenerateTextOptions } from './aiServiceTypes';
import {
  coerceStudioAgentAction,
  type StudioAgentAction,
  type StudioAgentInvokeRequest,
  type StudioAgentLookupRequest,
  type StudioAgentToolName,
  coerceStudioCardSeed,
  type StudioCardSeed,
  coerceStudioValidationVerdict,
  type StudioValidationVerdict,
  type AiGenerateResponse,
} from '@storyboard/story-model';
import type { PromptArtifact } from '#ai/ai/prompts/types';

export interface StudioAgentMessage {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export type StudioLookupResolver = (
  requests: readonly StudioAgentLookupRequest[],
) => Promise<string>;

export type StudioInvokeResolver = (request: StudioAgentInvokeRequest) => Promise<string>;

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
  readonly pinnedTool?: StudioAgentToolName;
  readonly resolveLookup?: StudioLookupResolver;
  readonly resolveInvoke?: StudioInvokeResolver;
}

export interface StudioValidationInput {
  readonly entityLabel: string;
  readonly context: string;
  readonly summary: string;
  readonly diff: string;
}

export type StudioAgentStage = 'thinking' | 'looking-up' | 'invoking';

export interface StudioAgentRunOptions extends GenerateTextOptions {
  readonly onStage?: (stage: StudioAgentStage) => void;
}

const maxLookupRounds: number = 3;
const maxInvokeRounds: number = 2;

const unreadableResponseMessage: string =
  '응답을 이해하지 못했어요. 조금 더 구체적으로 말씀해 주시겠어요?';

export class StudioAgentService {
  public constructor(private readonly gateway: AiTextGateway) {}

  public async run(
    input: StudioAgentRunInput,
    options: StudioAgentRunOptions = {},
  ): Promise<StudioAgentAction> {
    const { onStage, ...generateOptions } = options;
    const gathered: string[] = [];
    let lookupsUsed: number = 0;
    let invokesUsed: number = 0;

    for (let round: number = 0; ; round += 1) {
      onStage?.(round === 0 ? 'thinking' : 'looking-up');

      const canInvoke: boolean = Boolean(input.resolveInvoke) && invokesUsed < maxInvokeRounds;

      const action: StudioAgentAction = await this.requestAction(
        input,
        gathered,
        {
          canLookup: Boolean(input.resolveLookup) && lookupsUsed < maxLookupRounds,
          canInvoke,
          ...(canInvoke && invokesUsed === 0 && input.pinnedTool !== undefined
            ? { pinnedTool: input.pinnedTool }
            : {}),
        },
        generateOptions,
      );

      if (action.kind === 'lookup') {
        if (!input.resolveLookup || lookupsUsed >= maxLookupRounds) {
          return { kind: 'say', message: unresolvedLookupMessage(action.requests) };
        }

        lookupsUsed += 1;
        gathered.push(await input.resolveLookup(action.requests));
        continue;
      }

      if (action.kind === 'invoke') {
        if (!input.resolveInvoke || invokesUsed >= maxInvokeRounds) {
          return { kind: 'say', message: unresolvedInvokeMessage };
        }

        invokesUsed += 1;
        onStage?.('invoking');
        gathered.push(await input.resolveInvoke(action.request));
        continue;
      }

      return action;
    }
  }

  public async validate(
    input: StudioValidationInput,
    options: GenerateTextOptions = {},
  ): Promise<StudioValidationVerdict> {
    const prompt: PromptArtifact = StudioValidationPrompt.build(input);
    const response: AiGenerateResponse = await this.gateway.generate(
      'studioValidation',
      toPromptMessages(prompt),
      {
        ...StudioValidationPrompt.config,
        ...options,
      },
    );

    return coerceStudioValidationVerdict(response.text);
  }

  public async auditEntity(
    input: StudioCardAuditPromptInput,
    options: GenerateTextOptions = {},
  ): Promise<StudioValidationVerdict> {
    const prompt: PromptArtifact = StudioCardAuditPrompt.build(input);
    const response: AiGenerateResponse = await this.gateway.generate(
      'studioValidation',
      toPromptMessages(prompt),
      {
        ...StudioCardAuditPrompt.config,
        ...options,
      },
    );

    return coerceStudioValidationVerdict(response.text);
  }

  public async seedCard(
    description: string,
    options: GenerateTextOptions = {},
  ): Promise<StudioCardSeed | undefined> {
    const prompt: PromptArtifact = StudioCardSeedPrompt.build(description);
    const response: AiGenerateResponse = await this.gateway.generate(
      'studioAgent',
      toPromptMessages(prompt),
      {
        ...StudioCardSeedPrompt.config,
        ...options,
      },
    );

    return coerceStudioCardSeed(response.text);
  }

  private async requestAction(
    input: StudioAgentRunInput,
    gathered: readonly string[],
    ability: {
      readonly canLookup: boolean;
      readonly canInvoke: boolean;
      readonly pinnedTool?: StudioAgentToolName;
    },
    options: GenerateTextOptions,
  ): Promise<StudioAgentAction> {
    const prompt: PromptArtifact = StudioAgentPrompt.build({
      entityKind: input.entityKind,
      patchShape: input.patchShape,
      entityLabel: input.entityLabel,
      targetFile: input.targetFile,
      context: joinContext(input.context, gathered),
      conversation: formatConversation(input.history),
      instruction: input.instruction,
      canAsk: input.remainingQuestions > 0,
      canLookup: ability.canLookup,
      canInvoke: ability.canInvoke,
      ...(ability.pinnedTool === undefined ? {} : { pinnedTool: ability.pinnedTool }),
      hasSelection: input.hasSelection,
    });

    const response: AiGenerateResponse = await this.gateway.generate(
      'studioAgent',
      toPromptMessages(prompt),
      {
        ...StudioAgentPrompt.config,
        ...options,
      },
    );

    const action: StudioAgentAction | undefined = coerceStudioAgentAction(response.text);

    if (!action) {
      return { kind: 'say', message: unreadableResponseMessage };
    }

    return action.kind === 'ask' && input.remainingQuestions <= 0
      ? { kind: 'say', message: action.question }
      : action;
  }
}

function joinContext(context: string, gathered: readonly string[]): string {
  return gathered.length === 0 ? context : [context, ...gathered].join('\n\n');
}

function formatConversation(history: readonly StudioAgentMessage[]): string {
  return history.map((message) => `${roleLabel(message.role)}: ${message.text}`).join('\n');
}

function roleLabel(role: StudioAgentMessage['role']): string {
  return role === 'user' ? '작가' : '조수';
}

function unresolvedLookupMessage(requests: readonly StudioAgentLookupRequest[]): string {
  const names: string = requests.map((request) => request.key).join(', ');

  return `판단하려면 ${names} 내용을 확인해야 하는데 지금은 읽을 수 없어요. 필요한 내용을 알려주시겠어요?`;
}

const unresolvedInvokeMessage: string =
  '이번 턴에 쓸 수 있는 도구 호출을 모두 썼어요. 필요한 작업을 다시 말씀해 주시겠어요?';
