import * as vscode from 'vscode';

import { extractDraftBody, parseDraft, serializeDraft } from '@storyboard/story-format';

import { hashBaseline } from '@/application/studio/studioChatUseCase';
import { applyStudioPatch } from '@/domain/studio/studioPatch';
import {
  readStudioEntityContext,
  type StudioSceneFocus,
} from '@/infrastructure/persistence/studioEntityContext';
import type { StoryboardRpcHandlers } from '@/presentation/messaging/bridge';
import type { ProposalReviewService } from '@/presentation/providers/proposalReviewService';
import type {
  StoryboardResponsePayload,
  StudioChatTurn,
  StudioEntity,
  StudioProposalTurn,
} from '@/shared/messaging';

export interface StudioProposalRpcHandlersDependencies {
  readonly reviewService: ProposalReviewService;
  readonly getProjectRoot: () => Promise<vscode.Uri | undefined>;
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

      if (prepared.ok) {
        await deps.reviewService.showDiffs([
          {
            original: prepared.targetUri,
            proposedText: prepared.text,
            label: `Studio 제안 · ${prepared.targetFile}`,
            key: `studio:${payload.entity.kind}:${payload.entity.key}`,
          },
        ]);
      }

      return {};
    },

    'studio.proposal.apply': async (
      payload,
    ): Promise<StoryboardResponsePayload<'studio.proposal.apply'>> => {
      const prepared = await prepareApply(deps, payload.entity, payload.turn);

      if (!prepared.ok) {
        return { status: 'failed', message: prepared.message };
      }

      try {
        await vscode.workspace.fs.writeFile(
          prepared.targetUri,
          new TextEncoder().encode(prepared.text),
        );
      } catch (error) {
        return { status: 'failed', message: `저장하지 못했습니다: ${String(error)}` };
      }

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

  return {
    ok: true,
    targetUri: entityContext.targetUri,
    targetFile: entityContext.targetFile,
    text: isDraft ? rewriteDraftBody(entityContext.baseline, result.text) : result.text,
    changedFields: result.changedFields,
    lengthDelta: result.text.trim().length - patchBaseline.trim().length,
  };
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
