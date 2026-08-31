import * as vscode from 'vscode';

import {
  extractDraftBody,
  parseSceneFileName,
  readCardFile,
  readSceneFile,
  serializeCard,
} from '@storyboard/story-format';
import type { StudioAgentFollowUp, StudioAgentLookupRequest } from '@storyboard/story-ai';

import type { StudioEntity, StudioFollowUpTarget } from '@storyboard/story-engine';
import {
  backgroundCardPath,
  characterCardPath,
  draftPath,
  getStoryboardProjectPaths,
  isIgnoredSampleCardFileName,
  isSafeStudioEntityKey,
  scenePath,
} from '@storyboard/story-engine';
import { vscodeFsAdapter } from '../vscode/workspaceFsAdapters';

import type { StudioPatchTarget } from '@storyboard/story-engine';

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
  // SECURITY: the key reaches here straight off a webview payload and becomes a file path.
  if (!isSafeStudioEntityKey(entity.key)) {
    return undefined;
  }

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
  // SECURITY: lookup keys are model output, so an invented path is refused rather than read.
  const safeRequests = requests.filter((request) => isSafeStudioEntityKey(request.key));

  const sections = await Promise.all(
    safeRequests.map(async (request) => {
      const text = await readLookupText(workspaceRoot, request);
      return `[조회: ${request.kind}/${request.key}]\n${text ?? '찾을 수 없음'}`;
    }),
  );

  return sections.join('\n\n');
}

// NOTE: the model names follow-up targets from memory, so anything it invented is dropped here
// rather than shown to the author as a button that leads nowhere.
export async function resolveStudioFollowUps(
  workspaceRoot: vscode.Uri,
  followUps: readonly StudioAgentFollowUp[],
): Promise<readonly StudioFollowUpTarget[]> {
  const resolved = await Promise.all(
    followUps
      .filter((followUp) => isSafeStudioEntityKey(followUp.key))
      .map(async (followUp) => {
        const targetFile = followUpTargetFile(followUp);
        const exists = await uriExists(followUpUri(workspaceRoot, followUp));

        return exists ? { ...followUp, targetFile } : undefined;
      }),
  );

  return resolved.filter((followUp): followUp is StudioFollowUpTarget => followUp !== undefined);
}

function followUpTargetFile(followUp: StudioAgentFollowUp): string {
  return followUp.kind === 'scene'
    ? `scene/${followUp.key}.card`
    : relativeCardPath(followUp.kind, followUp.key);
}

function followUpUri(workspaceRoot: vscode.Uri, followUp: StudioAgentFollowUp): vscode.Uri {
  return followUp.kind === 'scene'
    ? scenePath(workspaceRoot, followUp.key)
    : cardPathFor(workspaceRoot, followUp.kind, followUp.key);
}

async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
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
