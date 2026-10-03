import { vscodeFileSystem } from '@/infrastructure/vscode/vscodeFileSystem';
import * as vscode from 'vscode';

import type { StudioChatRequest, StudioChatStage } from '@storyboard/story-engine';
import type { CardManager, StudioManager } from '@storyboard/story-app';
import { extractDraftBody } from '@storyboard/story-model';

import {
  readStudioEntityContext,
  resolveStudioFollowUps,
  resolveStudioLookups,
  type StudioEntityContext,
  type StudioSceneFocus,
} from '@storyboard/story-engine';
import type { AiGateway } from '@storyboard/story-engine';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import type { ConfigBridge } from '@storyboard/story-ai';
import type { StoryboardRpcHandlers } from '@/presentation/messaging/bridge';
import { createStudioCardInvokeResolver } from '@/presentation/messaging/studioCardToolResolver';
import { createStudioInvokeResolver } from '@/presentation/messaging/studioToolResolver';
import type { StudioToolDiagnostics } from '@/presentation/providers/studioToolDiagnostics';
import type {
  StoryboardResponsePayload,
  StudioChatTurn,
  StudioEntity,
  StudioTarget,
} from '@storyboard/story-model';

export interface StudioChatRpcHandlersDependencies {
  readonly studio: Pick<StudioManager, 'chat'>;
  readonly aiGateway: AiGateway;
  readonly cards: Pick<CardManager, 'collectProposals'>;
  readonly logger: IStoryboardLogger;
  readonly toolDiagnostics: StudioToolDiagnostics;
  readonly configBridge: ConfigBridge;
  readonly getProjectRoot: () => Promise<vscode.Uri | undefined>;
  readonly getTarget: () => Promise<StudioTarget>;
  readonly postProgress: (stage: StudioChatStage | 'idle') => void;
}

export function createStudioChatRpcHandlers(
  deps: StudioChatRpcHandlersDependencies,
): StoryboardRpcHandlers {
  // NOTE: a provider call cannot be aborted mid-flight, so a cancel bumps the generation and the
  // reply that eventually lands is dropped instead of appearing after the author moved on.
  let generation = 0;

  return {
    'studio.chat.send': async (payload): Promise<StoryboardResponsePayload<'studio.chat.send'>> => {
      const root = await deps.getProjectRoot();

      if (!root) {
        return { turns: [sayTurn('Storyboard 프로젝트를 먼저 열어 주세요.')] };
      }

      const target = await deps.getTarget();
      const entityContext = await readStudioEntityContext(
        vscodeFileSystem,
        root,
        payload.entity,
        sceneFocusOf(target),
      );

      if (!entityContext) {
        return { turns: [sayTurn(missingEntityMessage(payload.entity))] };
      }

      // NOTE: the prompt tells the model a selection was given, so the selected text has to travel
      // with it; a bare hasSelection flag would leave the model guessing which passage to rewrite.
      const selection = readSelectedDraftText(entityContext);
      const contextWithSelection = selection
        ? `${entityContext.context}\n\n[작가가 선택한 구간]\n${selection}`
        : entityContext.context;

      const startedGeneration = generation;

      try {
        const turns = await deps.studio.chat({
          workspaceRoot: root,
          entityContext: { ...entityContext, context: contextWithSelection },
          history: payload.history,
          instruction: payload.instruction,
          hasSelection: selection !== undefined,
          ...(payload.tool === undefined ? {} : { pinnedTool: payload.tool }),
          ...usageAttributionFor(payload.entity),
          isValidationEnabled: deps.configBridge.isStudioValidationEnabled(),
          resolveLookup: (requests) => resolveStudioLookups(vscodeFileSystem, root, requests),
          ...toolResolverFor(deps, root, payload.entity, entityContext),
          resolveFollowUps: (followUps) =>
            resolveStudioFollowUps(vscodeFileSystem, root, followUps),
          createTurnId: () => crypto.randomUUID(),
          onStage: deps.postProgress,
        });

        return { turns: generation === startedGeneration ? [...turns] : [] };
      } finally {
        deps.postProgress('idle');
      }
    },

    'studio.chat.cancel': async (): Promise<StoryboardResponsePayload<'studio.chat.cancel'>> => {
      generation += 1;
      deps.postProgress('idle');
      return {};
    },
  };
}

// NOTE: without this the Studio's spend never reached the ledger, so the sidebar badges read as
// if chatting were free.
function usageAttributionFor(entity: StudioEntity): Pick<StudioChatRequest, 'attribution'> {
  if (entity.kind === 'project') {
    return {};
  }

  return { attribution: { primary: { kind: entity.kind, id: entity.key } } };
}

// NOTE: which resolver a conversation gets follows the file being edited — draft chats run the
// draft tools, card chats the card tools; a target with no baseline gets none at all, and the
// prompt then never advertises invoke.
function toolResolverFor(
  deps: StudioChatRpcHandlersDependencies,
  root: vscode.Uri,
  entity: StudioEntity,
  entityContext: StudioEntityContext,
): Pick<StudioChatRequest, 'resolveInvoke'> {
  if (entityContext.baseline === undefined || entityContext.targetUri === undefined) {
    return {};
  }

  if (entityContext.patchTarget === 'draft') {
    return {
      resolveInvoke: createStudioInvokeResolver(
        {
          aiGateway: deps.aiGateway,
          logger: deps.logger,
          diagnostics: deps.toolDiagnostics,
        },
        {
          workspaceRoot: root,
          sceneStem: entity.key,
          draftUri: entityContext.targetUri,
          baseline: entityContext.baseline,
        },
      ),
    };
  }

  return {
    resolveInvoke: createStudioCardInvokeResolver(
      {
        aiGateway: deps.aiGateway,
        cards: deps.cards,
        logger: deps.logger,
      },
      {
        workspaceRoot: root,
        entity,
        entityLabel: entityContext.entityLabel,
        context: entityContext.context,
        baseline: entityContext.baseline,
      },
    ),
  };
}

// NOTE: only a draft edit can act on a selection, and the offsets the model must return are body
// offsets, so the excerpt is reported the same way.
function readSelectedDraftText(entityContext: StudioEntityContext): string | undefined {
  if (entityContext.patchTarget !== 'draft' || entityContext.baseline === undefined) {
    return undefined;
  }

  const editor = vscode.window.activeTextEditor;

  if (!editor || editor.selection.isEmpty) {
    return undefined;
  }

  const body = extractDraftBody(entityContext.baseline);
  const selected = editor.document.getText(editor.selection);
  const startOffset = body.indexOf(selected);

  if (selected.trim().length === 0 || startOffset === -1) {
    return undefined;
  }

  return `[${startOffset}-${startOffset + selected.length}]\n${selected}`;
}

// NOTE: a scene entity spans the seed card and its draft; whichever the author is looking at is
// the one a proposal may rewrite.
function sceneFocusOf(target: StudioTarget): StudioSceneFocus {
  return target.kind === 'scene' ? 'card' : 'draft';
}

function sayTurn(message: string): StudioChatTurn {
  return { id: crypto.randomUUID(), role: 'assistant', kind: 'say', message };
}

function missingEntityMessage(entity: StudioEntity): string {
  return entity.kind === 'scene'
    ? `scene/${entity.key}.card 를 찾을 수 없어요.`
    : `${entity.kind}/${entity.key}.card 를 찾을 수 없어요.`;
}
