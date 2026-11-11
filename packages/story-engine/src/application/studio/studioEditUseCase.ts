import { randomUUID } from 'node:crypto';

import type {
  StoryUri,
  StudioChatTurn,
  StudioEntity,
  StudioProposalTurn,
  UsageAttribution,
} from '@storyboard/story-model';

import type { IUseCase } from '#engine/application/useCase';
import type { StudioChatUseCase } from '#engine/application/studio/studioChatUseCase';
import type {
  StudioProposalApplier,
  StudioProposalApplyResult,
  StudioProposalPreparation,
} from '#engine/application/studio/studioProposalApplier';
import type {
  StudioContextRepository,
  StudioEntityContext,
} from '#engine/persistence/studioContextRepository';
import type { StudioSessionRepository } from '#engine/persistence/repositories/studioSessionRepository';

export interface StudioEditUseCaseDependencies {
  readonly chat: StudioChatUseCase;
  readonly context: StudioContextRepository;
  readonly sessions: StudioSessionRepository;
  readonly applier: StudioProposalApplier;
}

export interface StudioEditRequest {
  readonly workspaceRoot: StoryUri;
  readonly entity: StudioEntity;
  readonly instruction: string;
  readonly shouldPropose: boolean;
  readonly isValidationEnabled: boolean;
  readonly attribution?: UsageAttribution;
  readonly isPreview?: boolean;
}

export interface StudioProposalDiff {
  readonly targetFile: string;
  readonly before: string;
  readonly after: string;
}

export type StudioEditResult =
  | {
      readonly ok: true;
      readonly kind: 'applied';
      readonly sessionId: string;
      readonly summary: string;
      readonly message: string;
    }
  | {
      readonly ok: true;
      readonly kind: 'proposed';
      readonly sessionId: string;
      readonly summary: string;
      readonly diff: StudioProposalDiff;
    }
  | { readonly ok: true; readonly kind: 'replied'; readonly sessionId: string; readonly message: string }
  | { readonly ok: false; readonly kind: 'missing' | 'failed'; readonly message: string };

function replyOf(turns: readonly StudioChatTurn[]): string {
  return turns
    .map((turn) => {
      if (turn.role !== 'assistant') {
        return '';
      }
      if (turn.kind === 'say') {
        return turn.message;
      }
      return turn.kind === 'ask' ? turn.question : '';
    })
    .filter((text) => text.length > 0)
    .join('\n');
}

function findProposal(turns: readonly StudioChatTurn[]): StudioProposalTurn | undefined {
  return turns.find(
    (turn): turn is StudioProposalTurn => turn.role === 'assistant' && turn.kind === 'proposal',
  );
}

export class StudioEditUseCase implements IUseCase<StudioEditRequest, StudioEditResult> {
  public constructor(private readonly dependencies: StudioEditUseCaseDependencies) {}

  public async execute(request: StudioEditRequest): Promise<StudioEditResult> {
    const entityContext: StudioEntityContext | undefined =
      await this.dependencies.context.readEntityContext(request.workspaceRoot, request.entity, 'card');
    if (entityContext === undefined) {
      return { ok: false, kind: 'missing', message: `고칠 대상이 없습니다: ${request.entity.key}` };
    }

    const sessionId: string = randomUUID();
    const createdAt: string = new Date().toISOString();
    const userTurn: StudioChatTurn = { id: randomUUID(), role: 'user', text: request.instruction };
    const replies: readonly StudioChatTurn[] = await this.runChat(request, entityContext);
    const proposal: StudioProposalTurn | undefined = findProposal(replies);
    const shouldKeepSession: boolean = request.isPreview !== true;
    const record = async (turns: readonly StudioChatTurn[], hasAppliedChanges: boolean): Promise<void> => {
      if (!shouldKeepSession) {
        return;
      }

      await this.dependencies.sessions.save(request.workspaceRoot, {
        id: sessionId,
        entity: request.entity,
        createdAt,
        hasAppliedChanges,
        turns: [userTurn, ...turns],
      });
    };

    if (proposal === undefined) {
      await record(replies, false);
      return { ok: true, kind: 'replied', sessionId, message: replyOf(replies) };
    }

    return request.shouldPropose
      ? await this.keepPending(request, sessionId, proposal, replies, record)
      : await this.applyNow(request, sessionId, proposal, replies, record);
  }

  private async runChat(
    request: StudioEditRequest,
    entityContext: StudioEntityContext,
  ): Promise<readonly StudioChatTurn[]> {
    const { context } = this.dependencies;

    return await this.dependencies.chat.execute({
      workspaceRoot: request.workspaceRoot,
      entityContext,
      history: [],
      instruction: request.instruction,
      hasSelection: false,
      isValidationEnabled: request.isValidationEnabled,
      ...(request.attribution === undefined ? {} : { attribution: request.attribution }),
      resolveLookup: (requests) => context.resolveLookups(request.workspaceRoot, requests),
      resolveFollowUps: (followUps) => context.resolveFollowUps(request.workspaceRoot, followUps),
      createTurnId: () => randomUUID(),
    });
  }

  private async keepPending(
    request: StudioEditRequest,
    sessionId: string,
    proposal: StudioProposalTurn,
    replies: readonly StudioChatTurn[],
    record: (turns: readonly StudioChatTurn[], hasAppliedChanges: boolean) => Promise<void>,
  ): Promise<StudioEditResult> {
    const prepared: StudioProposalPreparation = await this.dependencies.applier.prepare(
      request.workspaceRoot,
      request.entity,
      proposal,
    );
    if (!prepared.ok) {
      return { ok: false, kind: 'failed', message: prepared.message };
    }

    await record(replies, false);
    return {
      ok: true,
      kind: 'proposed',
      sessionId,
      summary: proposal.summary,
      diff: { targetFile: prepared.targetFile, before: prepared.baseline, after: prepared.text },
    };
  }

  private async applyNow(
    request: StudioEditRequest,
    sessionId: string,
    proposal: StudioProposalTurn,
    replies: readonly StudioChatTurn[],
    record: (turns: readonly StudioChatTurn[], hasAppliedChanges: boolean) => Promise<void>,
  ): Promise<StudioEditResult> {
    const applied: StudioProposalApplyResult = await this.dependencies.applier.apply(
      request.workspaceRoot,
      request.entity,
      proposal,
    );
    const isApplied: boolean = applied.status === 'applied';
    const settled: readonly StudioChatTurn[] = replies.map((turn) =>
      turn === proposal
        ? {
            ...proposal,
            status: applied.status,
            ...(isApplied ? {} : { errorMessage: applied.message }),
          }
        : turn,
    );

    await record(settled, isApplied);
    return isApplied
      ? { ok: true, kind: 'applied', sessionId, summary: proposal.summary, message: applied.message }
      : { ok: false, kind: 'failed', message: applied.message };
  }
}
