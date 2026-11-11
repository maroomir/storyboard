import { randomUUID } from 'node:crypto';

import {
  applyStudioPatch,
  extractDraftBody,
  isSafeStudioEntityKey,
  parseDraft,
  serializeDraft,
  type StoryUri,
  type StudioChatTurn,
  type StudioEntity,
  type StudioPatchResult,
  type StudioProposalTurn,
} from '@storyboard/story-model';

import { hashBaseline } from '#engine/application/studio/studioChatUseCase';
import type { DraftHistoryArchiver } from '#engine/application/drafts/draftHistoryArchiver';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { IStoryboardLogger } from '#engine/ports/logger';
import type {
  StudioContextRepository,
  StudioEntityContext,
  StudioSceneFocus,
} from '#engine/persistence/studioContextRepository';
import type { IStudioFollowUpRepository } from '#engine/persistence/repositories/studioFollowUpRepository';

export interface StudioProposalApplierDependencies {
  readonly fileSystem: IFileSystem;
  readonly logger: Pick<IStoryboardLogger, 'warn'>;
  readonly context: StudioContextRepository;
  readonly followUps: IStudioFollowUpRepository;
  readonly revisions: DraftHistoryArchiver;
  readonly createFollowUpId?: () => string;
}

export interface PreparedStudioProposal {
  readonly ok: true;
  readonly targetUri: StoryUri;
  readonly targetFile: string;
  readonly patchTarget: StudioEntityContext['patchTarget'];
  readonly entityKey: string;
  readonly baseline: string;
  readonly text: string;
  readonly changedFields: readonly string[];
  readonly lengthDelta: number;
}

export interface StudioProposalRefusal {
  readonly ok: false;
  readonly message: string;
}

export type StudioProposalPreparation = PreparedStudioProposal | StudioProposalRefusal;

export type StudioProposalApplyResult =
  | { readonly status: 'applied'; readonly message: string }
  | { readonly status: 'failed'; readonly message: string };

interface PatchableContext {
  readonly ok: true;
  readonly targetUri: StoryUri;
  readonly targetFile: string;
  readonly patchTarget: StudioEntityContext['patchTarget'];
  readonly entityKey: string;
  readonly baseline: string;
}

const staleBaselineMessage: string =
  '제안을 만든 뒤 파일이 바뀌어서 적용하지 않았어요. 다시 요청해 주세요.';

function toProposalTurn(turn: StudioChatTurn): StudioProposalTurn | undefined {
  return turn.role === 'assistant' && turn.kind === 'proposal' ? turn : undefined;
}

function sceneFocusOf(targetFile: string): StudioSceneFocus {
  return targetFile.startsWith('scene/') ? 'card' : 'draft';
}

function rewriteDraftBody(rawDraft: string, body: string): string {
  try {
    return serializeDraft({ ...parseDraft(rawDraft), body });
  } catch {
    return body;
  }
}

function describeAppliedProposal(prepared: PreparedStudioProposal): string {
  const delta: string =
    prepared.lengthDelta === 0
      ? '분량 변화 없음'
      : `${prepared.lengthDelta > 0 ? '+' : ''}${prepared.lengthDelta.toLocaleString()}자`;
  const fields: string =
    prepared.changedFields.length > 0 ? ` · ${prepared.changedFields.join(', ')}` : '';

  return `${prepared.targetFile} 적용됨${fields} · ${delta}`;
}

export class StudioProposalApplier {
  public constructor(private readonly dependencies: StudioProposalApplierDependencies) {}

  public async prepare(
    workspaceRoot: StoryUri,
    entity: StudioEntity,
    turn: StudioChatTurn,
  ): Promise<StudioProposalPreparation> {
    const proposal: StudioProposalTurn | undefined = toProposalTurn(turn);
    if (proposal === undefined) {
      return { ok: false, message: '적용할 제안이 아닙니다.' };
    }

    const context: PatchableContext | StudioProposalRefusal = await this.loadPatchableContext(
      workspaceRoot,
      entity,
      proposal,
    );

    return context.ok ? await this.patch(workspaceRoot, proposal, context) : context;
  }

  public async apply(
    workspaceRoot: StoryUri,
    entity: StudioEntity,
    turn: StudioChatTurn,
  ): Promise<StudioProposalApplyResult> {
    const prepared: StudioProposalPreparation = await this.prepare(workspaceRoot, entity, turn);
    if (!prepared.ok) {
      return { status: 'failed', message: prepared.message };
    }

    await this.archiveDraftBeforeApply(workspaceRoot, entity, prepared);
    try {
      await this.writePrepared(workspaceRoot, prepared);
    } catch (error) {
      return { status: 'failed', message: `저장하지 못했습니다: ${String(error)}` };
    }

    await this.recordFollowUps(workspaceRoot, entity, turn);
    return { status: 'applied', message: describeAppliedProposal(prepared) };
  }

