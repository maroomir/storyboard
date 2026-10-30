import type { DraftManager, StudioManager } from '@storyboard/story-app';
import * as vscode from 'vscode';

import {
  extractDraftBody,
  parseDraft,
  serializeDraft,
  applyStudioPatch,
  backgroundCardPath,
  characterCardPath,
} from '@storyboard/story-model';

import { StudioContextRepository, hashBaseline } from '@storyboard/story-engine';
import type { StudioSceneFocus } from '@storyboard/story-engine';
import type { StoryboardRpcHandlers } from '@/presentation/messaging/bridge';
import type { IStudioFollowUpRepository, StudioEntityContext } from '@storyboard/story-engine';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import type { ProposalReviewService } from '@/presentation/providers/proposalReviewService';
import type {
  StoryboardResponsePayload,
  StoryUri,
  StudioChatTurn,
  StudioEntity,
  StudioPatchResult,
  StudioProposalTurn,
} from '@storyboard/story-model';
import { cardExists } from '@/presentation/messaging/studioCardToolResolver';

export interface StudioProposalRpcHandlersDependencies {
  readonly reviewService: ProposalReviewService;
  readonly followUpRepository: IStudioFollowUpRepository;
  readonly drafts: Pick<DraftManager, 'archiveDraftWhenHistoryIsKept'>;
  readonly studio: Pick<StudioManager, 'context'>;
  readonly logger: Pick<IStoryboardLogger, 'warn'>;
  readonly getProjectRoot: () => Promise<vscode.Uri | undefined>;
  readonly createFollowUpId: () => string;
}

const staleBaselineMessage: string =
  '제안을 만든 뒤 파일이 바뀌어서 적용하지 않았어요. 다시 요청해 주세요.';

export class StudioProposalRpc {
  public constructor(private readonly deps: StudioProposalRpcHandlersDependencies) {}

  public handlers(): StoryboardRpcHandlers {
    return {
      'studio.proposal.preview': async (
        payload,
      ): Promise<StoryboardResponsePayload<'studio.proposal.preview'>> => {
        const prepared: PreparedApply = await this.prepareApply(payload.entity, payload.turn);

        if (!prepared.ok) {
          return { shown: false, message: prepared.message };
        }

        await this.deps.reviewService.showDiffs([
          {
            original: prepared.targetUri,
            proposedText: prepared.text,
            label: `Studio 제안 · ${prepared.targetFile}`,
            key: `studio:${payload.entity.kind}:${payload.entity.key}`,
          },
        ]);

        return { shown: true };
      },

      'studio.proposal.apply': async (
        payload,
      ): Promise<StoryboardResponsePayload<'studio.proposal.apply'>> => {
        const prepared: PreparedApply = await this.prepareApply(payload.entity, payload.turn);

        if (!prepared.ok) {
          return { status: 'failed', message: prepared.message };
        }

        await this.archiveDraftBeforeApply(payload.entity, prepared);

        try {
          await vscode.workspace.fs.writeFile(
            prepared.targetUri,
            new TextEncoder().encode(prepared.text),
          );
        } catch (error) {
          return { status: 'failed', message: `저장하지 못했습니다: ${String(error)}` };
        }

        await this.recordFollowUps(payload.entity, payload.turn);

        return { status: 'applied', message: appliedMessage(prepared) };
      },
    };
  }

  private async prepareApply(entity: StudioEntity, turn: StudioChatTurn): Promise<PreparedApply> {
    const proposal: StudioProposalTurn | undefined = toProposalTurn(turn);

    if (!proposal) {
      return { ok: false, message: '적용할 제안이 아닙니다.' };
    }

    const root: vscode.Uri | undefined = await this.deps.getProjectRoot();

    if (!root) {
      return { ok: false, message: 'Storyboard 프로젝트를 먼저 열어 주세요.' };
    }

    const context: PatchableContextResult = await loadPatchableContext(
      this.deps.studio.context,
      root,
      entity,
      proposal,
    );

    if (!context.ok) {
      return context;
    }

    return await applyProposalPatch(root, proposal, context);
  }

  private async archiveDraftBeforeApply(
    entity: StudioEntity,
    prepared: Extract<PreparedApply, { readonly ok: true }>,
  ): Promise<void> {
    if (entity.kind !== 'scene' || !prepared.targetFile.startsWith('draft/')) {
      return;
    }

    const root: vscode.Uri | undefined = await this.deps.getProjectRoot();

    if (!root) {
      return;
    }

    try {
      await this.deps.drafts.archiveDraftWhenHistoryIsKept(root, entity.key);
    } catch (error) {
      this.deps.logger.warn(`이전 초안을 .draft 히스토리에 보관하지 못했습니다: ${String(error)}`);
    }
  }

