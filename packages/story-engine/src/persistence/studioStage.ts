import type {
BibleSubjectKind,
RevisionPlan,
RevisionPlanEntry,
SceneContext,
  StoryUri,
  StudioCardStage,
  StudioEntity,
  StudioSceneStage,
  StudioStage,
  StudioStageCard,
  StudioTarget,
} from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import { listDirectoryFileNames } from '#engine/persistence/directoryFiles';
import { buildSceneContext, characterMatchTokens, detectCharactersInText, isIgnoredSampleCardFileName, parseDraft, parseSceneFileName, type SceneFile, type StoryboardCard, nextDraftHistoryRevision, sceneContextPaths, readRevisionPlanFile, backgroundCardPath, characterCardPath, draftHistorySceneDirectory, draftPath, getStoryboardProjectPaths, type StoryboardProjectPaths } from '@storyboard/story-model';
import { readCardOrUndefined, readSceneOrUndefined } from '#engine/persistence/optionalStoryFiles';

type DraftFacts = Pick<StudioSceneStage, 'draftLength' | 'draftUpdatedAt' | 'draftRevision'>;

export async function readStudioStage(
  fs: IFileSystem,
  workspaceRoot: StoryUri,
  target: StudioTarget,
): Promise<StudioStage | undefined> {
  const entity: StudioEntity | undefined = target.entity;

  if (entity?.kind === 'character' || entity?.kind === 'background') {
    return readCardStage(fs, workspaceRoot, entity.kind, entity.key);
  }

  const sceneStem: string | undefined = entity?.kind === 'scene' ? entity.key : resolveSceneStem(target);

  return sceneStem ? readSceneStage(fs, workspaceRoot, sceneStem) : undefined;
}

async function readSceneStage(
  fs: IFileSystem,
  workspaceRoot: StoryUri,
  sceneStem: string,
): Promise<StudioSceneStage> {
  const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
  const scene: SceneFile | undefined = await readSceneOrUndefined(fs, workspaceRoot, sceneStem);

  const [cards, draft, review] = await Promise.all([
    scene ? readStageCards(fs, paths, scene) : Promise.resolve([]),
    readDraftFacts(fs, workspaceRoot, sceneStem),
    readReviewState(fs, paths.outlineRevisionPlan, sceneStem),
  ]);

  return { kind: 'scene', sceneStem, title: scene?.frontmatter.title, cards, review, ...draft };
}

async function readCardStage(
  fs: IFileSystem,
  workspaceRoot: StoryUri,
  cardKind: BibleSubjectKind,
  cardId: string,
): Promise<StudioCardStage | undefined> {
  const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
  const cardUri: StoryUri =
    cardKind === 'character'
      ? characterCardPath(workspaceRoot, cardId)
      : backgroundCardPath(workspaceRoot, cardId);

  const card: StoryboardCard | undefined = await readCardOrUndefined(fs, cardUri);

  if (!card) {
    return undefined;
  }

  return {
    kind: 'card',
    cardKind,
    cardId,
    name: card.name,
    ...(card.type === 'character' && card.role ? { role: card.role } : {}),
    relations: card.type === 'character' ? (card.relations ?? []).map(toStageRelation) : [],
    appearsInScenes: await findScenesFeaturingCard(fs, workspaceRoot, paths.sceneDirectory, card),
  };
}

function toStageRelation(relation: {
  readonly target: string;
  readonly type: string;
}): StudioCardStage['relations'][number] {
  return { target: relation.target, type: relation.type };
}

async function findScenesFeaturingCard(
  fs: IFileSystem,
  workspaceRoot: StoryUri,
  sceneDirectory: StoryUri,
  card: StoryboardCard,
): Promise<string[]> {
  const names: readonly string[] = await listDirectoryFileNames(
    fs,
    sceneDirectory,
    (name) => !isIgnoredSampleCardFileName(name),
  );
  const stems: string[] = names
    .map((name) => parseSceneFileName(name)?.stem)
    .filter((stem): stem is string => stem !== undefined)
    .sort();

  const matches: (string | undefined)[] = await Promise.all(
    stems.map(async (stem) => {
      const scene: SceneFile | undefined = await readSceneOrUndefined(fs, workspaceRoot, stem);
      return scene && sceneFeaturesCard(scene, card) ? stem : undefined;
    }),
  );

  return matches.filter((stem): stem is string => stem !== undefined);
}

function sceneFeaturesCard(scene: SceneFile, card: StoryboardCard): boolean {
  if (card.type === 'character') {
    if (scene.frontmatter.characters?.includes(card.id)) {
      return true;
    }

    return detectCharactersInText(scene.body, characterMatchTokens(card)).length > 0;
  }

  if (scene.frontmatter.location === card.id) {
    return true;
  }

  return detectCharactersInText(scene.body, [card.name, ...(card.aliases ?? [])]).length > 0;
}

function resolveSceneStem(target: StudioTarget): string | undefined {
  if (!target.sceneUri) {
    return undefined;
  }

  const fileName: string = target.sceneUri.split('/').pop() ?? '';
  return parseSceneFileName(fileName)?.stem;
}

async function readStageCards(
  fs: IFileSystem,
  paths: StoryboardProjectPaths,
  scene: SceneFile,
): Promise<StudioStageCard[]> {
  try {
    const context: SceneContext = await buildSceneContext(sceneContextPaths(paths), scene, fs);
    const characters: StudioStageCard[] = context.characters.map(
      (character): StudioStageCard => ({ kind: 'character', name: character.name }),
    );

    return context.background
      ? [...characters, { kind: 'background', name: context.background.name }]
      : characters;
  } catch {
    return [];
  }
}

async function readDraftFacts(
  fs: IFileSystem,
  workspaceRoot: StoryUri,
  sceneStem: string,
): Promise<DraftFacts> {
  const uri: StoryUri = draftPath(workspaceRoot, sceneStem);

  try {
    const [modifiedAt, bytes] = await Promise.all([fs.modifiedTime(uri), fs.readFile(uri)]);

    return {
      draftLength: draftBodyLength(new TextDecoder().decode(bytes)),
      draftUpdatedAt: new Date(modifiedAt).toISOString(),
      draftRevision: await readDraftRevision(fs, workspaceRoot, sceneStem),
    };
  } catch {
    return {};
  }
}

function draftBodyLength(rawDraft: string): number {
  try {
    return parseDraft(rawDraft).body.trim().length;
  } catch {
    return rawDraft.trim().length;
  }
}

async function readDraftRevision(
  fs: IFileSystem,
  workspaceRoot: StoryUri,
  sceneStem: string,
): Promise<number | undefined> {
  try {
    const fileNames: readonly string[] = await fs.listFileNames(draftHistorySceneDirectory(workspaceRoot, sceneStem));

    const currentRevision: number = nextDraftHistoryRevision(fileNames);

    return currentRevision > 1 ? currentRevision : undefined;
  } catch {
    return undefined;
  }
}

async function readReviewState(
  fs: IFileSystem,
  revisionPlanUri: StoryUri,
  sceneStem: string,
): Promise<StudioSceneStage['review']> {
  try {
    const plan: RevisionPlan = await readRevisionPlanFile(revisionPlanUri, fs);
    const entry: RevisionPlanEntry | undefined = plan.entries.find((candidate) => candidate.sceneStem === sceneStem);

    if (!entry) {
      return 'unreviewed';
    }

    return entry.remainingBlocking === 0 ? 'clean' : 'issues';
  } catch {
    return 'unreviewed';
  }
}
