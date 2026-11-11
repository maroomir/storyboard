import {
  draftPath,
  isSceneRenameHoldingPath,
  joinStoryPath,
  mainThreadId,
  parseDraft,
  planSceneRenames,
  serializeDraft,
  STORYBOARD_FILE_EXTENSIONS,
  type SceneBundleOnDisk,
  type SceneRenameStep,
  type StoryStructure,
  type StoryUri,
} from '@storyboard/story-model';

import type { IFileSystem } from '#engine/ports/fileSystem';
import { ChapterOutlineStore } from '#engine/persistence/bundles/chapterOutlineStore';
import type {
  SceneRoster,
  SceneRosterEntry,
  WorkspaceScenes,
} from '#engine/persistence/bundles/workspaceScenes';
import { JournalStore, type SceneRenameJournal } from '#engine/persistence/cache/journalStore';
import type { WorkspaceCaches } from '#engine/persistence/cache/workspaceCaches';

export interface SceneRenumbererDependencies {
  readonly fileSystem: IFileSystem;
  readonly caches: WorkspaceCaches;
  readonly scenes: WorkspaceScenes;
}

export interface SceneStemChange {
  readonly sceneId: string;
  readonly fromStem: string;
  readonly toStem: string;
}

function directoryNameOf(relativePath: string): string {
  return relativePath.split('/').at(-1) ?? relativePath;
}

function draftStemOf(relativePath: string): string {
  return directoryNameOf(relativePath).slice(0, -STORYBOARD_FILE_EXTENSIONS.draft.length);
}

function stemsById(roster: SceneRoster): ReadonlyMap<string, string> {
  return new Map(roster.entries.map((entry) => [entry.content.header.id, entry.file.stem]));
}

function listStemChanges(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): readonly SceneStemChange[] {
  return [...before].flatMap(([sceneId, fromStem]): SceneStemChange[] => {
    const toStem: string | undefined = after.get(sceneId);
    return toStem === undefined || toStem === fromStem ? [] : [{ sceneId, fromStem, toStem }];
  });
}

export class SceneRenumberer {
  public constructor(private readonly dependencies: SceneRenumbererDependencies) {}

  public async placeAfter(
    workspaceRoot: StoryUri,
    sceneId: string,
    afterSceneId: string | undefined,
  ): Promise<readonly SceneStemChange[]> {
    const { scenes } = this.dependencies;
    const structure: StoryStructure = await scenes.readStructure(workspaceRoot);
    const moving: StoryStructure['scenes'][number] | undefined = structure.scenes.find(
      (entry) => entry.scene === sceneId,
    );
    const others: StoryStructure['scenes'] = structure.scenes.filter(
      (entry) => entry.scene !== sceneId,
    );
    const insertAt: number =
      afterSceneId === undefined ? 0 : others.findIndex((entry) => entry.scene === afterSceneId) + 1;

    await scenes.writeStructure(workspaceRoot, {
      ...structure,
      scenes: [
        ...others.slice(0, insertAt),
        moving ?? { scene: sceneId, thread: mainThreadId },
        ...others.slice(insertAt),
      ],
    });
    await this.chapters().placeSceneAfter(workspaceRoot, sceneId, afterSceneId);

    return await this.renumber(workspaceRoot);
  }

  public async withdraw(workspaceRoot: StoryUri, sceneId: string): Promise<void> {
    const { scenes } = this.dependencies;
    const structure: StoryStructure = await scenes.readStructure(workspaceRoot);

    await scenes.writeStructure(workspaceRoot, {
      ...structure,
      scenes: structure.scenes.filter((entry) => entry.scene !== sceneId),
    });
    await this.chapters().removeScene(workspaceRoot, sceneId);
  }

