import * as vscode from 'vscode';

import {
  extractDraftBody,
  parseSceneFileName,
  readCardFile,
  readSceneFile,
  serializeCard,
} from '@storyboard/story-format';
import type { StudioAgentLookupRequest } from '@storyboard/story-ai';

import type { StudioEntity } from '../../shared/messaging';
import {
  backgroundCardPath,
  characterCardPath,
  draftPath,
  getStoryboardProjectPaths,
  isIgnoredSampleCardFileName,
  scenePath,
} from '../vscode/pathConventions';
import { vscodeFsAdapter } from '../vscode/workspaceFsAdapters';

import type { StudioPatchTarget } from '../../domain/studio/studioPatch';

export interface StudioEntityContext {
  readonly agentEntityKind: 'character' | 'background' | 'scene';
  readonly entityLabel: string;
  readonly targetFile: string;
  readonly targetUri: vscode.Uri | undefined;
  readonly patchTarget: StudioPatchTarget;
  readonly context: string;
  readonly baseline: string | undefined;
}

// NOTE: a scene entity spans two files, so the editor the author is looking at decides which one a
// proposal may rewrite; the other one stays in the prompt as read-only material.
export type StudioSceneFocus = 'card' | 'draft';

const missingDraftNote =
  '이 씬에는 아직 초안이 없다. 초안을 만들기 전에는 고칠 대상이 없으니 propose하지 말고 say로 알려라.';

export async function readStudioEntityContext(
  workspaceRoot: vscode.Uri,
  entity: StudioEntity,
  sceneFocus: StudioSceneFocus = 'draft',
): Promise<StudioEntityContext | undefined> {
  if (entity.kind === 'character' || entity.kind === 'background') {
    return readCardContext(workspaceRoot, entity.kind, entity.key);
  }

  return entity.kind === 'scene'
    ? readSceneContext(workspaceRoot, entity.key, sceneFocus)
    : undefined;
}

export async function resolveStudioLookups(
  workspaceRoot: vscode.Uri,
  requests: readonly StudioAgentLookupRequest[],
): Promise<string> {
  const sections = await Promise.all(
    requests.map(async (request) => {
      const text = await readLookupText(workspaceRoot, request);
      return `[조회: ${request.kind}/${request.key}]\n${text ?? '찾을 수 없음'}`;
    }),
  );

  return sections.join('\n\n');
}

async function readCardContext(
  workspaceRoot: vscode.Uri,
  cardKind: 'character' | 'background',
  cardId: string,
): Promise<StudioEntityContext | undefined> {
  const targetUri = cardPathFor(workspaceRoot, cardKind, cardId);
  const baseline = await readTextOrUndefined(targetUri);

  if (baseline === undefined) {
    return undefined;
  }

  const relatedScenes = await readScenesFeaturingCard(workspaceRoot, cardId, cardKind);

  return {
    agentEntityKind: cardKind,
    entityLabel: cardId,
    targetFile: relativeCardPath(cardKind, cardId),
    targetUri,
    patchTarget: 'entityCard',
    baseline,
    context: [
      `[현재 카드: ${relativeCardPath(cardKind, cardId)}]`,
      baseline.trim(),
      '',
      '[이 카드가 등장하는 씬]',
      relatedScenes.length > 0 ? relatedScenes.join('\n\n') : '없음',
    ].join('\n'),
  };
}

async function readSceneContext(
  workspaceRoot: vscode.Uri,
  sceneStem: string,
  sceneFocus: StudioSceneFocus,
): Promise<StudioEntityContext | undefined> {
  const sceneUri = scenePath(workspaceRoot, sceneStem);
  const sceneText = await readTextOrUndefined(sceneUri);

  if (sceneText === undefined) {
    return undefined;
  }

  const draftUri = draftPath(workspaceRoot, sceneStem);
  const draftText = await readTextOrUndefined(draftUri);
  const draftBody = draftText === undefined ? undefined : extractDraftBody(draftText);

  const context = [
    `[씬 시드: scene/${sceneStem}.card]`,
    sceneText.trim(),
    '',
    '[초안 본문]',
    draftBody === undefined ? missingDraftNote : draftBody,
  ].join('\n');

  if (sceneFocus === 'card') {
    return {
      agentEntityKind: 'scene',
      entityLabel: sceneStem,
      targetFile: `scene/${sceneStem}.card`,
      targetUri: sceneUri,
      patchTarget: 'sceneCard',
      baseline: sceneText,
      context,
    };
  }

  return {
    agentEntityKind: 'scene',
    entityLabel: sceneStem,
    targetFile: `draft/${sceneStem}.md`,
    targetUri: draftText === undefined ? undefined : draftUri,
    patchTarget: 'draft',
    baseline: draftText,
    context,
  };
}

async function readScenesFeaturingCard(
  workspaceRoot: vscode.Uri,
  cardId: string,
  cardKind: 'character' | 'background',
): Promise<string[]> {
  const { sceneDirectory } = getStoryboardProjectPaths(workspaceRoot);

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

  const sections = await Promise.all(
    stems.map(async (stem) => {
      const scene = await readSceneOrUndefined(workspaceRoot, stem);

      if (!scene || !sceneDeclaresCard(scene, cardId, cardKind)) {
        return undefined;
      }

      return [
        `- scene/${stem}.card: ${scene.frontmatter.title ?? stem}`,
        scene.body.trim().length > 0 ? `  ${scene.body.trim()}` : '',
      ]
        .filter((line) => line.length > 0)
        .join('\n');
    }),
  );

  return sections.filter((section): section is string => section !== undefined);
}

function sceneDeclaresCard(
  scene: Awaited<ReturnType<typeof readSceneFile>>,
  cardId: string,
  cardKind: 'character' | 'background',
): boolean {
  return cardKind === 'character'
    ? (scene.frontmatter.characters?.includes(cardId) ?? false)
    : scene.frontmatter.location === cardId;
}

async function readLookupText(
  workspaceRoot: vscode.Uri,
  request: StudioAgentLookupRequest,
): Promise<string | undefined> {
  switch (request.kind) {
    case 'character':
    case 'background': {
      const card = await readCardOrUndefined(cardPathFor(workspaceRoot, request.kind, request.key));
      return card ? serializeCard(card).trim() : undefined;
    }
    case 'scene': {
      const scene = await readSceneOrUndefined(workspaceRoot, request.key);
      return scene ? scene.body.trim() : undefined;
    }
    case 'draft': {
      const draft = await readTextOrUndefined(draftPath(workspaceRoot, request.key));
      return draft === undefined ? undefined : extractDraftBody(draft);
    }
  }
}

function cardPathFor(
  workspaceRoot: vscode.Uri,
  cardKind: 'character' | 'background',
  cardId: string,
): vscode.Uri {
  return cardKind === 'character'
    ? characterCardPath(workspaceRoot, cardId)
    : backgroundCardPath(workspaceRoot, cardId);
}

function relativeCardPath(cardKind: 'character' | 'background', cardId: string): string {
  return `${cardKind}/${cardId}.card`;
}

async function readTextOrUndefined(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

async function readCardOrUndefined(
  uri: vscode.Uri,
): Promise<Awaited<ReturnType<typeof readCardFile>> | undefined> {
  try {
    return await readCardFile(uri, vscodeFsAdapter);
  } catch {
    return undefined;
  }
}

async function readSceneOrUndefined(
  workspaceRoot: vscode.Uri,
  sceneStem: string,
): Promise<Awaited<ReturnType<typeof readSceneFile>> | undefined> {
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
