import { createHash } from 'node:crypto';

import type {
  StudioAgentAction,
  StudioAgentFollowUp,
  StudioAgentInvokeRequest,
  StudioAgentLookupRequest,
  StudioAgentMessage,
  StudioAgentToolName,
} from '@storyboard/story-ai';

import type { AiGateway } from '../ai/aiGateway';
import type { StoryUri, StudioPatchTarget } from '@storyboard/story-engine';
import type { StoryboardLogger } from '@storyboard/story-engine';
import type {
  StudioChatTurn,
  StudioFollowUpTarget,
  StudioPatchPayload,
  StudioValidation,
} from '@storyboard/story-engine';

export interface StudioChatContext {
  readonly agentEntityKind: 'character' | 'background' | 'scene';
  readonly patchTarget: StudioPatchTarget;
  readonly entityLabel: string;
  readonly targetFile: string;
  readonly context: string;
  readonly baseline: string | undefined;
}

export interface StudioChatRequest {
  readonly workspaceRoot: StoryUri;
  readonly entityContext: StudioChatContext;
  readonly history: readonly StudioChatTurn[];
  readonly instruction: string;
  readonly hasSelection: boolean;
  readonly pinnedTool?: StudioAgentToolName;
  readonly isValidationEnabled: boolean;
  readonly resolveLookup: (requests: readonly StudioAgentLookupRequest[]) => Promise<string>;
  readonly resolveInvoke?: (request: StudioAgentInvokeRequest) => Promise<string>;
  // NOTE: the model names follow-up targets from memory, so each one is confirmed against the
  // workspace before it becomes a button the author can press.
  readonly resolveFollowUps: (
    followUps: readonly StudioAgentFollowUp[],
  ) => Promise<readonly StudioFollowUpTarget[]>;
  readonly createTurnId: () => string;
  readonly onStage?: (stage: StudioChatStage) => void;
}

export type StudioChatStage = 'thinking' | 'looking-up' | 'invoking' | 'validating';

export const maxStudioQuestions = 5;

export class StudioChatUseCase {
  public constructor(
    private readonly aiGateway: AiGateway,
    private readonly logger: StoryboardLogger,
  ) {}

  public async send(request: StudioChatRequest): Promise<readonly StudioChatTurn[]> {
    const service = this.aiGateway.createService(request.workspaceRoot);

    const action = await service.runStudioAgent(
      {
        entityKind: request.entityContext.agentEntityKind,
        patchShape: request.entityContext.patchTarget,
        entityLabel: request.entityContext.entityLabel,
        targetFile: request.entityContext.targetFile,
        context: request.entityContext.context,
        history: toAgentHistory(request.history),
        instruction: request.instruction,
        hasSelection: request.hasSelection,
        remainingQuestions: remainingQuestions(request.history),
        ...(request.pinnedTool === undefined ? {} : { pinnedTool: request.pinnedTool }),
        resolveLookup: request.resolveLookup,
        ...(request.resolveInvoke === undefined ? {} : { resolveInvoke: request.resolveInvoke }),
      },
      { onStage: (stage) => request.onStage?.(stage) },
    );

    const followUps = await request.resolveFollowUps(followUpsOf(action));

    if (action.kind !== 'propose') {
      return [toPlainTurn(action, request.createTurnId(), followUps)];
    }

    if (request.entityContext.baseline === undefined) {
      return [
        {
          id: request.createTurnId(),
          role: 'assistant',
          kind: 'say',
          message: `${request.entityContext.targetFile} 파일이 아직 없어 수정을 적용할 수 없어요.`,
        },
      ];
    }

    const patch = action.patch as StudioPatchPayload;

    return [
      {
        id: request.createTurnId(),
        role: 'assistant',
        kind: 'proposal',
        summary: action.summary,
        ...(action.message === undefined ? {} : { message: action.message }),
        targetFile: request.entityContext.targetFile,
        patch,
        baselineHash: hashBaseline(request.entityContext.baseline),
        validation: await this.validate(request, action, patch),
        status: 'pending',
        ...(followUps.length > 0 ? { followUps: [...followUps] } : {}),
      },
    ];
  }

  private async validate(
    request: StudioChatRequest,
    action: Extract<StudioAgentAction, { readonly kind: 'propose' }>,
    patch: StudioPatchPayload,
  ): Promise<StudioValidation> {
    if (!request.isValidationEnabled) {
      return { state: 'skipped', warnings: [] };
    }

    request.onStage?.('validating');

    try {
      const verdict = await this.aiGateway
        .createService(request.workspaceRoot)
        .validateStudioProposal({
          entityLabel: request.entityContext.entityLabel,
          context: request.entityContext.context,
          summary: action.summary,
          diff: describePatch(patch),
        });

      return {
        state: verdict.state,
        warnings: verdict.warnings.map((warning) => ({ ...warning })),
      };
    } catch (error) {
      // NOTE: a failed check must not block the author, so it degrades to 'skipped' and says so.
      this.logger.warn(`Studio 정합성 검사 실패: ${String(error)}`);
      return { state: 'skipped', warnings: [] };
    }
  }
}

export function hashBaseline(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// NOTE: the cap counts questions already asked in this session so a stubborn ambiguity cannot turn
// the conversation into an interrogation.
function remainingQuestions(history: readonly StudioChatTurn[]): number {
  const asked = history.filter((turn) => turn.role === 'assistant' && turn.kind === 'ask').length;

  return Math.max(0, maxStudioQuestions - asked);
}

function toAgentHistory(history: readonly StudioChatTurn[]): StudioAgentMessage[] {
  return history
    .map((turn): StudioAgentMessage | undefined => {
      if (turn.role === 'user') {
        return { role: 'user', text: turn.text };
      }

      switch (turn.kind) {
        case 'say':
          return { role: 'assistant', text: turn.message };
        case 'ask':
          return { role: 'assistant', text: turn.question };
        case 'proposal':
          return { role: 'assistant', text: `제안(${turn.status}): ${turn.summary}` };
        case 'result':
          return { role: 'assistant', text: turn.message };
      }
    })
    .filter((message): message is StudioAgentMessage => message !== undefined);
}

function describeEntry(entry: string | Readonly<Record<string, string>>): string {
  return typeof entry === 'string'
    ? entry
    : Object.entries(entry)
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ');
}

function followUpsOf(action: StudioAgentAction): readonly StudioAgentFollowUp[] {
  return action.kind === 'say' || action.kind === 'propose' ? (action.followUps ?? []) : [];
}

function toPlainTurn(
  action: StudioAgentAction,
  id: string,
  followUps: readonly StudioFollowUpTarget[],
): StudioChatTurn {
  if (action.kind === 'ask') {
    return {
      id,
      role: 'assistant',
      kind: 'ask',
      question: action.question,
      options: [...action.options],
    };
  }

  return {
    id,
    role: 'assistant',
    kind: 'say',
    message: action.kind === 'say' ? action.message : '수정안을 만들지 못했어요.',
    ...(followUps.length > 0 ? { followUps: [...followUps] } : {}),
  };
}

export function describePatch(patch: StudioPatchPayload): string {
  if (patch.target === 'card') {
    return patch.changes
      .map((change) =>
        Array.isArray(change.value)
          ? `${change.field}:\n${change.value.map((entry) => `  - ${describeEntry(entry)}`).join('\n')}`
          : `${change.field}: ${String(change.value)}`,
      )
      .join('\n');
  }

  return patch.replacements
    .map(
      (replacement) =>
        `[${replacement.startOffset}-${replacement.endOffset}]\n${replacement.newText}`,
    )
    .join('\n\n');
}