  public async renumber(workspaceRoot: StoryUri): Promise<readonly SceneStemChange[]> {
    await this.resume(workspaceRoot);

    const roster: SceneRoster = await this.dependencies.scenes.loadRoster(workspaceRoot);
    const steps: readonly SceneRenameStep[] = planSceneRenames(
      roster.structure,
      await this.listBundlesOnDisk(workspaceRoot, roster),
    ).steps;
    if (steps.length === 0) {
      return [];
    }

    const journals: JournalStore = await this.journals(workspaceRoot);
    await this.applySteps(workspaceRoot, journals, journals.beginSceneRename(steps));

    return listStemChanges(
      stemsById(roster),
      stemsById(await this.dependencies.scenes.loadRoster(workspaceRoot)),
    );
  }

  public async findUnfinished(workspaceRoot: StoryUri): Promise<SceneRenameJournal | undefined> {
    return (await this.journals(workspaceRoot)).findUnfinishedSceneRename();
  }

  public async resume(workspaceRoot: StoryUri): Promise<boolean> {
    const journals: JournalStore = await this.journals(workspaceRoot);
    const journal: SceneRenameJournal | undefined = journals.findUnfinishedSceneRename();
    if (journal === undefined) {
      return false;
    }

    await this.applySteps(workspaceRoot, journals, journal);
    return true;
  }

  private async applySteps(
    workspaceRoot: StoryUri,
    journals: JournalStore,
    journal: SceneRenameJournal,
  ): Promise<void> {
    for (let index: number = journal.completedSteps; index < journal.steps.length; index += 1) {
      const step: SceneRenameStep | undefined = journal.steps[index];
      if (step !== undefined) {
        await this.applyStep(workspaceRoot, step);
      }
      journals.recordCompletedSteps(journal.id, index + 1);
    }

    journals.finish(journal.id);
  }

  private async applyStep(workspaceRoot: StoryUri, step: SceneRenameStep): Promise<void> {
    const fromUri: StoryUri = joinStoryPath(workspaceRoot, ...step.from.split('/'));
    const isAlreadyMoved: boolean = !(await this.dependencies.fileSystem.exists(fromUri));
    if (isAlreadyMoved) {
      return;
    }

    if (step.target === 'bundle') {
      await this.dependencies.scenes.relocateBundle(workspaceRoot, step.from, step.to);
      return;
    }

    await this.moveDraft(fromUri, joinStoryPath(workspaceRoot, ...step.to.split('/')), step.to);
  }

  private async moveDraft(fromUri: StoryUri, toUri: StoryUri, toRelativePath: string): Promise<void> {
    const { fileSystem } = this.dependencies;
    const raw: string = new TextDecoder().decode(await fileSystem.readFile(fromUri));
    const content: string = isSceneRenameHoldingPath(toRelativePath)
      ? raw
      : serializeDraft({ ...parseDraft(raw), sceneStem: draftStemOf(toRelativePath) });

    await fileSystem.writeFile(toUri, new TextEncoder().encode(content));
    await fileSystem.delete(fromUri);
  }

  private async listBundlesOnDisk(
    workspaceRoot: StoryUri,
    roster: SceneRoster,
  ): Promise<readonly SceneBundleOnDisk[]> {
    const bundles: SceneBundleOnDisk[] = [];
    for (const entry of roster.entries) {
      bundles.push(await this.bundleOnDisk(workspaceRoot, entry));
    }

    return bundles;
  }

  private async bundleOnDisk(
    workspaceRoot: StoryUri,
    entry: SceneRosterEntry,
  ): Promise<SceneBundleOnDisk> {
    return {
      sceneId: entry.content.header.id,
      slug: entry.content.header.slug,
      directoryName: directoryNameOf(entry.path),
      hasDraft: await this.dependencies.fileSystem.exists(draftPath(workspaceRoot, entry.file.stem)),
    };
  }

  private chapters(): ChapterOutlineStore {
    return new ChapterOutlineStore(this.dependencies);
  }

  private async journals(workspaceRoot: StoryUri): Promise<JournalStore> {
    return new JournalStore(await this.dependencies.caches.open(workspaceRoot));
  }
}
