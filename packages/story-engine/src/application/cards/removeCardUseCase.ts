import { randomUUID } from 'node:crypto';

import {
  serializeStudioSession,
  studioSessionVersion,
  type StudioSession,
  removeCardFromLines,
  removeCardFromScene,
  type CardLineRemoval,
  type SceneCardRemoval,
  type SceneStoryState,
  type Statement,
  type StoryStateStatement,
  type StoryStructure,
  type StoryUri,
} from '@storyboard/story-model';

import type { IUseCase } from '#engine/application/useCase';
import { SessionStore } from '#engine/persistence/cache/sessionStore';
import type { WorkspaceCaches } from '#engine/persistence/cache/workspaceCaches';
import type { ElementBundle } from '#engine/persistence/bundles/elementBundleRepository';
import type {
  CardBundleKind,
  CardRoster,
  WorkspaceCards,
} from '#engine/persistence/bundles/workspaceCards';
import type {
  SceneRoster,
  SceneRosterEntry,
  WorkspaceScenes,
} from '#engine/persistence/bundles/workspaceScenes';

export interface RemoveCardUseCaseDependencies {
  readonly cards: WorkspaceCards;
  readonly scenes: WorkspaceScenes;
  readonly caches: WorkspaceCaches;
}

export interface RemoveCardRequest {
  readonly workspaceRoot: StoryUri;
  readonly slug: string;
  readonly shouldForce: boolean;
  readonly isPreview?: boolean;
}

export interface CardRemovalLine {
  readonly path: string;
  readonly value: string;
}

export interface CardRemovalPlan {
  readonly path: string;
  readonly cardId: string;
  readonly referencingPaths: readonly string[];
  readonly droppedLines: readonly CardRemovalLine[];
}

export type RemoveCardResult =
  | { readonly ok: true; readonly kind: 'removed' | 'previewed'; readonly plan: CardRemovalPlan }
  | {
      readonly ok: false;
      readonly kind: 'referenced';
      readonly plan: CardRemovalPlan;
      readonly message: string;
    }
  | { readonly ok: false; readonly kind: 'missing' | 'not-a-card'; readonly message: string };

type PlannedWrite = () => Promise<void>;

interface RemovalWork {
  readonly referencingPaths: string[];
  readonly droppedLines: CardRemovalLine[];
  readonly writes: PlannedWrite[];
}

export function describeRemoval(plan: CardRemovalPlan): string {
  const dropped: readonly string[] = plan.droppedLines.map((line) => `- ${line.path}: ${line.value}`);

  return [
    `${plan.path} 를 지웠습니다. 함께 고친 곳 ${plan.referencingPaths.length}곳.`,
    ...(dropped.length === 0 ? [] : ['함께 지운 줄:', ...dropped]),
  ].join('\n');
}

const removableKinds: readonly string[] = ['character', 'background', 'narrator'];

function isRemovableKind(kind: string): kind is CardBundleKind {
  return removableKinds.includes(kind);
}

export class RemoveCardUseCase implements IUseCase<RemoveCardRequest, RemoveCardResult> {
  public constructor(private readonly dependencies: RemoveCardUseCaseDependencies) {}

  public async execute(request: RemoveCardRequest): Promise<RemoveCardResult> {
    const root: StoryUri = request.workspaceRoot;
    const bundle: ElementBundle | undefined = await this.dependencies.cards.findBundleBySlug(
      root,
      request.slug,
    );
    if (bundle === undefined) {
      return { ok: false, kind: 'missing', message: `카드가 없습니다: ${request.slug}` };
    }
    const kind: string = bundle.header.kind;
    if (!isRemovableKind(kind)) {
      return { ok: false, kind: 'not-a-card', message: `카드가 아닙니다: ${request.slug}` };
    }

    const work: RemovalWork = await this.planRemoval(root, bundle);
    const plan: CardRemovalPlan = {
      path: bundle.path,
      cardId: bundle.header.id,
      referencingPaths: work.referencingPaths,
      droppedLines: work.droppedLines,
    };
    if (request.isPreview === true) {
      return { ok: true, kind: 'previewed', plan };
    }

    const isReferenced: boolean = work.referencingPaths.length > 0;
    if (isReferenced && !request.shouldForce) {
      return {
        ok: false,
        kind: 'referenced',
        plan,
        message: `${request.slug} 를 가리키는 곳이 ${work.referencingPaths.length}곳 있습니다. 함께 정리하려면 --force 를 주세요.`,
      };
    }

    for (const write of work.writes) {
      await write();
    }
    await this.dependencies.cards.remove(root, kind, bundle.header.slug);
    await this.recordRemoval(root, kind, bundle.header.slug, plan);
    return { ok: true, kind: 'removed', plan };
  }

