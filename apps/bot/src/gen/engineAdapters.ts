import { promises as nodeFs } from 'node:fs';
import { dirname } from 'node:path';

import {
  NodeUri,
  type FileSystemDirectoryEntry,
  type IFileSystem,
  type IProjectRepository,
  type ISceneCacheRepository,
  type ISceneRepository,
  type SceneCacheRecord,
  type StoryUri,
  type StoryWorkspaceFolder,
  type IWorkspaceLocator,
  parseSceneCache,
  serializeSceneCache,
} from '@storyboard/story-engine';
import {
  applySceneGrounding,
  draftRelativePath,
  joinStoryPath,
  type SceneFile,
  type SceneGrounding,
  type StoryboardProject,
} from '@storyboard/story-format';

import type { ContentService } from '@/content/contentService';
import type { MutateOutcome } from '@/workspace/workspaceChanges';
import type { WorkspaceStore } from '@/workspace/workspaceStore';

function pathOf(uri: StoryUri): string {
  return uri.fsPath;
}

// Directories the workspace scaffold gitignores. Everything else is tracked, which for this app
// means a write there has to be a commit.
const untrackedPrefixes = ['draft/', '.draft/', 'manuscript/', '.storyboard/cache/'];

// The bot's write policy expressed as a file system: a draft goes through ContentService so the
// archive-then-write path and the outcome reporting stay the bot's only way to touch `draft/`,
// while gitignored side artefacts (`.storyboard/cache/`, `.draft/`) go straight to disk.
//
// A tracked path is refused outright. The bot's invariant is "a successful save of a tracked file
// is a commit", and an engine use case that reaches for the file system to write one would break
// that silently — no commit, no freshness guard. Failing loudly is what keeps the invariant true
// as the engine grows: the fix is to give that use case a repository port, not to relax this.
export class BotFileSystem implements IFileSystem {
  private lastDraftOutcome: MutateOutcome | undefined;

  public constructor(
    private readonly content: ContentService,
    private readonly workspaceRoot: StoryUri,
  ) {}

  public async readFile(uri: StoryUri): Promise<Uint8Array> {
    return await nodeFs.readFile(pathOf(uri));
  }

  public async writeFile(uri: StoryUri, content: Uint8Array): Promise<void> {
    const target = pathOf(uri);
    const draftStem = this.draftStemOf(uri);

    if (draftStem === undefined) {
      this.refuseTrackedWrite(uri);
    }

    if (draftStem !== undefined) {
      this.lastDraftOutcome = await this.content.writeDraft(
        draftStem,
        new TextDecoder().decode(content),
      );
      return;
    }

    const temporary = `${target}.tmp-${Date.now().toString(36)}`;

    try {
      await nodeFs.mkdir(dirname(target), { recursive: true });
      await nodeFs.writeFile(temporary, content);
      await nodeFs.rename(temporary, target);
    } catch (error) {
      await nodeFs.rm(temporary, { force: true });
      throw error;
    }
  }

  public takeDraftOutcome(): MutateOutcome | undefined {
    return this.lastDraftOutcome;
  }

  private refuseTrackedWrite(uri: StoryUri): void {
    const rootPath = this.workspaceRoot.path.replace(/\/$/, '');

    if (!uri.path.startsWith(`${rootPath}/`)) {
      return;
    }

    const relativePath = uri.path.slice(rootPath.length + 1);

    if (!untrackedPrefixes.some((prefix) => relativePath.startsWith(prefix))) {
      throw new Error(
        `추적 파일을 게이트 밖에서 쓰려 했습니다: ${relativePath}. ` +
          '이 경로는 커밋되어야 하므로 ContentService 를 지나는 저장소 포트로 써야 합니다.',
      );
    }
  }

  // Anchored at the workspace root, and matched on the posix `path` rather than the OS-shaped
  // `fsPath`: a suffix test would also catch `manuscript/draft/01.md`, and a `/` split would miss
  // every draft on Windows.
  private draftStemOf(uri: StoryUri): string | undefined {
    const fileName = uri.path.split('/').pop();

    if (fileName === undefined || !fileName.endsWith('.md')) {
      return undefined;
    }

    const stem = fileName.slice(0, -'.md'.length);
    const expected = joinStoryPath(this.workspaceRoot, ...draftRelativePath(stem).split('/'));

    return uri.path === expected.path ? stem : undefined;
  }