  private async recordFollowUps(origin: StudioEntity, turn: StudioChatTurn): Promise<void> {
    const root: vscode.Uri | undefined = await this.deps.getProjectRoot();
    const proposal: StudioProposalTurn | undefined = toProposalTurn(turn);

    if (!root) {
      return;
    }

    await this.deps.followUpRepository.resolveFor(root, origin);

    const createdAt: string = new Date().toISOString();

    await this.deps.followUpRepository.add(
      root,
      (proposal?.followUps ?? []).map((followUp) => ({
        id: this.deps.createFollowUpId(),
        target: { kind: followUp.kind, key: followUp.key },
        origin,
        reason: followUp.reason,
        instruction: followUp.instruction,
        createdAt,
      })),
    );
  }
}

type PreparedApply =
  | {
      readonly ok: true;
      readonly targetUri: vscode.Uri;
      readonly targetFile: string;
      readonly text: string;
      readonly changedFields: readonly string[];
      readonly lengthDelta: number;
    }
  | PreparedApplyFailure;

interface PreparedApplyFailure {
  readonly ok: false;
  readonly message: string;
}

interface PatchableContext {
  readonly ok: true;
  readonly targetUri: StoryUri;
  readonly targetFile: string;
  readonly patchTarget: StudioEntityContext['patchTarget'];
  readonly baseline: string;
}

type PatchableContextResult = PatchableContext | PreparedApplyFailure;

async function loadPatchableContext(
  studioContext: StudioContextRepository,
  root: vscode.Uri,
  entity: StudioEntity,
  proposal: StudioProposalTurn,
): Promise<PatchableContextResult> {
  const entityContext: StudioEntityContext | undefined = await studioContext.readEntityContext(
    root,
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
    baseline: entityContext.baseline,
  };
}

async function applyProposalPatch(
  root: vscode.Uri,
  proposal: StudioProposalTurn,
  context: PatchableContext,
): Promise<PreparedApply> {
  const isDraft: boolean = context.patchTarget === 'draft';
  const patchBaseline: string = isDraft ? extractDraftBody(context.baseline) : context.baseline;

  const patchOutcome: StudioPatchResult = applyStudioPatch(
    patchBaseline,
    proposal.patch,
    context.patchTarget,
  );

  if (!patchOutcome.ok) {
    return { ok: false, message: patchOutcome.message };
  }

  if (context.patchTarget === 'sceneCard') {
    const brokenReference: string | undefined = await findBrokenSceneReference(
      root,
      proposal.patch,
    );

    if (brokenReference !== undefined) {
      return { ok: false, message: brokenReference };
    }
  }

  return {
    ok: true,
    targetUri: context.targetUri,
    targetFile: context.targetFile,
    text: isDraft ? rewriteDraftBody(context.baseline, patchOutcome.text) : patchOutcome.text,
    changedFields: patchOutcome.changedFields,
    lengthDelta: patchOutcome.text.trim().length - patchBaseline.trim().length,
  };
}

async function findBrokenSceneReference(
  root: vscode.Uri,
  patch: StudioProposalTurn['patch'],
): Promise<string | undefined> {
  if (patch.target !== 'card') {
    return undefined;
  }

  for (const change of patch.changes) {
    if (change.field === 'characters' && Array.isArray(change.value)) {
      for (const id of change.value) {
        if (typeof id !== 'string' || !(await cardExists(characterCardPath, root, id))) {
          return `character/${String(id)}.card 가 없어 적용하지 않았어요. 카드를 먼저 만들어 주세요.`;
        }
      }
    }

    if (change.field === 'location' && typeof change.value === 'string') {
      if (!(await cardExists(backgroundCardPath, root, change.value))) {
        return `background/${change.value}.card 가 없어 적용하지 않았어요. 카드를 먼저 만들어 주세요.`;
      }
    }
  }

  return undefined;
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

function appliedMessage(prepared: Extract<PreparedApply, { readonly ok: true }>): string {
  const delta: string =
    prepared.lengthDelta === 0
      ? '분량 변화 없음'
      : `${prepared.lengthDelta > 0 ? '+' : ''}${prepared.lengthDelta.toLocaleString()}자`;

  const fields: string =
    prepared.changedFields.length > 0 ? ` · ${prepared.changedFields.join(', ')}` : '';

  return `${prepared.targetFile} 적용됨${fields} · ${delta}`;
}

function toProposalTurn(turn: StudioChatTurn): StudioProposalTurn | undefined {
  return turn.role === 'assistant' && turn.kind === 'proposal' ? turn : undefined;
}
