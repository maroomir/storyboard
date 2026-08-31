import { promises as nodeFs } from 'node:fs';

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
  type WorkspaceLocator,
  parseSceneCache,
  serializeSceneCache,
} from '@storyboard/story-engine';
import {
  applySceneGrounding,
  draftRelativePath,
  type SceneFile,
  type SceneGrounding,
  type StoryboardProject,
} from '@storyboard/story-format';

import type { ContentService } from '../content/contentService';
import type { MutateOutcome } from '../workspace/workspaceChanges';
import type { WorkspaceStore } from '../workspace/workspaceStore';

function pathOf(uri: unknown): string {
  return (uri as StoryUri).fsPath;
}

// The bot's write policy expressed as a file system: a draft goes through ContentService so the
// archive-then-write path and the outcome reporting stay the bot's only way to touch `draft/`,
// while gitignored side artefacts (`.storyboard/cache/`, `.draft/`) go straight to disk. Nothing
// here writes a tracked file — that is `BotSceneRepository`'s job, and it still rides the gate.
export class BotFileSystem implements IFileSystem {
  private lastDraftOutcome: MutateOutcome | undefined;

  public constructor(private readonly content: ContentService) {}

  public async readFile(uri: unknown): Promise<Uint8Array> {
    return await nodeFs.readFile(pathOf(uri));
  }

  public async writeFile(uri: unknown, content: Uint8Array): Promise<void> {
    const target = pathOf(uri);
    const draftStem = draftStemOf(target);

    if (draftStem !== undefined) {
      this.lastDraftOutcome = await this.content.writeDraft(
        draftStem,
        new TextDecoder().decode(content),
      );
      return;
    }

    const temporary = `${target}.tmp-${Date.now().toString(36)}`;

    try {
      await nodeFs.mkdir(target.slice(0, target.lastIndexOf('/')), { recursive: true });
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

  public async createDirectory(uri: unknown): Promise<void> {
    await nodeFs.mkdir(pathOf(uri), { recursive: true });
  }

  public async exists(uri: unknown): Promise<boolean> {
    try {
      await nodeFs.stat(pathOf(uri));
      return true;
    } catch {
      return false;
    }
  }

  public async listFileNames(uri: unknown): Promise<readonly string[]> {
    const entries = await nodeFs.readdir(pathOf(uri), { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  }

  public async readDirectory(uri: unknown): Promise<FileSystemDirectoryEntry[]> {
    const entries = await nodeFs.readdir(pathOf(uri), { withFileTypes: true });
    return entries.map((entry) => [
      entry.name,
      { type: entry.isDirectory() ? ('directory' as const) : ('file' as const) },
    ]);
  }

  public async delete(uri: unknown): Promise<void> {
    await nodeFs.rm(pathOf(uri), { recursive: true, force: true });
  }

  public async modifiedTime(uri: unknown): Promise<number> {
    try {
      return (await nodeFs.stat(pathOf(uri))).mtimeMs;
    } catch {
      return 0;
    }
  }
}

export class BotWorkspaceLocator implements WorkspaceLocator {
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

  public async read(_uri: unknown, fileName: string): Promise<SceneFile> {
    const stem = fileName.replace(/\.card$/, '');
    const scene = await this.store.readScene(stem);
    this.baselineByPath.set(stem, {
      path: scene.relativePath,
      hash: scene.contentHash,
      raw: await this.store.readText(scene.relativePath),
    });
    return scene.value;
  }

  public async writeGrounding(uri: unknown, grounding: SceneGrounding): Promise<void> {
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

  public async read(uri: unknown): Promise<SceneCacheRecord> {
    return parseSceneCache(new TextDecoder().decode(await this.fileSystem.readFile(uri)));
  }

  public async write(uri: unknown, record: SceneCacheRecord): Promise<void> {
    await this.fileSystem.writeFile(uri, new TextEncoder().encode(serializeSceneCache(record)));
  }

  public async ensureDirectory(uri: unknown): Promise<void> {
    await this.fileSystem.createDirectory(uri);
  }
}

function isSettled(outcome: MutateOutcome): boolean {
  return outcome.status === 'committed' || outcome.status === 'written';
}

// `draft/<stem>.md` and nothing else. A path that merely contains the word must not be captured.
function draftStemOf(target: string): string | undefined {
  const fileName = target.split('/').pop();

  if (fileName === undefined || !fileName.endsWith('.md')) {
    return undefined;
  }

  const stem = fileName.slice(0, -'.md'.length);
  return target.endsWith(`/${draftRelativePath(stem)}`) ? stem : undefined;
}
