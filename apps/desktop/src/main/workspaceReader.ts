import {
  backgroundCardPath,
  characterCardPath,
  draftPath,
  getStoryboardProjectPaths,
  readRevisionPlanFile,
  scenePath,
  validateGenerationContract,
  type StoryboardProjectPaths,
  isHiddenSceneFileName,
  joinCardText,
  parseCard,
  parseDraft,
  parseSceneFileName,
  readChapterPlanFile,
  readSceneFile,
  readStoryState,
  resolveCraftContract,
  resolveScenePrefixDigitCount,
  resolveSceneTargetLength,
  sceneBeatTexts,
  type ChapterPlan,
  type SceneFile,
  type StoryboardProject,
  type Draft,
  type GenerationContractReadiness,
  type StoryboardCard,
  type StoryState,
  type NarrationDirective,
  type RevisionPlan,
  type RevisionPlanEntry,
  extractErrorMessage,
} from '@storyboard/story-model';
import {
  groupChapterStems,
  type IFileSystem,
  type SceneThreadContext,
} from '@storyboard/story-engine';

import type {
  DraftDocument,
  NarrationSummary,
  NoteCard,
  SceneNotes,
  SceneStatus,
  StoryFactNote,
  TocChapter,
  TocScene,
  WorkspaceOverview,
} from '@/shared/dto';

import type { DesktopContainer } from '@/main/desktopContainer';

const shownFactCount: number = 6;

interface SceneNarrationNotes {
  readonly narration: NarrationSummary | undefined;
  readonly thread: SceneThreadContext;
}

interface DraftState {
  readonly exists: boolean;
  readonly body: string;
  readonly warnings: readonly string[];
}

async function readDraftState(
  fileSystem: IFileSystem,
  uri: ReturnType<typeof draftPath>,
): Promise<DraftState> {
  if (!(await fileSystem.exists(uri))) {
    return { exists: false, body: '', warnings: [] };
  }

  const draft: Draft = parseDraft(new TextDecoder().decode(await fileSystem.readFile(uri)));
  return { exists: true, body: draft.body, warnings: draft.warnings ?? [] };
}

async function readChapterPlanIfAny(
  paths: StoryboardProjectPaths,
  fileSystem: IFileSystem,
): Promise<ChapterPlan | undefined> {
  if (!(await fileSystem.exists(paths.outlineChapters))) {
    return undefined;
  }

  return await readChapterPlanFile(paths.outlineChapters, fileSystem);
}

async function listSceneFiles(
  paths: StoryboardProjectPaths,
  fileSystem: IFileSystem,
): Promise<string[]> {
  if (!(await fileSystem.exists(paths.sceneDirectory))) {
    return [];
  }

  return (await fileSystem.listFileNames(paths.sceneDirectory))
    .filter((name) => !isHiddenSceneFileName(name) && parseSceneFileName(name) !== undefined)
    .sort(
      (left, right) =>
        (parseSceneFileName(left)?.order ?? 0) - (parseSceneFileName(right)?.order ?? 0),
    );
}

function sceneTargetLength(scene: SceneFile, project: StoryboardProject): number | undefined {
  return resolveSceneTargetLength(
    scene.frontmatter.targetWordCount,
    scene.body,
    resolveCraftContract(project.setting?.craftContract).sceneLengthMultiplier,
  );
}

function statusOf(draft: DraftState, isGenerating: boolean): SceneStatus {
  if (isGenerating) {
    return 'generating';
  }

  if (!draft.exists) {
    return 'seed';
  }

  return draft.warnings.length > 0 ? 'warning' : 'drafted';
}

function joinScenePath(
  paths: StoryboardProjectPaths,
  fileName: string,
): ReturnType<typeof scenePath> {
  return scenePath(paths.workspaceRoot, fileName.replace(/\.card$/, ''));
}

async function readNoteCard(
  fileSystem: IFileSystem,
  uri: ReturnType<typeof characterCardPath>,
  fallbackId: string,
): Promise<NoteCard> {
  try {
    const card: StoryboardCard = parseCard(
      new TextDecoder().decode(await fileSystem.readFile(uri)),
    );
    const summary: string | undefined = joinCardText(card.description).split('\n')[0]?.trim();
    return { id: card.id, name: card.name, ...(summary ? { summary } : {}) };
  } catch {
    return { id: fallbackId, name: fallbackId };
  }
}

async function readReviewNote(
  fileSystem: IFileSystem,
  paths: StoryboardProjectPaths,
  stem: string,
): Promise<SceneNotes['review']> {
  if (!(await fileSystem.exists(paths.outlineRevisionPlan))) {
    return undefined;
  }

  const plan: RevisionPlan = await readRevisionPlanFile(paths.outlineRevisionPlan, fileSystem);
  const entry: RevisionPlanEntry | undefined = plan.entries.find(
    (candidate) => candidate.sceneStem === stem,
  );

  return entry === undefined
    ? undefined
    : {
        revisionCount: entry.revisionCount,
        remainingBlocking: entry.remainingBlocking,
        instructions: entry.instructions,
      };
}