  private async writePrepared(
    workspaceRoot: StoryUri,
    prepared: PreparedStudioProposal,
  ): Promise<void> {
    if (prepared.patchTarget === 'entityCard') {
      await this.dependencies.context.applyEntityCardText(workspaceRoot, prepared.text);
      return;
    }

    if (prepared.patchTarget === 'sceneCard') {
      await this.dependencies.context.applySceneCardText(
        workspaceRoot,
        prepared.entityKey,
        prepared.text,
      );
      return;
    }

    await this.dependencies.fileSystem.writeFile(
      prepared.targetUri,
      new TextEncoder().encode(prepared.text),
    );
  }

  private async loadPatchableContext(
    workspaceRoot: StoryUri,
    entity: StudioEntity,
    proposal: StudioProposalTurn,
  ): Promise<PatchableContext | StudioProposalRefusal> {
    const entityContext: StudioEntityContext | undefined =
      await this.dependencies.context.readEntityContext(
        workspaceRoot,
        entity,
        sceneFocusOf(proposal.targetFile),
      );

    if (!entityContext?.targetUri || entityContext.baseline === undefined) {
      return { ok: false, message: '수정할 파일을 찾을 수 없습니다.' };
    }
    if (entityContext.targetFile !== proposal.targetFile) {
      return { ok: false, message: `${proposal.targetFile} 를 더 이상 대상으로 삼을 수 없습니다.` };
    }
    if (hashBaseline(entityContext.baseline) !== proposal.baselineHash) {
      return { ok: false, message: staleBaselineMessage };
    }

    return {
      ok: true,
      targetUri: entityContext.targetUri,
      targetFile: entityContext.targetFile,
      patchTarget: entityContext.patchTarget,
      entityKey: entity.key,
      baseline: entityContext.baseline,
    };
  }

  private async patch(
    workspaceRoot: StoryUri,
    proposal: StudioProposalTurn,
    context: PatchableContext,
  ): Promise<StudioProposalPreparation> {
    const isDraft: boolean = context.patchTarget === 'draft';
    const patchBaseline: string = isDraft ? extractDraftBody(context.baseline) : context.baseline;
    const outcome: StudioPatchResult = applyStudioPatch(
      patchBaseline,
      proposal.patch,
      context.patchTarget,
    );
    if (!outcome.ok) {
      return { ok: false, message: outcome.message };
    }

    const brokenReference: string | undefined =
      context.patchTarget === 'sceneCard'
        ? await this.findBrokenSceneReference(workspaceRoot, proposal.patch)
        : undefined;
    if (brokenReference !== undefined) {
      return { ok: false, message: brokenReference };
    }

    return {
      ...context,
      text: isDraft ? rewriteDraftBody(context.baseline, outcome.text) : outcome.text,
      changedFields: outcome.changedFields,
      lengthDelta: outcome.text.trim().length - patchBaseline.trim().length,
    };
  }

  private async findBrokenSceneReference(
    workspaceRoot: StoryUri,
    patch: StudioProposalTurn['patch'],
  ): Promise<string | undefined> {
    if (patch.target !== 'card') {
      return undefined;
    }

    for (const change of patch.changes) {
      const castIds: readonly unknown[] =
        change.field === 'characters' && Array.isArray(change.value) ? change.value : [];
      for (const id of castIds) {
        if (typeof id !== 'string' || !(await this.hasCard(workspaceRoot, 'character', id))) {
          return `character/${String(id)}.card 가 없어 적용하지 않았어요. 카드를 먼저 만들어 주세요.`;
        }
      }

      const isMissingLocation: boolean =
        change.field === 'location' &&
        typeof change.value === 'string' &&
        !(await this.hasCard(workspaceRoot, 'background', change.value));
      if (isMissingLocation) {
        return `background/${String(change.value)}.card 가 없어 적용하지 않았어요. 카드를 먼저 만들어 주세요.`;
      }
    }

    return undefined;
  }

  private async hasCard(
    workspaceRoot: StoryUri,
    kind: 'character' | 'background',
    id: string,
  ): Promise<boolean> {
    return isSafeStudioEntityKey(id) && (await this.dependencies.context.hasCard(workspaceRoot, kind, id));
  }

  private async archiveDraftBeforeApply(
    workspaceRoot: StoryUri,
    entity: StudioEntity,
    prepared: PreparedStudioProposal,
  ): Promise<void> {
    if (entity.kind !== 'scene' || !prepared.targetFile.startsWith('draft/')) {
      return;
    }

    try {
      await this.dependencies.revisions.archive(workspaceRoot, entity.key);
    } catch (error) {
      this.dependencies.logger.warn(`이전 초안을 판본으로 남기지 못했습니다: ${String(error)}`);
    }
  }

  private async recordFollowUps(
    workspaceRoot: StoryUri,
    origin: StudioEntity,
    turn: StudioChatTurn,
  ): Promise<void> {
    const proposal: StudioProposalTurn | undefined = toProposalTurn(turn);
    const createdAt: string = new Date().toISOString();

    await this.dependencies.followUps.resolveFor(workspaceRoot, origin);
    await this.dependencies.followUps.add(
      workspaceRoot,
      (proposal?.followUps ?? []).map((followUp) => ({
        id: this.dependencies.createFollowUpId?.() ?? randomUUID(),
        target: { kind: followUp.kind, key: followUp.key },
        origin,
        reason: followUp.reason,
        instruction: followUp.instruction,
        createdAt,
      })),
    );
  }
}
