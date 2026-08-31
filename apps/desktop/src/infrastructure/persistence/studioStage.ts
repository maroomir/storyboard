import * as vscode from 'vscode';

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

import { nextDraftHistoryRevision } from '../../domain/files/draftHistory';
import { readRevisionPlanFile } from '../../domain/files/revisionPlan';
import type {
  StudioCardStage,
  StudioSceneStage,
  StudioStage,
  StudioStageCard,
  StudioTarget,
} from '../../shared/messaging';
import {
  backgroundCardPath,
  characterCardPath,
  draftHistorySceneDirectory,
  draftPath,
  getStoryboardProjectPaths,
  scenePath,
  type StoryboardProjectPaths,
} from '../vscode/pathConventions';
import {
  draftHistoryFileSystem,
  sceneContextFileSystem,
  sceneContextPaths,
  vscodeFsAdapter,
} from '../vscode/workspaceFsAdapters';

type DraftFacts = Pick<StudioSceneStage, 'draftLength' | 'draftUpdatedAt' | 'draftRevision'>;

export async function readStudioStage(
  workspaceRoot: vscode.Uri,
  target: StudioTarget,
): Promise<StudioStage | undefined> {
  const entity = target.entity;

  if (entity?.kind === 'character' || entity?.kind === 'background') {
    return readCardStage(workspaceRoot, entity.kind, entity.key);
  }

  const sceneStem = entity?.kind === 'scene' ? entity.key : resolveSceneStem(target);

  return sceneStem ? readSceneStage(workspaceRoot, sceneStem) : undefined;
}

async function readSceneStage(
  workspaceRoot: vscode.Uri,
  sceneStem: string,
): Promise<StudioSceneStage> {
  const paths = getStoryboardProjectPaths(workspaceRoot);
  const scene = await readSceneOrUndefined(workspaceRoot, sceneStem);

  const [cards, draft, review] = await Promise.all([
    scene ? readStageCards(paths, scene) : Promise.resolve([]),
    readDraftFacts(workspaceRoot, sceneStem),
    readReviewState(paths.outlineRevisionPlan, sceneStem),
  ]);

  return { kind: 'scene', sceneStem, title: scene?.frontmatter.title, cards, review, ...draft };
}

async function readCardStage(
  workspaceRoot: vscode.Uri,
  cardKind: 'character' | 'background',
  cardId: string,
): Promise<StudioCardStage | undefined> {
  const paths = getStoryboardProjectPaths(workspaceRoot);
  const cardUri =
    cardKind === 'character'
      ? characterCardPath(workspaceRoot, cardId)
      : backgroundCardPath(workspaceRoot, cardId);

  const card = await readCardOrUndefined(cardUri);

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
    appearsInScenes: await findScenesFeaturingCard(workspaceRoot, paths.sceneDirectory, card),
  };
}

function toStageRelation(relation: {
  readonly target: string;
  readonly type: string;
}): StudioCardStage['relations'][number] {
  return { target: relation.target, type: relation.type };
}

async function readCardOrUndefined(uri: vscode.Uri): Promise<StoryboardCard | undefined> {
  try {
    return await readCardFile(uri, vscodeFsAdapter);
  } catch {
    return undefined;
  }
}

async function findScenesFeaturingCard(
  workspaceRoot: vscode.Uri,
  sceneDirectory: vscode.Uri,
  card: StoryboardCard,
): Promise<string[]> {
  let entries: [string, vscode.FileType][];

  try {
    entries = await vscode.workspace.fs.readDirectory(sceneDirectory);
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
      const scene = await readSceneOrUndefined(workspaceRoot, stem);
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
  workspaceRoot: vscode.Uri,
  sceneStem: string,
): Promise<SceneFile | undefined> {
  try {
    return await readSceneFile(
      scenePath(workspaceRoot, sceneStem),
      vscodeFsAdapter,
      `${sceneStem}.card`,
    );
  } catch {
    return undefined;
  }
}

async function readStageCards(
  paths: StoryboardProjectPaths,
  scene: SceneFile,
): Promise<StudioStageCard[]> {
  try {
    const context = await buildSceneContext(
      sceneContextPaths(paths),
      scene,
      sceneContextFileSystem,
    );
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

async function readDraftFacts(workspaceRoot: vscode.Uri, sceneStem: string): Promise<DraftFacts> {
  const uri = draftPath(workspaceRoot, sceneStem);

  try {
    const [stat, bytes] = await Promise.all([
      vscode.workspace.fs.stat(uri),
      vscode.workspace.fs.readFile(uri),
    ]);

    return {
      draftLength: draftBodyLength(new TextDecoder().decode(bytes)),
      draftUpdatedAt: new Date(stat.mtime).toISOString(),
      draftRevision: await readDraftRevision(workspaceRoot, sceneStem),
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
  workspaceRoot: vscode.Uri,
  sceneStem: string,
): Promise<number | undefined> {
  try {
    const fileNames = await draftHistoryFileSystem.listFileNames(
      draftHistorySceneDirectory(workspaceRoot, sceneStem),
    );

    // NOTE: Archives hold the *previous* drafts, so the live draft is one past the highest
    // archived revision. With no archive the draft is unversioned, not v1.
    const currentRevision = nextDraftHistoryRevision(fileNames);

    return currentRevision > 1 ? currentRevision : undefined;
  } catch {
    return undefined;
  }
}

async function readReviewState(
  revisionPlanUri: vscode.Uri,
  sceneStem: string,
): Promise<StudioSceneStage['review']> {
  try {
    const plan = await readRevisionPlanFile(revisionPlanUri, vscodeFsAdapter);
    const entry = plan.entries.find((candidate) => candidate.sceneStem === sceneStem);

    if (!entry) {
      return 'unreviewed';
    }

    return entry.remainingBlocking === 0 ? 'clean' : 'issues';
  } catch {
    return 'unreviewed';
  }
}
