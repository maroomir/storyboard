import type { ChapterSummaryLedger } from '#engine/persistence/cache/chapterSummaryLedger';
import { StoryLedger } from '#engine/persistence/bundles/storyLedger';
import { memoizeFileReads, SceneInputHasher } from '#engine/persistence/sceneInputHasher';
import {
  auditStoryState,
  formatStoryStateStaleWarning,
  resealStoryState,
  sealStoryState,
  serializeStoryState,
  storyStateSceneOrders,
} from '@storyboard/story-model';
import type {
  ProjectFormat,
  StoryboardProjectPaths,
  StoryState,
  StoryStateAudit,
} from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { WorkspaceCards } from '#engine/persistence/bundles/workspaceCards';
import type { SceneRoster, WorkspaceScenes } from '#engine/persistence/bundles/workspaceScenes';

export interface StoryStateAuditRequest {
  readonly fileSystem: IFileSystem;
  readonly cards: WorkspaceCards;
  readonly scenes: WorkspaceScenes;
  readonly summaries: ChapterSummaryLedger;
  readonly paths: StoryboardProjectPaths;
  readonly format: ProjectFormat;
  readonly sceneBreakJoiner: string | undefined;
  readonly beforeSceneOrder?: number;
}

export interface StoryMemoryAudit {
  readonly audit: StoryStateAudit;
  readonly staleWarning: string | undefined;
  readonly needsMarking: boolean;
}

export class StoryMemoryAuditor {
  public constructor(private readonly request: StoryStateAuditRequest) {}

  private ledger(): StoryLedger {
    return new StoryLedger({ scenes: this.request.scenes, cards: this.request.cards });
  }

  public async audit(): Promise<StoryMemoryAudit> {
    const reads: IFileSystem = memoizeFileReads(this.request.fileSystem);
    const state: StoryState = await this.ledger().read(
      this.request.paths.workspaceRoot,
      this.request.paths.threadId,
    );
    const currentHashes: Map<number, string> = await this.collectCurrentSceneInputHashes(
      reads,
      storyStateSceneOrders(state),
    );
    const audit: StoryStateAudit = auditStoryState(
      state,
      currentHashes,
      this.request.beforeSceneOrder,
    );

    return {
      audit,
      staleWarning: formatStoryStateStaleWarning(audit),
      needsMarking: serializeStoryState(audit.state) !== serializeStoryState(state),
    };
  }

  public async markStale(audit: StoryMemoryAudit): Promise<void> {
    if (!audit.needsMarking) {
      return;
    }

    await this.ledger().write(
      this.request.paths.workspaceRoot,
      this.request.paths.threadId,
      audit.audit.state,
    );
  }

  public async seal(): Promise<readonly number[]> {
    const reads: IFileSystem = memoizeFileReads(this.request.fileSystem);
    const state: StoryState = await this.ledger().read(
      this.request.paths.workspaceRoot,
      this.request.paths.threadId,
    );
    const unsealedOrders: number[] = storyStateSceneOrders(state).filter(
      (order) => !state.sceneInputHashes.has(order),
    );

    if (unsealedOrders.length === 0) {
      return [];
    }

    const currentHashes: Map<number, string> = await this.collectCurrentSceneInputHashes(
      reads,
      unsealedOrders,
    );
    await this.ledger().write(
      this.request.paths.workspaceRoot,
      this.request.paths.threadId,
      sealStoryState(state, currentHashes),
    );

    return [...currentHashes.keys()].sort((left, right) => left - right);
  }

  public async reseal(sceneOrders?: readonly number[]): Promise<readonly number[]> {
    const reads: IFileSystem = memoizeFileReads(this.request.fileSystem);
    const state: StoryState = await this.ledger().read(
      this.request.paths.workspaceRoot,
      this.request.paths.threadId,
    );
    const currentHashes: Map<number, string> = await this.collectCurrentSceneInputHashes(
      reads,
      storyStateSceneOrders(state),
    );
    const targets: number[] = auditStoryState(state, currentHashes).staleSceneOrders.filter(
      (order) => sceneOrders === undefined || sceneOrders.includes(order),
    );

    if (targets.length === 0) {
      return [];
    }

    await this.ledger().write(
      this.request.paths.workspaceRoot,
      this.request.paths.threadId,
      resealStoryState(state, currentHashes, new Set(targets)),
    );

    return targets;
  }

  private async collectCurrentSceneInputHashes(
    reads: IFileSystem,
    orders: readonly number[],
  ): Promise<Map<number, string>> {
    const currentHashes: Map<number, string> = new Map<number, string>();

    if (orders.length === 0) {
      return currentHashes;
    }

    const sceneFileNames: Map<number, string> = await this.listSceneFileNamesByOrder();

    await Promise.all(
      orders.map(async (order) => {
        const fileName: string | undefined = sceneFileNames.get(order);
        if (fileName === undefined) {
          return;
        }

        const hash: string | undefined = await this.computeCurrentSceneInputHash(reads, fileName);
        if (hash !== undefined) {
          currentHashes.set(order, hash);
        }
      }),
    );

    return currentHashes;
  }

  private async listSceneFileNamesByOrder(): Promise<Map<number, string>> {
    const roster: SceneRoster = await this.request.scenes.loadRoster(this.request.paths.workspaceRoot);
    return new Map(roster.scenes.map((scene) => [scene.order, scene.stem]));
  }

  private async computeCurrentSceneInputHash(
    reads: IFileSystem,
    fileName: string,
  ): Promise<string | undefined> {
    const { cards, scenes, summaries, paths, format, sceneBreakJoiner } = this.request;

    return await new SceneInputHasher({ fileSystem: reads, cards, scenes, summaries }).computeCurrent(
      paths,
      fileName,
      { format, sceneBreakJoiner },
    );
  }
}
