import type { StoryUri } from '@storyboard/story-format';
import type { FileSystemDirectoryEntry, IFileSystem } from '../ports/fileSystem';
import {
  buildSceneContext,
  characterMatchTokens,
  detectCharactersInText,
  isIgnoredSampleCardFileName,
  parseDraft,
  parseSceneFileName,
  readCardFile,
  readSceneFile,
  type SceneFile,
  type StoryboardCard,
} from '@storyboard/story-format';

import { nextDraftHistoryRevision } from '../domain/files/draftHistory';
import { sceneContextPaths } from '../paths/sceneContextPaths';
import { readRevisionPlanFile } from '../domain/files/revisionPlan';
import type {
  StudioCardStage,
  StudioSceneStage,
  StudioStage,
  StudioStageCard,
  StudioTarget,
} from '../shared/messaging/studio';
import {
  backgroundCardPath,
  characterCardPath,
  draftHistorySceneDirectory,
  draftPath,
  getStoryboardProjectPaths,
  scenePath,
  type StoryboardProjectPaths,
} from '../paths/projectPaths';

type DraftFacts = Pick<StudioSceneStage, 'draftLength' | 'draftUpdatedAt' | 'draftRevision'>;

export async function readStudioStage(
  fs: IFileSystem,
  workspaceRoot: StoryUri,
  target: StudioTarget,
): Promise<StudioStage | undefined> {
  const entity = target.entity;

  if (entity?.kind === 'character' || entity?.kind === 'background') {
    return readCardStage(fs, workspaceRoot, entity.kind, entity.key);
  }

  const sceneStem = entity?.kind === 'scene' ? entity.key : resolveSceneStem(target);

  return sceneStem ? readSceneStage(fs, workspaceRoot, sceneStem) : undefined;
}

async function readSceneStage(
  fs: IFileSystem,
  workspaceRoot: StoryUri,
  sceneStem: string,
): Promise<StudioSceneStage> {
  const paths = getStoryboardProjectPaths(workspaceRoot);
  const scene = await readSceneOrUndefined(fs, workspaceRoot, sceneStem);

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
  cardKind: 'character' | 'background',
  cardId: string,
): Promise<StudioCardStage | undefined> {
  const paths = getStoryboardProjectPaths(workspaceRoot);
  const cardUri =
    cardKind === 'character'
      ? characterCardPath(workspaceRoot, cardId)
      : backgroundCardPath(workspaceRoot, cardId);

  const card = await readCardOrUndefined(fs, cardUri);

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

async function readCardOrUndefined(
  fs: IFileSystem,
  uri: StoryUri,
): Promise<StoryboardCard | undefined> {
  try {
    return await readCardFile(uri, fs);
  } catch {
    return undefined;
  }
}

async function findScenesFeaturingCard(
  fs: IFileSystem,
  workspaceRoot: StoryUri,
  sceneDirectory: StoryUri,
  card: StoryboardCard,
): Promise<string[]> {
  let entries: FileSystemDirectoryEntry[];

  try {
    entries = await fs.readDirectory(sceneDirectory);
  } catch {
    return [];
  }

  const stems = entries
    .filter(([name]) => !isIgnoredSampleCardFileName(name))
    .map(([name]) => parseSceneFileName(name)?.stem)
    .filter((stem): stem is string => stem !== undefined)
    .sort();

  const matches = await Promise.all(
    stems.map(async (stem) => {
      const scene = await readSceneOrUndefined(fs, workspaceRoot, stem);
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

  const fileName = target.sceneUri.split('/').pop() ?? '';
  return parseSceneFileName(fileName)?.stem;
}

async function readSceneOrUndefined(
  fs: IFileSystem,
  workspaceRoot: StoryUri,
  sceneStem: string,
): Promise<SceneFile | undefined> {
  try {
    return await readSceneFile(scenePath(workspaceRoot, sceneStem), fs, `${sceneStem}.card`);
  } catch {
    return undefined;
  }
}

async function readStageCards(
  fs: IFileSystem,
  paths: StoryboardProjectPaths,
  scene: SceneFile,
): Promise<StudioStageCard[]> {
  try {
    const context = await buildSceneContext(sceneContextPaths(paths), scene, fs);
    const characters = context.characters.map(
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
  const uri = draftPath(workspaceRoot, sceneStem);

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
    const fileNames = await fs.listFileNames(draftHistorySceneDirectory(workspaceRoot, sceneStem));

    // NOTE: Archives hold the *previous* drafts, so the live draft is one past the highest
    // archived revision. With no archive the draft is unversioned, not v1.
    const currentRevision = nextDraftHistoryRevision(fileNames);

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
    const plan = await readRevisionPlanFile(revisionPlanUri, fs);
    const entry = plan.entries.find((candidate) => candidate.sceneStem === sceneStem);

    if (!entry) {
      return 'unreviewed';
    }

    return entry.remainingBlocking === 0 ? 'clean' : 'issues';
  } catch {
    return 'unreviewed';
  }
}