  private async recordRemoval(
    root: StoryUri,
    kind: CardBundleKind,
    slug: string,
    plan: CardRemovalPlan,
  ): Promise<void> {
    const removedAt: string = new Date().toISOString();
    const session: StudioSession = {
      version: studioSessionVersion,
      id: randomUUID(),
      entity: { kind, key: slug },
      createdAt: removedAt,
      updatedAt: removedAt,
      title: `${slug} 삭제`,
      hasAppliedChanges: true,
      turns: [{ id: randomUUID(), role: 'assistant', kind: 'say', message: describeRemoval(plan) }],
    };

    new SessionStore(await this.dependencies.caches.open(root)).save({
      id: session.id,
      kind: 'studio',
      elementId: plan.cardId,
      openedAt: removedAt,
      pendingCount: 0,
      data: JSON.parse(serializeStudioSession(session)),
    });
  }

  private async planRemoval(root: StoryUri, removed: ElementBundle): Promise<RemovalWork> {
    const work: RemovalWork = { referencingPaths: [], droppedLines: [], writes: [] };
    const cardId: string = removed.header.id;
    const roster: CardRoster = await this.dependencies.cards.loadRoster(root);

    for (const bundle of roster.bundles.filter((item) => item.header.id !== cardId)) {
      this.planCardBundle(root, bundle, cardId, work);
    }

    const scenes: SceneRoster = await this.dependencies.scenes.loadRoster(root);
    for (const entry of scenes.entries) {
      this.planSceneBundle(root, entry, cardId, work);
      await this.planSceneState(root, entry, cardId, work);
    }
    this.planStructure(root, scenes.structure, cardId, work);

    return work;
  }

  private planCardBundle(
    root: StoryUri,
    bundle: ElementBundle,
    cardId: string,
    work: RemovalWork,
  ): void {
    const removal: CardLineRemoval<Statement> = removeCardFromLines(bundle.statements, cardId, {
      shouldDropAboutLines: true,
    });
    const header: ElementBundle['header'] = bundle.header;
    const isFocal: boolean = 'focal' in header && header.focal === cardId;
    if (!removal.hasChanged && !isFocal) {
      return;
    }

    const { focal: _focal, ...headerWithoutFocal } = header as ElementBundle['header'] & {
      readonly focal?: string;
    };
    work.referencingPaths.push(bundle.path);
    work.droppedLines.push(...removal.dropped.map((line) => ({ path: bundle.path, value: line.value })));
    work.writes.push(() =>
      this.dependencies.cards.rewriteBundle(root, bundle, {
        header: isFocal ? (headerWithoutFocal as ElementBundle['header']) : header,
        statements: removal.lines,
      }),
    );
  }

  private planSceneBundle(
    root: StoryUri,
    entry: SceneRosterEntry,
    cardId: string,
    work: RemovalWork,
  ): void {
    const removal: SceneCardRemoval = removeCardFromScene(
      entry.content.header,
      entry.content.beats,
      cardId,
    );
    const statements: CardLineRemoval<Statement> = removeCardFromLines(
      entry.content.statements,
      cardId,
      { shouldDropAboutLines: true },
    );
    if (!removal.hasChanged && !statements.hasChanged) {
      return;
    }

    work.referencingPaths.push(entry.path);
    work.droppedLines.push(...statements.dropped.map((line) => ({ path: entry.path, value: line.value })));
    work.writes.push(() =>
      this.dependencies.scenes.rewriteContent(root, entry, {
        ...entry.content,
        header: removal.header,
        beats: removal.beats,
        statements: statements.lines,
      }),
    );
  }

  private async planSceneState(
    root: StoryUri,
    entry: SceneRosterEntry,
    cardId: string,
    work: RemovalWork,
  ): Promise<void> {
    const state: SceneStoryState | undefined = await this.dependencies.scenes.readState(
      root,
      entry.file.stem,
    );
    if (state === undefined) {
      return;
    }

    const removal: CardLineRemoval<StoryStateStatement> = removeCardFromLines(
      state.statements,
      cardId,
      { shouldDropAboutLines: false },
    );
    if (!removal.hasChanged) {
      return;
    }

    const statePath: string = `${entry.path}/state.yaml`;
    work.referencingPaths.push(statePath);
    work.droppedLines.push(...removal.dropped.map((line) => ({ path: statePath, value: line.value })));
    work.writes.push(() =>
      this.dependencies.scenes.writeState(root, entry.file.stem, {
        ...state,
        statements: removal.lines,
      }),
    );
  }

  private planStructure(
    root: StoryUri,
    structure: StoryStructure,
    cardId: string,
    work: RemovalWork,
  ): void {
    if (!structure.scenes.some((entry) => entry.narrator === cardId)) {
      return;
    }

    work.referencingPaths.push('.storyboard/structure.yaml');
    work.writes.push(() =>
      this.dependencies.scenes.writeStructure(root, {
        ...structure,
        scenes: structure.scenes.map((entry) => {
          if (entry.narrator !== cardId) {
            return entry;
          }
          const { narrator: _narrator, ...rest } = entry;
          return rest;
        }),
      }),
    );
  }
}
