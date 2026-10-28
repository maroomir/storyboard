import { vscodeFileSystem } from '@/infrastructure/vscode/vscodeFileSystem';
import * as vscode from 'vscode';

import {
  extractDraftBody,
  parseDraft,
  serializeDraft,
  archiveExistingDraft,
  applyStudioPatch,
  backgroundCardPath,
  characterCardPath,
  draftHistorySceneDirectory,
  joinUri,
} from '@storyboard/story-model';

import type { ConfigBridge } from '@storyboard/story-ai';

import { StudioContextRepository, hashBaseline } from '@storyboard/story-engine';
import type { StudioSceneFocus } from '@storyboard/story-engine';
import type { StoryboardRpcHandlers } from '@/presentation/messaging/bridge';
import type { IStudioFollowUpRepository, StudioEntityContext } from '@storyboard/story-engine';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import { draftHistoryFileSystem } from '@/infrastructure/vscode/workspaceFsAdapters';
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
  readonly configBridge: Pick<ConfigBridge, 'isKeepDraftHistoryEnabled'>;
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
        const prepared: PreparedApply = await prepareApply(this.deps, payload.entity, payload.turn);

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
        const prepared: PreparedApply = await prepareApply(this.deps, payload.entity, payload.turn);

        if (!prepared.ok) {
          return { status: 'failed', message: prepared.message };
        }

        await archiveDraftBeforeApply(this.deps, payload.entity, prepared);

        try {
          await vscode.workspace.fs.writeFile(
            prepared.targetUri,
            new TextEncoder().encode(prepared.text),
          );
        } catch (error) {
          return { status: 'failed', message: `저장하지 못했습니다: ${String(error)}` };
        }

        await recordFollowUps(this.deps, payload.entity, payload.turn);

        return { status: 'applied', message: appliedMessage(prepared) };
      },
    };
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
  | { readonly ok: false; readonly message: string };

async function prepareApply(
  deps: StudioProposalRpcHandlersDependencies,
  entity: StudioEntity,
  turn: StudioChatTurn,
): Promise<PreparedApply> {
  const proposal: StudioProposalTurn | undefined = toProposalTurn(turn);

  if (!proposal) {
    return { ok: false, message: '적용할 제안이 아닙니다.' };
  }

  const root: vscode.Uri | undefined = await deps.getProjectRoot();

  if (!root) {
    return { ok: false, message: 'Storyboard 프로젝트를 먼저 열어 주세요.' };
  }

  const entityContext: StudioEntityContext | undefined = await new StudioContextRepository(
    vscodeFileSystem,
  ).readEntityContext(root, entity, sceneFocusOf(proposal.targetFile));

  if (!entityContext?.targetUri || entityContext.baseline === undefined) {
    return { ok: false, message: '수정할 파일을 찾을 수 없습니다.' };
  }

  if (entityContext.targetFile !== proposal.targetFile) {
    return { ok: false, message: `${proposal.targetFile} 를 더 이상 대상으로 삼을 수 없습니다.` };
  }

  if (hashBaseline(entityContext.baseline) !== proposal.baselineHash) {
    return { ok: false, message: staleBaselineMessage };
  }

  const isDraft: boolean = entityContext.patchTarget === 'draft';
  const patchBaseline: string = isDraft
    ? extractDraftBody(entityContext.baseline)
    : entityContext.baseline;

  const patchOutcome: StudioPatchResult = applyStudioPatch(
    patchBaseline,
    proposal.patch,
    entityContext.patchTarget,
  );

  if (!patchOutcome.ok) {
    return { ok: false, message: patchOutcome.message };
  }

  if (entityContext.patchTarget === 'sceneCard') {
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
    targetUri: entityContext.targetUri,
    targetFile: entityContext.targetFile,
    text: isDraft ? rewriteDraftBody(entityContext.baseline, patchOutcome.text) : patchOutcome.text,
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

async function archiveDraftBeforeApply(
  deps: StudioProposalRpcHandlersDependencies,
  entity: StudioEntity,
  prepared: Extract<PreparedApply, { readonly ok: true }>,
): Promise<void> {
  if (entity.kind !== 'scene' || !prepared.targetFile.startsWith('draft/')) {
    return;
  }

  if (!deps.configBridge.isKeepDraftHistoryEnabled()) {
    return;
  }

  const root: vscode.Uri | undefined = await deps.getProjectRoot();

  if (!root) {
    return;
  }

  try {
    const historyDirectory: StoryUri = draftHistorySceneDirectory(root, entity.key);

    await archiveExistingDraft({
      draftUri: prepared.targetUri,
      historyDirectory,
      resolveArchiveUri: (fileName) => joinUri(historyDirectory, fileName),
      fileSystem: draftHistoryFileSystem,
    });
  } catch (error) {
    deps.logger.warn(`이전 초안을 .draft 히스토리에 보관하지 못했습니다: ${String(error)}`);
  }
}

async function recordFollowUps(
  deps: StudioProposalRpcHandlersDependencies,
  origin: StudioEntity,
  turn: StudioChatTurn,
): Promise<void> {
  const root: vscode.Uri | undefined = await deps.getProjectRoot();
  const proposal: StudioProposalTurn | undefined = toProposalTurn(turn);

  if (!root) {
    return;
  }

  await deps.followUpRepository.resolveFor(root, origin);

  const createdAt: string = new Date().toISOString();

  await deps.followUpRepository.add(
    root,
    (proposal?.followUps ?? []).map((followUp) => ({
      id: deps.createFollowUpId(),
      target: { kind: followUp.kind, key: followUp.key },
      origin,
      reason: followUp.reason,
      instruction: followUp.instruction,
      createdAt,
    })),
  );
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
