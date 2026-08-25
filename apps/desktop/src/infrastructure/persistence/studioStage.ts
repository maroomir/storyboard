import * as vscode from 'vscode';

import {
  buildSceneContext,
  parseDraft,
  parseSceneFileName,
  readSceneFile,
  type SceneFile,
} from '@storyboard/story-format';

import { nextDraftHistoryRevision } from '../../domain/files/draftHistory';
import { readRevisionPlanFile } from '../../domain/files/revisionPlan';
import type { StudioStage, StudioStageCard, StudioTarget } from '../../shared/messaging';
import {
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

type DraftFacts = Pick<StudioStage, 'draftLength' | 'draftUpdatedAt' | 'draftRevision'>;

export async function readStudioStage(
  workspaceRoot: vscode.Uri,
  target: StudioTarget,
): Promise<StudioStage | undefined> {
  const sceneStem = resolveSceneStem(target);

  if (!sceneStem) {
    return undefined;
  }

  const paths = getStoryboardProjectPaths(workspaceRoot);
  const scene = await readSceneOrUndefined(workspaceRoot, sceneStem);

  const [cards, draft, review] = await Promise.all([
    scene ? readStageCards(paths, scene) : Promise.resolve([]),
    readDraftFacts(workspaceRoot, sceneStem),
    readReviewState(paths.outlineRevisionPlan, sceneStem),
  ]);

  return { sceneStem, title: scene?.frontmatter.title, cards, review, ...draft };
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
): Promise<StudioStage['review']> {
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
