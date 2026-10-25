import {
  auditStoryState,
  formatStoryStateStaleWarning,
  resealStoryState,
  sealStoryState,
  serializeStoryState,
  writeStoryState,
  buildSceneContext,
  joinStoryPath,
  parseSceneFileName,
  readSceneFile,
  readStoryState,
  resolveSceneBibleFacts,
  storyStateSceneOrders,
  type ProjectFormat,
  type StoryState,
  type StoryStateAudit,
  type StoryUri,
  computeSceneInputHash,
  sceneNarrationHashInput,
  sceneContextPaths,
} from '@storyboard/story-model';
import type { FileSystemDirectoryEntry, IFileSystem } from '#engine/ports/fileSystem';
import type {
  BibleFact,
  SceneContext,
  SceneContextWorkspacePaths,
  SceneFile,
  SceneFileNameParts,
  StoryboardProjectPaths,
} from '@storyboard/story-model';

export interface StoryStateAuditRequest {
  readonly fileSystem: IFileSystem;
  readonly paths: StoryboardProjectPaths;
  readonly format: ProjectFormat;
  readonly sceneBreakJoiner: string | undefined;
  readonly beforeSceneOrder?: number;
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

async function listSceneFileNamesByOrder(
  fileSystem: IFileSystem,
  sceneDirectory: StoryUri,
): Promise<Map<number, string>> {
  const byOrder: Map<number, string> = new Map<number, string>();

  const entries: never[] | FileSystemDirectoryEntry[] = await fileSystem
    .readDirectory(sceneDirectory)
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

async function computeCurrentSceneInputHash(
  request: StoryStateAuditRequest,
  fileSystem: IFileSystem,
  fileName: string,
): Promise<string | undefined> {
  const { paths, format, sceneBreakJoiner } = request;

  try {
    const sceneUri: StoryUri = joinStoryPath(paths.sceneDirectory, fileName);
    const scene: SceneFile = await readSceneFile(sceneUri, fileSystem, fileName);
    const ctxPaths: SceneContextWorkspacePaths = sceneContextPaths(paths);
    const context: SceneContext = await buildSceneContext(ctxPaths, scene, fileSystem);
    const bibleFacts: readonly BibleFact[] = await resolveSceneBibleFacts(
      ctxPaths,
      context,
      fileSystem,
    );

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

export interface StoryMemoryAudit {
  readonly audit: StoryStateAudit;
  readonly staleWarning: string | undefined;
  readonly needsMarking: boolean;
}

export async function auditStoryMemory(request: StoryStateAuditRequest): Promise<StoryMemoryAudit> {
  const fileSystem: IFileSystem = memoizeFileReads(request.fileSystem);
  const state: StoryState = await readStoryState(request.paths.storyState, fileSystem);
  const audit: StoryStateAudit = await auditAgainstCurrentScenes(request, fileSystem, state);

  return {
    audit,
    staleWarning: formatStoryStateStaleWarning(audit),
    needsMarking: serializeStoryState(audit.state) !== serializeStoryState(state),
  };
}

export async function markStoryStateStaleEntries(
  paths: StoryboardProjectPaths,
  fileSystem: IFileSystem,
  audit: StoryMemoryAudit,
): Promise<void> {
  if (!audit.needsMarking) {
    return;
  }

  await writeStoryState(paths.storyState, audit.audit.state, fileSystem);
}

async function auditAgainstCurrentScenes(
  request: StoryStateAuditRequest,
  fileSystem: IFileSystem,
  state: StoryState,
): Promise<StoryStateAudit> {
  const currentHashes: Map<number, string> = await collectCurrentSceneInputHashes(
    request,
    fileSystem,
    storyStateSceneOrders(state),
  );

  return auditStoryState(state, currentHashes, request.beforeSceneOrder);
}

export async function sealStoryMemory(request: StoryStateAuditRequest): Promise<readonly number[]> {
  const fileSystem: IFileSystem = memoizeFileReads(request.fileSystem);
  const state: StoryState = await readStoryState(request.paths.storyState, fileSystem);
  const unsealedOrders: number[] = storyStateSceneOrders(state).filter(
    (order) => !state.sceneInputHashes.has(order),
  );

  if (unsealedOrders.length === 0) {
    return [];
  }

  const currentHashes: Map<number, string> = await collectCurrentSceneInputHashes(
    request,
    fileSystem,
    unsealedOrders,
  );
  await writeStoryState(
    request.paths.storyState,
    sealStoryState(state, currentHashes),
    request.fileSystem,
  );

  return [...currentHashes.keys()].sort((left, right) => left - right);
}

export interface ResealStoryMemoryRequest extends StoryStateAuditRequest {
  readonly sceneOrders?: readonly number[];
}

export async function resealStoryMemory(
  request: ResealStoryMemoryRequest,
): Promise<readonly number[]> {
  const fileSystem: IFileSystem = memoizeFileReads(request.fileSystem);
  const state: StoryState = await readStoryState(request.paths.storyState, fileSystem);
  const currentHashes: Map<number, string> = await collectCurrentSceneInputHashes(
    request,
    fileSystem,
    storyStateSceneOrders(state),
  );
  const requested: readonly number[] | undefined = request.sceneOrders;
  const targets: number[] = auditStoryState(state, currentHashes).staleSceneOrders.filter(
    (order) => requested === undefined || requested.includes(order),
  );

  if (targets.length === 0) {
    return [];
  }

  await writeStoryState(
    request.paths.storyState,
    resealStoryState(state, currentHashes, new Set(targets)),
    request.fileSystem,
  );

  return targets;
}

async function collectCurrentSceneInputHashes(
  request: StoryStateAuditRequest,
  fileSystem: IFileSystem,
  orders: readonly number[],
): Promise<Map<number, string>> {
  const currentHashes: Map<number, string> = new Map<number, string>();

  if (orders.length === 0) {
    return currentHashes;
  }

  const sceneFileNames: Map<number, string> = await listSceneFileNamesByOrder(
    fileSystem,
    request.paths.sceneDirectory,
  );

  await Promise.all(
    orders.map(async (order) => {
      const fileName: string | undefined = sceneFileNames.get(order);
      if (fileName === undefined) {
        return;
      }

      const hash: string | undefined = await computeCurrentSceneInputHash(
        request,
        fileSystem,
        fileName,
      );
      if (hash !== undefined) {
        currentHashes.set(order, hash);
      }
    }),
  );

  return currentHashes;
}
