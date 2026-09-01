import type { StoryUri } from '@storyboard/story-format';
import type { FileSystemDirectoryEntry, IFileSystem } from '../ports/fileSystem';
import {
  extractDraftBody,
  parseSceneFileName,
  readCardFile,
  readSceneFile,
  serializeCard,
} from '@storyboard/story-format';
import type { StudioAgentFollowUp, StudioAgentLookupRequest } from '@storyboard/story-ai';

import type { StudioEntity, StudioFollowUpTarget } from '../shared/messaging/studio';
import {
  backgroundCardPath,
  characterCardPath,
  draftPath,
  getStoryboardProjectPaths,
  isIgnoredSampleCardFileName,
  isSafeStudioEntityKey,
  scenePath,
} from '../paths/projectPaths';

import type { StudioPatchTarget } from '../domain/studio/studioPatch';

export interface StudioEntityContext {
  readonly agentEntityKind: 'character' | 'background' | 'scene';
  readonly entityLabel: string;
  readonly targetFile: string;
  readonly targetUri: StoryUri | undefined;
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
  fs: IFileSystem,
  workspaceRoot: StoryUri,
  entity: StudioEntity,
  sceneFocus: StudioSceneFocus = 'draft',
): Promise<StudioEntityContext | undefined> {
  // SECURITY: the key reaches here straight off a webview payload and becomes a file path.
  if (!isSafeStudioEntityKey(entity.key)) {
    return undefined;
  }

  if (entity.kind === 'character' || entity.kind === 'background') {
    return readCardContext(fs, workspaceRoot, entity.kind, entity.key);
  }

  return entity.kind === 'scene'
    ? readSceneContext(fs, workspaceRoot, entity.key, sceneFocus)
    : undefined;
}

export async function resolveStudioLookups(
  fs: IFileSystem,
  workspaceRoot: StoryUri,
  requests: readonly StudioAgentLookupRequest[],
): Promise<string> {
  // SECURITY: lookup keys are model output, so an invented path is refused rather than read.
  const safeRequests = requests.filter((request) => isSafeStudioEntityKey(request.key));

  const sections = await Promise.all(
    safeRequests.map(async (request) => {
      const text = await readLookupText(fs, workspaceRoot, request);
      return `[조회: ${request.kind}/${request.key}]\n${text ?? '찾을 수 없음'}`;
    }),
  );

  return sections.join('\n\n');
}

// NOTE: the model names follow-up targets from memory, so anything it invented is dropped here
// rather than shown to the author as a button that leads nowhere.
export async function resolveStudioFollowUps(
  fs: IFileSystem,
  workspaceRoot: StoryUri,
  followUps: readonly StudioAgentFollowUp[],
): Promise<readonly StudioFollowUpTarget[]> {
  const resolved = await Promise.all(
    followUps
      .filter((followUp) => isSafeStudioEntityKey(followUp.key))
      .map(async (followUp) => {
        const targetFile = followUpTargetFile(followUp);
        const exists = await fs.exists(followUpUri(workspaceRoot, followUp));

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

function followUpUri(workspaceRoot: StoryUri, followUp: StudioAgentFollowUp): StoryUri {
  return followUp.kind === 'scene'
    ? scenePath(workspaceRoot, followUp.key)
    : cardPathFor(workspaceRoot, followUp.kind, followUp.key);
}

async function readCardContext(
  fs: IFileSystem,
  workspaceRoot: StoryUri,
  cardKind: 'character' | 'background',
  cardId: string,
): Promise<StudioEntityContext | undefined> {
  const targetUri = cardPathFor(workspaceRoot, cardKind, cardId);
  const baseline = await readTextOrUndefined(fs, targetUri);

  if (baseline === undefined) {
    return undefined;
  }

  const relatedScenes = await readScenesFeaturingCard(fs, workspaceRoot, cardId, cardKind);

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
  fs: IFileSystem,
  workspaceRoot: StoryUri,
  sceneStem: string,
  sceneFocus: StudioSceneFocus,
): Promise<StudioEntityContext | undefined> {
  const sceneUri = scenePath(workspaceRoot, sceneStem);
  const sceneText = await readTextOrUndefined(fs, sceneUri);

  if (sceneText === undefined) {
    return undefined;
  }

  const draftUri = draftPath(workspaceRoot, sceneStem);
  const draftText = await readTextOrUndefined(fs, draftUri);
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
  fs: IFileSystem,
  workspaceRoot: StoryUri,
  cardId: string,
  cardKind: 'character' | 'background',
): Promise<string[]> {
  const { sceneDirectory } = getStoryboardProjectPaths(workspaceRoot);

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

  const sections = await Promise.all(
    stems.map(async (stem) => {
      const scene = await readSceneOrUndefined(fs, workspaceRoot, stem);

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
  fs: IFileSystem,
  workspaceRoot: StoryUri,
  request: StudioAgentLookupRequest,
): Promise<string | undefined> {
  switch (request.kind) {
    case 'character':
    case 'background': {
      const card = await readCardOrUndefined(
        fs,
        cardPathFor(workspaceRoot, request.kind, request.key),
      );
      return card ? serializeCard(card).trim() : undefined;
    }
    case 'scene': {
      const scene = await readSceneOrUndefined(fs, workspaceRoot, request.key);
      return scene ? scene.body.trim() : undefined;
    }
    case 'draft': {
      const draft = await readTextOrUndefined(fs, draftPath(workspaceRoot, request.key));
      return draft === undefined ? undefined : extractDraftBody(draft);
    }
  }
}

function cardPathFor(
  workspaceRoot: StoryUri,
  cardKind: 'character' | 'background',
  cardId: string,
): StoryUri {
  return cardKind === 'character'
    ? characterCardPath(workspaceRoot, cardId)
    : backgroundCardPath(workspaceRoot, cardId);
}

function relativeCardPath(cardKind: 'character' | 'background', cardId: string): string {
  return `${cardKind}/${cardId}.card`;
}

async function readTextOrUndefined(fs: IFileSystem, uri: StoryUri): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await fs.readFile(uri));
  } catch {
    return undefined;
  }
}

async function readCardOrUndefined(
  fs: IFileSystem,
  uri: StoryUri,
): Promise<Awaited<ReturnType<typeof readCardFile>> | undefined> {
  try {
    return await readCardFile(uri, fs);
  } catch {
    return undefined;
  }
}

async function readSceneOrUndefined(
  fs: IFileSystem,
  workspaceRoot: StoryUri,
  sceneStem: string,
): Promise<Awaited<ReturnType<typeof readSceneFile>> | undefined> {
  try {
    return await readSceneFile(scenePath(workspaceRoot, sceneStem), fs, `${sceneStem}.card`);
  } catch {
    return undefined;
  }
}
