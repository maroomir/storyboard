import {
  backgroundCardPath,
  characterCardPath,
  draftPath,
  getStoryboardProjectPaths,
  groupChapterStems,
  loadNarratorCards,
  readChapterNarrationDefaults,
  readProjectJson,
  readRevisionPlanFile,
  resolveSceneNarration,
  resolveSceneThread,
  scenePath,
  validateGenerationContract,
  type IFileSystem,
  type StoryboardProjectPaths,
} from '@storyboard/story-engine';
import {
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
  type ChapterPlan,
  type SceneFile,
  type StoryboardProject,
} from '@storyboard/story-model';

import type {
  DraftDocument,
  NarrationSummary,
  NoteCard,
  SceneNotes,
  SceneStatus,
  TocChapter,
  TocScene,
  WorkspaceOverview,
} from '@/shared/dto';

import type { DesktopContainer } from './desktopContainer';

const shownFactCount = 6;

interface DraftState {
  readonly exists: boolean;
  readonly body: string;
  readonly warnings: readonly string[];
}

async function readDraftState(fileSystem: IFileSystem, uri: ReturnType<typeof draftPath>): Promise<DraftState> {
  if (!(await fileSystem.exists(uri))) {
    return { exists: false, body: '', warnings: [] };
  }

  const draft = parseDraft(new TextDecoder().decode(await fileSystem.readFile(uri)));
  return { exists: true, body: draft.body, warnings: draft.warnings ?? [] };
}

async function readChapterPlanIfAny(
  paths: StoryboardProjectPaths,
  fileSystem: IFileSystem,
): Promise<ChapterPlan | undefined> {
  // A workspace has no outline until the first run writes one; that is not an error.
  if (!(await fileSystem.exists(paths.outlineChapters))) {
    return undefined;
  }

  return await readChapterPlanFile(paths.outlineChapters, fileSystem);
}

