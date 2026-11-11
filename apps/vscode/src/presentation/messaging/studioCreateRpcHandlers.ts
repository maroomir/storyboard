import * as vscode from 'vscode';

import type { StudioManager } from '@storyboard/story-app';
import type {
  AiGateway,
  IStoryboardLogger,
  StudioCreateResult,
  StudioEditResult,
} from '@storyboard/story-engine';
import {
  backgroundCardPath,
  characterCardPath,
  sceneCardPath,
  type StoryboardRequestPayload,
  type StoryboardResponsePayload,
  type StoryUri,
  type StudioCardSeed,
  type StudioCreatableKind,
} from '@storyboard/story-model';
import type { StoryboardRpcHandlers } from '@/presentation/messaging/bridge';
import type { StudioLauncher } from '@/presentation/providers/studioLauncher';
import { cardEditorViewType } from '@/contributionIds';

export interface StudioCreateRpcDependencies {
  readonly aiGateway: AiGateway;
  readonly studio: Pick<StudioManager, 'create'>;
  readonly launcher: Pick<StudioLauncher, 'takePendingKind'>;
  readonly logger: IStoryboardLogger;
  readonly getProjectRoot: () => Promise<vscode.Uri | undefined>;
  readonly onWebviewMounted: () => void;
}

interface CreationTarget {
  readonly kind: StudioCreatableKind;
  readonly seed?: StudioCardSeed;
}

const missingProjectMessage: string = 'Storyboard 프로젝트를 먼저 열어 주세요.';
const unreadableKindMessage: string =
  '설명에서 인물인지 배경인지 읽지 못했어요. 이름과 함께 다시 적어 주시겠어요?';

const createdLabels: Readonly<Record<StudioCreatableKind, string>> = {
  character: '인물',
  background: '배경',
  scene: '씬',
};

function cardUriOf(root: vscode.Uri, kind: StudioCreatableKind, key: string): StoryUri {
  if (kind === 'scene') {
    return sceneCardPath(root, key);
  }

  return kind === 'character' ? characterCardPath(root, key) : backgroundCardPath(root, key);
}

function describeFill(edit: StudioEditResult): string {
  if (!edit.ok) {
    return `설명을 채우지 못했어요: ${edit.message}`;
  }

  return edit.kind === 'replied' ? edit.message : edit.summary;
}

function seedKindOf(seed: StudioCardSeed): StudioCreatableKind {
  return seed.kind === 'character' ? 'character' : 'background';
}

export class StudioCreateRpc {
  public constructor(private readonly deps: StudioCreateRpcDependencies) {}

  public handlers(): StoryboardRpcHandlers {
    return {
      'studio.create': this.create,
      'studio.create.pending': this.takePending,
    };
  }

  private readonly takePending = async (): Promise<
    StoryboardResponsePayload<'studio.create.pending'>
  > => {
    this.deps.onWebviewMounted();
    const kind: StudioCreatableKind | undefined = this.deps.launcher.takePendingKind();
    return kind === undefined ? {} : { kind };
  };

  private readonly create = async (
    payload: StoryboardRequestPayload<'studio.create'>,
  ): Promise<StoryboardResponsePayload<'studio.create'>> => {
    const root: vscode.Uri | undefined = await this.deps.getProjectRoot();
    if (!root) {
      return { ok: false, message: missingProjectMessage };
    }

    const target: CreationTarget | undefined = await this.resolveTarget(root, payload);
    if (target === undefined) {
      return { ok: false, message: unreadableKindMessage };
    }

    const created: StudioCreateResult = await this.deps.studio.create({
      workspaceRoot: root,
      kind: target.kind,
      ...(target.seed === undefined ? {} : { name: target.seed.name, slug: target.seed.id }),
      description: payload.description,
      shouldPropose: false,
      ...(target.seed === undefined ? {} : { whenSlugIsTaken: 'number-it' as const }),
    });
    if (!created.ok) {
      return { ok: false, message: created.message };
    }

    await vscode.commands.executeCommand(
      'vscode.openWith',
      cardUriOf(root, target.kind, created.key) as vscode.Uri,
      cardEditorViewType,
    );
    return { ok: true, message: this.describeCreated(target.kind, created) };
  };

  private async resolveTarget(
    root: vscode.Uri,
    payload: StoryboardRequestPayload<'studio.create'>,
  ): Promise<CreationTarget | undefined> {
    if (payload.kind === 'scene') {
      return { kind: 'scene' };
    }

    const seed: StudioCardSeed | undefined = await this.extractSeed(root, payload.description);
    const isSeedOfKind: boolean =
      seed !== undefined && (payload.kind === undefined || seedKindOf(seed) === payload.kind);

    if (payload.kind !== undefined) {
      return isSeedOfKind && seed !== undefined
        ? { kind: payload.kind, seed }
        : { kind: payload.kind };
    }

    return seed === undefined ? undefined : { kind: seedKindOf(seed), seed };
  }

  private async extractSeed(
    root: vscode.Uri,
    description: string,
  ): Promise<StudioCardSeed | undefined> {
    try {
      return await this.deps.aiGateway.createService(root).extractStudioCardSeed(description, {
        providerId: this.deps.aiGateway.getTaskProvider('studioAgent'),
      });
    } catch (error) {
      this.deps.logger.warn(`Studio 카드 이름 읽기 실패, 임시 이름으로 만듭니다: ${String(error)}`);
      return undefined;
    }
  }

  private describeCreated(
    kind: StudioCreatableKind,
    created: Extract<StudioCreateResult, { readonly ok: true }>,
  ): string {
    return `${createdLabels[kind]} ${created.key} 를 만들었어요. ${describeFill(created.edit)}`.trim();
  }
}
