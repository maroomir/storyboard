import { SceneContextReader } from '#engine/persistence/sceneContextReader';
import {
  auditStoryState,
  computeSceneInputHash,
  formatStoryStateStaleWarning,
  joinStoryPath,
  parseSceneFileName,
  readSceneFile,
  readStoryState,
  resealStoryState,
  sceneContextPaths,
  sceneNarrationHashInput,
  sealStoryState,
  serializeStoryState,
  storyStateSceneOrders,
  writeStoryState,
} from '@storyboard/story-model';
import type {
  BibleFact,
  ProjectFormat,
  SceneContext,
  SceneContextWorkspacePaths,
  SceneFile,
  SceneFileNameParts,
  StoryboardProjectPaths,
  StoryState,
  StoryStateAudit,
  StoryUri,
} from '@storyboard/story-model';
import type { FileSystemDirectoryEntry, IFileSystem } from '#engine/ports/fileSystem';

export interface StoryStateAuditRequest {
  readonly fileSystem: IFileSystem;
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

function memoizeFileReads(fileSystem: IFileSystem): IFileSystem {
  const reads: Map<string, Promise<Uint8Array<ArrayBufferLike>>> = new Map<
    string,
    Promise<Uint8Array>
  >();

  return {
    readFile: (uri: StoryUri): Promise<Uint8Array> => {
      const cached: Promise<Uint8Array<ArrayBufferLike>> | undefined = reads.get(uri.path);
      if (cached) {
        return cached;
      }

      const pending: Promise<Uint8Array> = fileSystem.readFile(uri);
      reads.set(uri.path, pending);
      return pending;
    },
    writeFile: (uri, content) => fileSystem.writeFile(uri, content),
    createDirectory: (uri) => fileSystem.createDirectory(uri),
    exists: (uri) => fileSystem.exists(uri),
    listFileNames: (uri) => fileSystem.listFileNames(uri),
    readDirectory: (uri) => fileSystem.readDirectory(uri),
    delete: (uri) => fileSystem.delete(uri),
    modifiedTime: (uri) => fileSystem.modifiedTime(uri),
    isRealPathInside: (uri, root) => fileSystem.isRealPathInside(uri, root),
  };
}

export class StoryMemoryAuditor {
  public constructor(private readonly request: StoryStateAuditRequest) {}

  public async audit(): Promise<StoryMemoryAudit> {
    const reads: IFileSystem = memoizeFileReads(this.request.fileSystem);
    const state: StoryState = await readStoryState(this.request.paths.storyState, reads);
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

    await writeStoryState(
      this.request.paths.storyState,
      audit.audit.state,
      this.request.fileSystem,
    );
  }

  public async seal(): Promise<readonly number[]> {
    const reads: IFileSystem = memoizeFileReads(this.request.fileSystem);
    const state: StoryState = await readStoryState(this.request.paths.storyState, reads);
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
    await writeStoryState(
      this.request.paths.storyState,
      sealStoryState(state, currentHashes),
      this.request.fileSystem,
    );

    return [...currentHashes.keys()].sort((left, right) => left - right);
  }

  public async reseal(sceneOrders?: readonly number[]): Promise<readonly number[]> {
    const reads: IFileSystem = memoizeFileReads(this.request.fileSystem);
    const state: StoryState = await readStoryState(this.request.paths.storyState, reads);
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

    await writeStoryState(
      this.request.paths.storyState,
      resealStoryState(state, currentHashes, new Set(targets)),
      this.request.fileSystem,
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

    const sceneFileNames: Map<number, string> = await this.listSceneFileNamesByOrder(reads);

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

  private async listSceneFileNamesByOrder(reads: IFileSystem): Promise<Map<number, string>> {
    const byOrder: Map<number, string> = new Map<number, string>();

    const entries: never[] | FileSystemDirectoryEntry[] = await reads
      .readDirectory(this.request.paths.sceneDirectory)
      .catch(() => []);
    for (const [fileName, entry] of entries) {
      if (entry.type !== 'file' || !fileName.endsWith('.card')) {
        continue;
      }

      const parsed: SceneFileNameParts | undefined = parseSceneFileName(fileName);
      if (parsed) {
        byOrder.set(parsed.order, fileName);
      }
    }

    return byOrder;
  }

  private async computeCurrentSceneInputHash(
    reads: IFileSystem,
    fileName: string,
  ): Promise<string | undefined> {
    const { paths, format, sceneBreakJoiner } = this.request;

    try {
      const sceneUri: StoryUri = joinStoryPath(paths.sceneDirectory, fileName);
      const scene: SceneFile = await readSceneFile(sceneUri, reads, fileName);
      const ctxPaths: SceneContextWorkspacePaths = sceneContextPaths(paths);
      const context: SceneContext = await new SceneContextReader(reads).build(ctxPaths, scene);
      const bibleFacts: readonly BibleFact[] = await new SceneContextReader(
        reads,
      ).resolveBibleFacts(ctxPaths, context);

      return computeSceneInputHash({
        sceneBody: context.scene.body,
        characters: context.characters,
        background: context.background,
        format,
        bibleFacts,
        sceneBreakJoiner,
        grounding: context.scene.frontmatter.grounding,
        narration: sceneNarrationHashInput(context.scene),
      });
    } catch {
      return undefined;
    }
  }
}