  public async createDirectory(uri: StoryUri): Promise<void> {
    await nodeFs.mkdir(pathOf(uri), { recursive: true });
  }

  public async exists(uri: StoryUri): Promise<boolean> {
    try {
      await nodeFs.stat(pathOf(uri));
      return true;
    } catch {
      return false;
    }
  }

  public async listFileNames(uri: StoryUri): Promise<readonly string[]> {
    const entries = await nodeFs.readdir(pathOf(uri), { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  }

  public async readDirectory(uri: StoryUri): Promise<FileSystemDirectoryEntry[]> {
    const entries = await nodeFs.readdir(pathOf(uri), { withFileTypes: true });
    return entries.map((entry) => [
      entry.name,
      { type: entry.isDirectory() ? ('directory' as const) : ('file' as const) },
    ]);
  }

  public async delete(uri: StoryUri): Promise<void> {
    await nodeFs.rm(pathOf(uri), { recursive: true, force: true });
  }

  public async modifiedTime(uri: StoryUri): Promise<number> {
    try {
      return (await nodeFs.stat(pathOf(uri))).mtimeMs;
    } catch {
      return 0;
    }
  }
}

export class BotWorkspaceLocator implements IWorkspaceLocator {
  private readonly folder: StoryWorkspaceFolder;

  public constructor(root: string) {
    this.folder = { uri: NodeUri.file(root), name: 'workspace' };
  }

  public folders(): readonly StoryWorkspaceFolder[] {
    return [this.folder];
  }

  public folderFor(): StoryWorkspaceFolder {
    return this.folder;
  }
}

export class BotProjectRepository implements IProjectRepository {
  public constructor(private readonly store: WorkspaceStore) {}

  public async read(): Promise<StoryboardProject> {
    const project = (await this.store.readProject()).value;

    // The bot reads project.json leniently — a workspace scaffolded before `format` became a
    // required field still has to generate. The extension's own default is the novel format.
    return project.format === undefined ? { ...project, format: 'novel' } : project;
  }
}

// `scene/` is tracked, so filling grounding is a commit of its own. The baseline is the hash from
// the read that the proposal was derived from — not a fresh one — which is what makes a Desktop
// edit landing mid-job refuse the write instead of clobbering it.
export class BotSceneRepository implements ISceneRepository {
  private readonly baselineByPath = new Map<string, { path: string; hash: string; raw: string }>();

  public constructor(
    private readonly store: WorkspaceStore,
    private readonly content: ContentService,
    private readonly onStaleGrounding?: () => void,
  ) {}

  public async read(_uri: StoryUri, fileName: string): Promise<SceneFile> {
    const stem = fileName.replace(/\.card$/, '');
    const scene = await this.store.readScene(stem);
    this.baselineByPath.set(stem, {
      path: scene.relativePath,
      hash: scene.contentHash,
      raw: await this.store.readText(scene.relativePath),
    });
    return scene.value;
  }

  public async writeGrounding(uri: StoryUri, grounding: SceneGrounding): Promise<void> {
    const stem =
      pathOf(uri)
        .split('/')
        .pop()
        ?.replace(/\.card$/, '') ?? '';
    const baseline = this.baselineByPath.get(stem);

    if (!baseline) {
      throw new Error(`grounding write without a read baseline: ${stem}`);
    }

    const outcome = await this.content.writeTracked(
      baseline.path,
      applySceneGrounding(baseline.raw, grounding),
      baseline.hash,
      `storyboard-bot: ground ${baseline.path}`,
    );

    if (!isSettled(outcome)) {
      this.onStaleGrounding?.();
    }
  }
}

export class BotSceneCacheRepository implements ISceneCacheRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async read(uri: StoryUri): Promise<SceneCacheRecord> {
    return parseSceneCache(new TextDecoder().decode(await this.fileSystem.readFile(uri)));
  }

  public async write(uri: StoryUri, record: SceneCacheRecord): Promise<void> {
    await this.fileSystem.writeFile(uri, new TextEncoder().encode(serializeSceneCache(record)));
  }

  public async ensureDirectory(uri: StoryUri): Promise<void> {
    await this.fileSystem.createDirectory(uri);
  }
}

function isSettled(outcome: MutateOutcome): boolean {
  return outcome.status === 'committed' || outcome.status === 'written';
}
