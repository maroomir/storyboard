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
} from '@storyboard/story-format';
import {
  computeSceneInputHash,
  sceneNarrationHashInput,
} from '#engine/domain/files/sceneCache';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { StoryboardProjectPaths } from '#engine/paths/projectPaths';
import { sceneContextPaths } from '#engine/paths/sceneContextPaths';

export interface StoryStateAuditRequest {
  readonly fileSystem: IFileSystem;
  readonly paths: StoryboardProjectPaths;
  readonly format: ProjectFormat;
  readonly sceneBreakJoiner: string | undefined;
  // 이 씬보다 앞에서 확립된 낡은 항목만 보고한다. 진단(doctor)처럼 원장 전체를 봐야 하면 생략한다.
  readonly beforeSceneOrder?: number;
}

// NOTE: 원장에 기록된 씬마다 같은 카드를 다시 읽는다. 32씬이면 인물 카드 하나를 32번 읽게 되므로
// 이 감사가 도는 동안만 읽기를 기억해 둔다. 감사가 끝나면 버려지므로 워크스페이스 변경과 어긋나지
// 않는다.
function memoizeFileReads(fileSystem: IFileSystem): IFileSystem {
  const reads = new Map<string, Promise<Uint8Array>>();

  // NOTE: 어댑터는 클래스이고 비공개 필드를 쓸 수 있으므로 스프레드나 Object.create로 감싸면
  // 메서드나 this가 어긋난다. 위임을 하나씩 적는다.
  return {
    readFile: (uri: StoryUri) => {
      const cached = reads.get(uri.path);
      if (cached) {
        return cached;
      }

      const pending = fileSystem.readFile(uri);
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
  };
}

async function listSceneFileNamesByOrder(
  fileSystem: IFileSystem,
  sceneDirectory: StoryUri,
): Promise<Map<number, string>> {
  const byOrder = new Map<number, string>();

  const entries = await fileSystem.readDirectory(sceneDirectory).catch(() => []);
  for (const [fileName, entry] of entries) {
    if (entry.type !== 'file' || !fileName.endsWith('.card')) {
      continue;
    }

    const parsed = parseSceneFileName(fileName);
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
    const sceneUri = joinStoryPath(paths.sceneDirectory, fileName);
    const scene = await readSceneFile(sceneUri, fileSystem, fileName);
    const ctxPaths = sceneContextPaths(paths);
    const context = await buildSceneContext(ctxPaths, scene, fileSystem);
    const bibleFacts = await resolveSceneBibleFacts(ctxPaths, context, fileSystem);

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
    // 읽히지 않는 씬은 "그 입력이 더 이상 없다"와 같다. 해시를 비워 두면 감사가 낡음으로 판정한다.
    return undefined;
  }
}

export interface StoryMemoryAudit {
  readonly audit: StoryStateAudit;
  readonly staleWarning: string | undefined;
  // 감사가 새로 찾아낸 낡음이 있어 원장 파일의 표시가 실제와 다른 상태.
  readonly needsMarking: boolean;
}

export async function auditStoryMemory(request: StoryStateAuditRequest): Promise<StoryMemoryAudit> {
  const fileSystem = memoizeFileReads(request.fileSystem);
  const state = await readStoryState(request.paths.storyState, fileSystem);
  const audit = await auditAgainstCurrentScenes(request, fileSystem, state);

  return {
    audit,
    staleWarning: formatStoryStateStaleWarning(audit),
    needsMarking: serializeStoryState(audit.state) !== serializeStoryState(state),
  };
}

// 표시는 사람이 원장에서 무엇이 버려졌는지 보기 위한 것이므로 파일에 남긴다. 바뀐 것이 없으면
// 쓰지 않는다 — 뜻 없는 저장은 파일 시각과 diff 만 어지럽힌다.
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
  const currentHashes = await collectCurrentSceneInputHashes(
    request,
    fileSystem,
    storyStateSceneOrders(state),
  );

  return auditStoryState(state, currentHashes, request.beforeSceneOrder);
}

// 0.8 이전 원장에는 대조할 해시가 없다. 봉인은 지금의 카드·씬을 기준으로 삼아 그 근거를 만드는
// 일회성 조치이므로, 봉인한 뒤에 고친 것부터 낡음으로 잡힌다.
export async function sealStoryMemory(request: StoryStateAuditRequest): Promise<readonly number[]> {
  const fileSystem = memoizeFileReads(request.fileSystem);
  const state = await readStoryState(request.paths.storyState, fileSystem);
  const unsealedOrders = storyStateSceneOrders(state).filter(
    (order) => !state.sceneInputHashes.has(order),
  );

  if (unsealedOrders.length === 0) {
    return [];
  }

  const currentHashes = await collectCurrentSceneInputHashes(request, fileSystem, unsealedOrders);
  await writeStoryState(
    request.paths.storyState,
    sealStoryState(state, currentHashes),
    request.fileSystem,
  );

  return [...currentHashes.keys()].sort((left, right) => left - right);
}

export interface ResealStoryMemoryRequest extends StoryStateAuditRequest {
  // 비우면 지금 낡음으로 잡힌 씬 전부. 봉인하지 않은 씬은 대상이 아니다 — 그건 sealStoryMemory 다.
  readonly sceneOrders?: readonly number[];
}

// 카드를 고치고도 초안은 그대로 두기로 한 판단을 원장에 반영한다. 낡음 판정 자체는 옳으므로
// 자동으로 하지 않고, 사람이 이 명령을 불러 "지금 초안이 맞다"고 선언할 때만 덮어쓴다.
export async function resealStoryMemory(
  request: ResealStoryMemoryRequest,
): Promise<readonly number[]> {
  const fileSystem = memoizeFileReads(request.fileSystem);
  const state = await readStoryState(request.paths.storyState, fileSystem);
  const currentHashes = await collectCurrentSceneInputHashes(
    request,
    fileSystem,
    storyStateSceneOrders(state),
  );
  const requested = request.sceneOrders;
  const targets = auditStoryState(state, currentHashes).staleSceneOrders.filter(
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
  const currentHashes = new Map<number, string>();

  if (orders.length === 0) {
    return currentHashes;
  }

  const sceneFileNames = await listSceneFileNamesByOrder(fileSystem, request.paths.sceneDirectory);

  await Promise.all(
    orders.map(async (order) => {
      const fileName = sceneFileNames.get(order);
      if (fileName === undefined) {
        return;
      }

      const hash = await computeCurrentSceneInputHash(request, fileSystem, fileName);
      if (hash !== undefined) {
        currentHashes.set(order, hash);
      }
    }),
  );

  return currentHashes;
}