export class WorkspaceReader {
  public constructor(private readonly container: DesktopContainer) {}

  public async readOverview(
    generatingStem: string | undefined,
    foreignLockMessage: string | undefined,
  ): Promise<WorkspaceOverview> {
    const { fileSystem, workspaceRoot } = this.container;
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    const project: StoryboardProject = await this.container.project.read(workspaceRoot);
    const sceneFileNames: string[] = await listSceneFiles(paths, fileSystem);

    const scenesByStem: Map<string, TocScene> = new Map<string, TocScene>();
    for (const fileName of sceneFileNames) {
      const scene: SceneFile = await readSceneFile(
        joinScenePath(paths, fileName),
        fileSystem,
        fileName,
      );
      const draft: DraftState = await readDraftState(
        fileSystem,
        draftPath(workspaceRoot, scene.stem),
      );
      const targetLength: number | undefined = sceneTargetLength(scene, project);

      scenesByStem.set(scene.stem, {
        stem: scene.stem,
        order: scene.order,
        title: scene.card.title ?? scene.slug,
        status: statusOf(draft, scene.stem === generatingStem),
        length: draft.body.trim().length,
        ...(targetLength === undefined ? {} : { targetLength }),
      });
    }

    const chapters: TocChapter[] = this.groupScenesIntoChapters(
      await readChapterPlanIfAny(paths, fileSystem),
      project,
      scenesByStem,
    );
    const readiness: GenerationContractReadiness = validateGenerationContract(project.setting);

    return {
      path: workspaceRoot.fsPath,
      title: project.name,
      ...(project.setting?.genre === undefined ? {} : { genre: project.setting.genre }),
      ...(project.setting?.pov === undefined ? {} : { pov: project.setting.pov }),
      ...(project.setting?.composition === undefined
        ? {}
        : { composition: project.setting.composition }),
      ...(project.setting?.targetWordCount === undefined
        ? {}
        : { targetWordCount: project.setting.targetWordCount }),
      chapters,
      totalLength: [...scenesByStem.values()].reduce((sum, scene) => sum + scene.length, 0),
      missingContractFields: readiness.missing,
      ...(foreignLockMessage === undefined ? {} : { foreignLock: { message: foreignLockMessage } }),
    };
  }

  public async readDraftDocument(stem: string): Promise<DraftDocument> {
    const draft: DraftState = await readDraftState(
      this.container.fileSystem,
      draftPath(this.container.workspaceRoot, stem),
    );
    return { stem, ...draft };
  }

  public async readSceneNotes(stem: string): Promise<SceneNotes> {
    const { fileSystem, workspaceRoot } = this.container;
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    const project: StoryboardProject = await this.container.project.read(workspaceRoot);
    const scene: SceneFile = await readSceneFile(
      scenePath(workspaceRoot, stem),
      fileSystem,
      `${stem}.card`,
    );
    const warnings: string[] = [];

    const { narration, thread }: SceneNarrationNotes = await this.resolveSceneNarration(
      scene,
      warnings,
    );
    const draft: DraftState = await readDraftState(fileSystem, draftPath(workspaceRoot, stem));
    const characters: NoteCard[] = await this.readCastCards(scene);
    const background: NoteCard | undefined = await this.readBackgroundCard(scene);
    const facts: StoryFactNote[] = await this.readEarlierFacts(thread, scene);
    const review: SceneNotes['review'] = await readReviewNote(fileSystem, paths, stem);
    const chapterTitle: string | undefined = await this.readChapterTitle(paths, project, stem);
    const targetLength: number | undefined = sceneTargetLength(scene, project);
    const summary: string | undefined = scene.summaryText?.trim() || undefined;

    return {
      stem,
      title: scene.card.title ?? scene.slug,
      ...(chapterTitle === undefined ? {} : { chapterTitle }),
      ...(narration === undefined ? {} : { narration }),
      thread: thread.threadId,
      ...(summary === undefined ? {} : { summary }),
      beats: sceneBeatTexts(scene.card.beats),
      ...(scene.card.mood === undefined ? {} : { mood: scene.card.mood }),
      characters,
      ...(background === undefined ? {} : { background }),
      facts,
      ...(review === undefined ? {} : { review }),
      warnings: [...warnings, ...draft.warnings],
      length: draft.body.trim().length,
      ...(targetLength === undefined ? {} : { targetLength }),
    };
  }

