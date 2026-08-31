import * as vscode from 'vscode';

import type { StoryboardProjectPaths } from '@storyboard/story-engine';
import { isHiddenSceneFileName } from '@storyboard/story-engine';
import { vscodeFsAdapter } from '../vscode/workspaceFsAdapters';
import {
  parseDraft,
  parseSceneFileName,
  readDraftFile,
  readSceneFile,
} from '@storyboard/story-format';

const EXCERPT_LENGTH_LIMIT = 800;

// NOTE: 같은 장소가 다시 나올 때 배경 묘사를 갱신하기 위한 재료. 직전 등장 씬의 초안 앞부분만
// 쓴다. 장면 도입부에 공간 묘사가 몰려 있고, 뒤로 갈수록 그 장면 한정 사건이 늘기 때문이다.
export async function findRecentBackgroundExcerpt(
  paths: StoryboardProjectPaths,
  currentSceneStem: string,
  backgroundId: string,
): Promise<string | undefined> {
  const currentOrder = parseSceneFileName(`${currentSceneStem}.card`)?.order;
  if (currentOrder === undefined) {
    return undefined;
  }

  const earlierScenes = await listEarlierScenes(paths, currentOrder);

  for (const scene of earlierScenes) {
    const sceneUri = vscode.Uri.joinPath(paths.sceneDirectory, scene.fileName);

    try {
      const sceneFile = await readSceneFile(sceneUri, vscodeFsAdapter, scene.fileName);
      if (sceneFile.frontmatter.location !== backgroundId) {
        continue;
      }
    } catch {
      continue;
    }

    const excerpt = await readDraftExcerpt(paths, scene.stem);
    if (excerpt) {
      return excerpt;
    }
  }

  return undefined;
}

interface EarlierScene {
  readonly fileName: string;
  readonly stem: string;
  readonly order: number;
}

async function listEarlierScenes(
  paths: StoryboardProjectPaths,
  currentOrder: number,
): Promise<EarlierScene[]> {
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(paths.sceneDirectory);
  } catch {
    return [];
  }

  return entries
    .filter(([name, fileType]) => fileType === vscode.FileType.File && !isHiddenSceneFileName(name))
    .flatMap(([name]) => {
      const parts = parseSceneFileName(name);
      return parts && parts.order < currentOrder
        ? [{ fileName: name, stem: parts.stem, order: parts.order }]
        : [];
    })
    .sort((left, right) => right.order - left.order);
}

async function readDraftExcerpt(
  paths: StoryboardProjectPaths,
  sceneStem: string,
): Promise<string | undefined> {
  const draftUri = vscode.Uri.joinPath(paths.draftDirectory, `${sceneStem}.md`);

  try {
    const draft = parseDraft(await readDraftFile(draftUri, vscodeFsAdapter));
    return takeLeadingParagraphs(draft.body);
  } catch {
    return undefined;
  }
}

function takeLeadingParagraphs(body: string): string | undefined {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  const excerpt: string[] = [];
  let length = 0;

  for (const paragraph of paragraphs) {
    if (length + paragraph.length > EXCERPT_LENGTH_LIMIT && excerpt.length > 0) {
      break;
    }

    excerpt.push(paragraph);
    length += paragraph.length;

    if (length >= EXCERPT_LENGTH_LIMIT) {
      break;
    }
  }

  return excerpt.length > 0 ? excerpt.join('\n\n').slice(0, EXCERPT_LENGTH_LIMIT) : undefined;
}
