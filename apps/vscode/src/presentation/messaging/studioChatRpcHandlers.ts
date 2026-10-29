import { vscodeFileSystem } from '@/infrastructure/vscode/vscodeFileSystem';
import * as vscode from 'vscode';

import type { StudioChatRequest, StudioChatStage } from '@storyboard/story-engine';
import type { CardManager, StudioManager } from '@storyboard/story-app';
import { extractDraftBody } from '@storyboard/story-model';

import {
  StudioContextRepository,
  type StudioEntityContext,
  type StudioSceneFocus,
} from '@storyboard/story-engine';
import type { AiGateway } from '@storyboard/story-engine';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import type { ConfigBridge } from '@storyboard/story-ai';
import type { StoryboardRpcHandlers } from '@/presentation/messaging/bridge';
import { StudioCardInvokeResolver } from '@/presentation/messaging/studioCardToolResolver';
import { StudioInvokeResolver } from '@/presentation/messaging/studioToolResolver';
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

export class StudioChatRpc {
  public constructor(private readonly deps: StudioChatRpcHandlersDependencies) {}

  public handlers(): StoryboardRpcHandlers {
    let generation: number = 0;

    return {
      'studio.chat.send': async (
        payload,
      ): Promise<StoryboardResponsePayload<'studio.chat.send'>> => {
        const root: vscode.Uri | undefined = await this.deps.getProjectRoot();

        if (!root) {
          return { turns: [sayTurn('Storyboard 프로젝트를 먼저 열어 주세요.')] };
        }

        const target: StudioTarget = await this.deps.getTarget();
        const entityContext: StudioEntityContext | undefined = await new StudioContextRepository(
          vscodeFileSystem,
        ).readEntityContext(root, payload.entity, sceneFocusOf(target));

        if (!entityContext) {
          return { turns: [sayTurn(missingEntityMessage(payload.entity))] };
        }

        const selection: string | undefined = readSelectedDraftText(entityContext);
        const contextWithSelection: string = selection
          ? `${entityContext.context}\n\n[작가가 선택한 구간]\n${selection}`
          : entityContext.context;

        const startedGeneration: number = generation;

        try {
          const turns: readonly StudioChatTurn[] = await this.deps.studio.chat({
            workspaceRoot: root,
            entityContext: { ...entityContext, context: contextWithSelection },
            history: payload.history,
            instruction: payload.instruction,
            hasSelection: selection !== undefined,
            ...(payload.tool === undefined ? {} : { pinnedTool: payload.tool }),
            ...usageAttributionFor(payload.entity),
            isValidationEnabled: this.deps.configBridge.isStudioValidationEnabled(),
            resolveLookup: (requests) =>
              new StudioContextRepository(vscodeFileSystem).resolveLookups(root, requests),
            ...this.toolResolverFor(root, payload.entity, entityContext),
            resolveFollowUps: (followUps) =>
              new StudioContextRepository(vscodeFileSystem).resolveFollowUps(root, followUps),
            createTurnId: () => crypto.randomUUID(),
            onStage: this.deps.postProgress,
          });

          return { turns: generation === startedGeneration ? [...turns] : [] };
        } finally {
          this.deps.postProgress('idle');
        }
      },

      'studio.chat.cancel': async (): Promise<StoryboardResponsePayload<'studio.chat.cancel'>> => {
        generation += 1;
        this.deps.postProgress('idle');
        return {};
      },
    };
  }

  private toolResolverFor(
    root: vscode.Uri,
    entity: StudioEntity,
    entityContext: StudioEntityContext,
  ): Pick<StudioChatRequest, 'resolveInvoke'> {
    if (entityContext.baseline === undefined || entityContext.targetUri === undefined) {
      return {};
    }

    if (entityContext.patchTarget === 'draft') {
      return {
        resolveInvoke: new StudioInvokeResolver(
          {
            aiGateway: this.deps.aiGateway,
            logger: this.deps.logger,
            diagnostics: this.deps.toolDiagnostics,
          },
          {
            workspaceRoot: root,
            sceneStem: entity.key,
            draftUri: entityContext.targetUri,
            baseline: entityContext.baseline,
          },
        ).resolve,
      };
    }

    return {
      resolveInvoke: new StudioCardInvokeResolver(
        {
          aiGateway: this.deps.aiGateway,
          cards: this.deps.cards,
          logger: this.deps.logger,
        },
        {
          workspaceRoot: root,
          entity,
          entityLabel: entityContext.entityLabel,
          context: entityContext.context,
          baseline: entityContext.baseline,
        },
      ).resolve,
    };
  }
}

function usageAttributionFor(entity: StudioEntity): Pick<StudioChatRequest, 'attribution'> {
  if (entity.kind === 'project') {
    return {};
  }

  return { attribution: { primary: { kind: entity.kind, id: entity.key } } };
}

function readSelectedDraftText(entityContext: StudioEntityContext): string | undefined {
  if (entityContext.patchTarget !== 'draft' || entityContext.baseline === undefined) {
    return undefined;
  }

  const editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;

  if (!editor || editor.selection.isEmpty) {
    return undefined;
  }

  const body: string = extractDraftBody(entityContext.baseline);
  const selected: string = editor.document.getText(editor.selection);
  const startOffset: number = body.indexOf(selected);

  if (selected.trim().length === 0 || startOffset === -1) {
    return undefined;
  }

  return `[${startOffset}-${startOffset + selected.length}]\n${selected}`;
}

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