async function listSceneFiles(paths: StoryboardProjectPaths, fileSystem: IFileSystem): Promise<string[]> {
  if (!(await fileSystem.exists(paths.sceneDirectory))) {
    return [];
  }

  return (await fileSystem.listFileNames(paths.sceneDirectory))
    .filter((name) => !isHiddenSceneFileName(name) && parseSceneFileName(name) !== undefined)
    .sort((left, right) => (parseSceneFileName(left)?.order ?? 0) - (parseSceneFileName(right)?.order ?? 0));
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

export async function readWorkspaceOverview(
  container: DesktopContainer,
  generatingStem: string | undefined,
  foreignLockMessage: string | undefined,
): Promise<WorkspaceOverview> {
  const { fileSystem, workspaceRoot } = container;
  const paths = getStoryboardProjectPaths(workspaceRoot);
  const project = await readProjectJson(fileSystem, paths.projectJson);
  const sceneFileNames = await listSceneFiles(paths, fileSystem);

  const scenesByStem = new Map<string, TocScene>();
  for (const fileName of sceneFileNames) {
    const scene = await readSceneFile(joinScenePath(paths, fileName), fileSystem, fileName);
    const draft = await readDraftState(fileSystem, draftPath(workspaceRoot, scene.stem));
    const targetLength = sceneTargetLength(scene, project);

    scenesByStem.set(scene.stem, {
      stem: scene.stem,
      order: scene.order,
      title: scene.card.title ?? scene.slug,
      status: statusOf(draft, scene.stem === generatingStem),
      length: draft.body.trim().length,
      ...(targetLength === undefined ? {} : { targetLength }),
    });
  }

  const chapters = groupScenesIntoChapters(
    await readChapterPlanIfAny(paths, fileSystem),
    project,
    container,
    scenesByStem,
  );
  const readiness = validateGenerationContract(project.setting);

  return {
    path: workspaceRoot.fsPath,
    title: project.name,
    ...(project.setting?.genre === undefined ? {} : { genre: project.setting.genre }),
    ...(project.setting?.pov === undefined ? {} : { pov: project.setting.pov }),
    ...(project.setting?.composition === undefined ? {} : { composition: project.setting.composition }),
    ...(project.setting?.targetWordCount === undefined
      ? {}
      : { targetWordCount: project.setting.targetWordCount }),
    chapters,
    totalLength: [...scenesByStem.values()].reduce((sum, scene) => sum + scene.length, 0),
    missingContractFields: readiness.missing,
    ...(foreignLockMessage === undefined ? {} : { foreignLock: { message: foreignLockMessage } }),
  };
}

// Scenes the outline places are grouped by its chapters; scenes it does not know (added by hand)
// follow in one untitled group, so nothing on disk is hidden from the table of contents.
function groupScenesIntoChapters(
  plan: ChapterPlan | undefined,
  project: StoryboardProject,
  container: DesktopContainer,
  scenesByStem: ReadonlyMap<string, TocScene>,
): TocChapter[] {
  if (plan === undefined) {
    return scenesByStem.size === 0 ? [] : [{ title: '', scenes: [...scenesByStem.values()] }];
  }

  const digitCount = resolveScenePrefixDigitCount(
    project.editor.scenePrefixDigits,
    container.configBridge.inspectScenePrefixDigits(),
  );
  const placed = new Set<string>();
  const chapters: TocChapter[] = groupChapterStems(plan, digitCount).map((group) => ({
    title: group.title,
    scenes: group.stems.flatMap((stem) => {
      const scene = scenesByStem.get(stem);
      if (scene === undefined) {
        return [];
      }
      placed.add(stem);
      return [scene];
    }),
  }));
  const unplaced = [...scenesByStem.values()].filter((scene) => !placed.has(scene.stem));

  return unplaced.length === 0 ? chapters : [...chapters, { title: '', scenes: unplaced }];
}

function joinScenePath(paths: StoryboardProjectPaths, fileName: string): ReturnType<typeof scenePath> {
  return scenePath(paths.workspaceRoot, fileName.replace(/\.card$/, ''));
}

export async function readDraftDocument(container: DesktopContainer, stem: string): Promise<DraftDocument> {
  const draft = await readDraftState(container.fileSystem, draftPath(container.workspaceRoot, stem));
  return { stem, ...draft };
}

async function readNoteCard(
  fileSystem: IFileSystem,
  uri: ReturnType<typeof characterCardPath>,
  fallbackId: string,
): Promise<NoteCard> {
  try {
    const card = parseCard(new TextDecoder().decode(await fileSystem.readFile(uri)));
    const summary = joinCardText(card.description).split('\n')[0]?.trim();
    return { id: card.id, name: card.name, ...(summary ? { summary } : {}) };
  } catch {
    // A scene may name someone who has no card yet; the margin still shows the name it used.
    return { id: fallbackId, name: fallbackId };
  }
}

export async function readSceneNotes(container: DesktopContainer, stem: string): Promise<SceneNotes> {
  const { fileSystem, workspaceRoot } = container;
  const paths = getStoryboardProjectPaths(workspaceRoot);
  const project = await readProjectJson(fileSystem, paths.projectJson);
  const scene = await readSceneFile(scenePath(workspaceRoot, stem), fileSystem, `${stem}.card`);
  const chapterDefaults = await readChapterNarrationDefaults(paths, scene.order, fileSystem);
  const warnings: string[] = [];

  const narration = await summarizeNarration(container, paths, scene, project, chapterDefaults, warnings);
  const thread = await resolveSceneThread(paths, scene, project, fileSystem, chapterDefaults.thread);
  const draft = await readDraftState(fileSystem, draftPath(workspaceRoot, stem));
  const characters = await Promise.all(
    (scene.card.characters ?? []).map((id) => readNoteCard(fileSystem, characterCardPath(workspaceRoot, id), id)),
  );
  const background =
    scene.card.location === undefined
      ? undefined
      : await readNoteCard(fileSystem, backgroundCardPath(workspaceRoot, scene.card.location), scene.card.location);
  const storyState = await readStoryState(thread.threadPaths.storyState, fileSystem);
  const facts = storyState.entries
    .filter((entry) => entry.section === 'facts' && !entry.isStale)
    .filter((entry) => entry.throughScene === undefined || entry.throughScene < scene.order)
    .slice(-shownFactCount)
    .map((entry) => ({
      text: entry.text,
      ...(entry.throughScene === undefined ? {} : { throughScene: entry.throughScene }),
      witnesses: entry.witnesses ?? [],
    }));
  const review = await readReviewNote(fileSystem, paths, stem);
  const plan = await readChapterPlanIfAny(paths, fileSystem);
  const chapterTitle = plan === undefined ? undefined : findChapterTitle(plan, project, container, stem);
  const targetLength = sceneTargetLength(scene, project);

  return {
    stem,
    title: scene.card.title ?? scene.slug,
    ...(chapterTitle === undefined ? {} : { chapterTitle }),
    ...(narration === undefined ? {} : { narration }),
    thread: thread.threadId,
    characters,
    ...(background === undefined ? {} : { background }),
    facts,
    ...(review === undefined ? {} : { review }),
    warnings: [...warnings, ...draft.warnings],
    length: draft.body.trim().length,
    ...(targetLength === undefined ? {} : { targetLength }),
  };
}

async function summarizeNarration(
  container: DesktopContainer,
  paths: StoryboardProjectPaths,
  scene: SceneFile,
  project: StoryboardProject,
  chapterDefaults: Awaited<ReturnType<typeof readChapterNarrationDefaults>>,
  warnings: string[],
): Promise<NarrationSummary | undefined> {
  try {
    const directive = await resolveSceneNarration(paths, scene, project, chapterDefaults, container.fileSystem);

    if (directive === undefined) {
      return undefined;
    }

    const narratorName =
      directive.narratorId === undefined
        ? undefined
        : (await loadNarratorCards(paths, container.fileSystem)).get(directive.narratorId)?.name;

    return {
      ...(directive.person === undefined ? {} : { person: directive.person }),
      ...(directive.knowledge === undefined ? {} : { knowledge: directive.knowledge }),
      ...(directive.tense === undefined ? {} : { tense: directive.tense }),
      ...(directive.focal === undefined ? {} : { focal: directive.focal }),
      ...(narratorName === undefined ? {} : { narratorName }),
    };
  } catch (error) {
    // An unknown narrator card stops generation with the same message, so the margin says it first.
    warnings.push(error instanceof Error ? error.message : String(error));
    return undefined;
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

  const plan = await readRevisionPlanFile(paths.outlineRevisionPlan, fileSystem);
  const entry = plan.entries.find((candidate) => candidate.sceneStem === stem);

  return entry === undefined
    ? undefined
    : {
        revisionCount: entry.revisionCount,
        remainingBlocking: entry.remainingBlocking,
        instructions: entry.instructions,
      };
}

function findChapterTitle(
  plan: ChapterPlan,
  project: StoryboardProject,
  container: DesktopContainer,
  stem: string,
): string | undefined {
  const digitCount = resolveScenePrefixDigitCount(
    project.editor.scenePrefixDigits,
    container.configBridge.inspectScenePrefixDigits(),
  );

  return groupChapterStems(plan, digitCount).find((group) => group.stems.includes(stem))?.title;
}