  private async resolveSceneNarration(
    scene: SceneFile,
    warnings: string[],
  ): Promise<SceneNarrationNotes> {
    const narration: NarrationSummary | undefined = await this.summarizeNarration(scene, warnings);
    const thread: SceneThreadContext = await this.container.drafts.resolveSceneThread(
      this.container.workspaceRoot,
      scene,
    );

    return { narration, thread };
  }

  private async readCastCards(scene: SceneFile): Promise<NoteCard[]> {
    const { fileSystem, workspaceRoot } = this.container;

    return await Promise.all(
      (scene.card.characters ?? []).map((id) =>
        readNoteCard(fileSystem, characterCardPath(workspaceRoot, id), id),
      ),
    );
  }

  private async readBackgroundCard(scene: SceneFile): Promise<NoteCard | undefined> {
    const { fileSystem, workspaceRoot } = this.container;

    return scene.card.location === undefined
      ? undefined
      : await readNoteCard(
          fileSystem,
          backgroundCardPath(workspaceRoot, scene.card.location),
          scene.card.location,
        );
  }

  private async readEarlierFacts(
    thread: SceneThreadContext,
    scene: SceneFile,
  ): Promise<StoryFactNote[]> {
    const storyState: StoryState = await readStoryState(
      thread.threadPaths.storyState,
      this.container.fileSystem,
    );

    return storyState.entries
      .filter((entry) => entry.section === 'facts' && !entry.isStale)
      .filter((entry) => entry.throughScene === undefined || entry.throughScene < scene.order)
      .slice(-shownFactCount)
      .map((entry) => ({
        text: entry.text,
        ...(entry.throughScene === undefined ? {} : { throughScene: entry.throughScene }),
        witnesses: entry.witnesses ?? [],
      }));
  }

  private async readChapterTitle(
    paths: StoryboardProjectPaths,
    project: StoryboardProject,
    stem: string,
  ): Promise<string | undefined> {
    const plan: ChapterPlan | undefined = await readChapterPlanIfAny(
      paths,
      this.container.fileSystem,
    );

    return plan === undefined ? undefined : this.findChapterTitle(plan, project, stem);
  }

  private groupScenesIntoChapters(
    plan: ChapterPlan | undefined,
    project: StoryboardProject,
    scenesByStem: ReadonlyMap<string, TocScene>,
  ): TocChapter[] {
    if (plan === undefined) {
      return scenesByStem.size === 0 ? [] : [{ title: '', scenes: [...scenesByStem.values()] }];
    }

    const digitCount: number = resolveScenePrefixDigitCount(
      project.editor.scenePrefixDigits,
      this.container.configBridge.inspectScenePrefixDigits(),
    );
    const placed: Set<string> = new Set<string>();
    const chapters: TocChapter[] = groupChapterStems(plan, digitCount).map((group) => ({
      title: group.title,
      scenes: group.stems.flatMap((stem) => {
        const scene: TocScene | undefined = scenesByStem.get(stem);
        if (scene === undefined) {
          return [];
        }
        placed.add(stem);
        return [scene];
      }),
    }));
    const unplaced: TocScene[] = [...scenesByStem.values()].filter(
      (scene) => !placed.has(scene.stem),
    );

    return unplaced.length === 0 ? chapters : [...chapters, { title: '', scenes: unplaced }];
  }

  private async summarizeNarration(
    scene: SceneFile,
    warnings: string[],
  ): Promise<NarrationSummary | undefined> {
    const { drafts, cards, workspaceRoot } = this.container;

    try {
      const directive: NarrationDirective | undefined = await drafts.resolveSceneNarration(
        workspaceRoot,
        scene,
      );

      if (directive === undefined) {
        return undefined;
      }

      const narratorName: string | undefined =
        directive.narratorId === undefined
          ? undefined
          : (await cards.listNarrators(workspaceRoot)).get(directive.narratorId)?.name;

      return {
        ...(directive.person === undefined ? {} : { person: directive.person }),
        ...(directive.knowledge === undefined ? {} : { knowledge: directive.knowledge }),
        ...(directive.tense === undefined ? {} : { tense: directive.tense }),
        ...(directive.focal === undefined ? {} : { focal: directive.focal }),
        ...(narratorName === undefined ? {} : { narratorName }),
      };
    } catch (error) {
      warnings.push(extractErrorMessage(error));
      return undefined;
    }
  }

  private findChapterTitle(
    plan: ChapterPlan,
    project: StoryboardProject,
    stem: string,
  ): string | undefined {
    const digitCount: number = resolveScenePrefixDigitCount(
      project.editor.scenePrefixDigits,
      this.container.configBridge.inspectScenePrefixDigits(),
    );

    return groupChapterStems(plan, digitCount).find((group) => group.stems.includes(stem))?.title;
  }
}
