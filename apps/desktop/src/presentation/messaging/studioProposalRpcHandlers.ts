import * as vscode from 'vscode';

import { extractDraftBody, parseDraft, serializeDraft } from '@storyboard/story-format';

import type { ConfigBridge } from '@storyboard/story-ai';

import { hashBaseline } from '@/application/studio/studioChatUseCase';
import { archiveExistingDraft } from '@storyboard/story-engine';
import { applyStudioPatch } from '@storyboard/story-engine';
import {
  readStudioEntityContext,
  type StudioSceneFocus,
} from '@/infrastructure/persistence/studioEntityContext';
import type { StoryboardRpcHandlers } from '@/presentation/messaging/bridge';
import type { IStudioFollowUpRepository } from '@/infrastructure/persistence/repositories/studioFollowUpRepository';
import {
  backgroundCardPath,
  characterCardPath,
  draftHistorySceneDirectory,
  isSafeStudioEntityKey,
  joinUri,
} from '@/infrastructure/vscode/pathConventions';
import type { StoryboardLogger } from '@/infrastructure/vscode/logger';
import { draftHistoryFileSystem } from '@/infrastructure/vscode/workspaceFsAdapters';
import type { ProposalReviewService } from '@/presentation/providers/proposalReviewService';
import type {
  StoryboardResponsePayload,
  StudioChatTurn,
  StudioEntity,
  StudioProposalTurn,
} from '@storyboard/story-engine';

export interface StudioProposalRpcHandlersDependencies {
  readonly reviewService: ProposalReviewService;
  readonly followUpRepository: IStudioFollowUpRepository;
  readonly configBridge: Pick<ConfigBridge, 'isKeepDraftHistoryEnabled'>;
  readonly logger: Pick<StoryboardLogger, 'warn'>;
  readonly getProjectRoot: () => Promise<vscode.Uri | undefined>;
  readonly createFollowUpId: () => string;
}

const staleBaselineMessage =
  '제안을 만든 뒤 파일이 바뀌어서 적용하지 않았어요. 다시 요청해 주세요.';

export function createStudioProposalRpcHandlers(
  deps: StudioProposalRpcHandlersDependencies,
): StoryboardRpcHandlers {
  return {
    'studio.proposal.preview': async (
      payload,
    ): Promise<StoryboardResponsePayload<'studio.proposal.preview'>> => {
      const prepared = await prepareApply(deps, payload.entity, payload.turn);

      if (!prepared.ok) {
        // NOTE: a silent no-op here reads as a broken button, so the reason travels back to the chat.
        return { shown: false, message: prepared.message };
      }

      await deps.reviewService.showDiffs([
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
      const prepared = await prepareApply(deps, payload.entity, payload.turn);

      if (!prepared.ok) {
        return { status: 'failed', message: prepared.message };
      }

      await archiveDraftBeforeApply(deps, payload.entity, prepared);

      try {
        await vscode.workspace.fs.writeFile(
          prepared.targetUri,
          new TextEncoder().encode(prepared.text),
        );
      } catch (error) {
        return { status: 'failed', message: `저장하지 못했습니다: ${String(error)}` };
      }

      await recordFollowUps(deps, payload.entity, payload.turn);

      return { status: 'applied', message: appliedMessage(prepared) };
    },
  };
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
  const proposal = toProposalTurn(turn);

  if (!proposal) {
    return { ok: false, message: '적용할 제안이 아닙니다.' };
  }

  const root = await deps.getProjectRoot();

  if (!root) {
    return { ok: false, message: 'Storyboard 프로젝트를 먼저 열어 주세요.' };
  }

  const entityContext = await readStudioEntityContext(
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

  // SECURITY: the bot and other editors share this workspace, so a patch derived from stale bytes
  // is refused rather than overwriting whatever landed in the meantime.
  if (hashBaseline(entityContext.baseline) !== proposal.baselineHash) {
    return { ok: false, message: staleBaselineMessage };
  }

  const isDraft = entityContext.patchTarget === 'draft';
  const patchBaseline = isDraft ? extractDraftBody(entityContext.baseline) : entityContext.baseline;

  const result = applyStudioPatch(patchBaseline, proposal.patch, entityContext.patchTarget);

  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  if (entityContext.patchTarget === 'sceneCard') {
    const brokenReference = await findBrokenSceneReference(root, proposal.patch);

    if (brokenReference !== undefined) {
      return { ok: false, message: brokenReference };
    }
  }

  return {
    ok: true,
    targetUri: entityContext.targetUri,
    targetFile: entityContext.targetFile,
    text: isDraft ? rewriteDraftBody(entityContext.baseline, result.text) : result.text,
    changedFields: result.changedFields,
    lengthDelta: result.text.trim().length - patchBaseline.trim().length,
  };
}

// SECURITY: characters/location values arrive from model output and become card lookups, so ids
// are shape-checked before touching the filesystem; a fill may only point the scene at cards that
// actually exist, keeping the generation pipeline free of dangling references.
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

async function cardExists(
  pathOf: (root: vscode.Uri, id: string) => vscode.Uri,
  root: vscode.Uri,
  id: string,
): Promise<boolean> {
  if (!isSafeStudioEntityKey(id)) {
    return false;
  }

  try {
    await vscode.workspace.fs.stat(pathOf(root, id));
    return true;
  } catch {
    return false;
  }
}

// NOTE: every other writer archives the previous draft before overwriting it, and draft/ has no
// commit safety net, so a chat apply has to honour the same contract.
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

  const root = await deps.getProjectRoot();

  if (!root) {
    return;
  }

  try {
    const historyDirectory = draftHistorySceneDirectory(root, entity.key);

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

// NOTE: an applied edit both raises the ripples it declares and answers whatever ripple was
// waiting on this entity, so the reminder list never keeps a job the author already did.
async function recordFollowUps(
  deps: StudioProposalRpcHandlersDependencies,
  origin: StudioEntity,
  turn: StudioChatTurn,
): Promise<void> {
  const root = await deps.getProjectRoot();
  const proposal = toProposalTurn(turn);

  if (!root) {
    return;
  }

  await deps.followUpRepository.resolveFor(root, origin);

  const createdAt = new Date().toISOString();

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

// NOTE: patches address the body, so the frontmatter is re-serialized from the file rather than
// being carried through the model.
function rewriteDraftBody(rawDraft: string, body: string): string {
  try {
    return serializeDraft({ ...parseDraft(rawDraft), body });
  } catch {
    return body;
  }
}

function appliedMessage(prepared: Extract<PreparedApply, { readonly ok: true }>): string {
  const delta =
    prepared.lengthDelta === 0
      ? '분량 변화 없음'
      : `${prepared.lengthDelta > 0 ? '+' : ''}${prepared.lengthDelta.toLocaleString()}자`;

  const fields = prepared.changedFields.length > 0 ? ` · ${prepared.changedFields.join(', ')}` : '';

  return `${prepared.targetFile} 적용됨${fields} · ${delta}`;
}

function toProposalTurn(turn: StudioChatTurn): StudioProposalTurn | undefined {
  return turn.role === 'assistant' && turn.kind === 'proposal' ? turn : undefined;
}
