import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { WorkspaceCaches, WorkspaceCards, WorkspaceScenes } from '@storyboard/story-engine';
import { NodeFileSystem, NodeSqlDatabaseHost } from '@storyboard/story-node';
import {
  NodeUri,
  parseSceneCard,
  parseSceneStem,
  serializeSceneCard,
  type SceneCard,
  type SceneFile,
  type SceneFileNameParts,
  type StatementSource,
} from '@storyboard/story-model';

const fixtureSource: StatementSource = { origin: 'studio' };

async function withScenes<T>(run: (scenes: WorkspaceScenes) => Promise<T>): Promise<T> {
  const fileSystem: NodeFileSystem = new NodeFileSystem();
  const caches: WorkspaceCaches = new WorkspaceCaches({ host: new NodeSqlDatabaseHost(), fileSystem });
  try {
    const cards: WorkspaceCards = new WorkspaceCards({ fileSystem, caches });
    return await run(new WorkspaceScenes({ fileSystem, caches, cards }));
  } finally {
    await caches.closeAll();
  }
}

function slugOfSceneCard(card: SceneCard): string {
  const parts: SceneFileNameParts | undefined = card.id === undefined ? undefined : parseSceneStem(card.id);
  return parts?.slug ?? card.id ?? 'scene';
}

export async function writeSceneBundle(workspace: string, card: SceneCard): Promise<string> {
  return await withScenes(async (scenes) => {
    const written = await scenes.writeCard(NodeUri.file(workspace), card, {
      source: fixtureSource,
      slug: slugOfSceneCard(card),
    });
    return written.stem;
  });
}

export async function writeSceneBundleFromYaml(workspace: string, yamlText: string): Promise<string> {
  return await writeSceneBundle(workspace, parseSceneCard(yamlText));
}

export async function writeSceneBundlesFromYaml(
  workspace: string,
  yamlTexts: readonly string[],
): Promise<string[]> {
  const stems: string[] = [];
  for (const yamlText of yamlTexts) {
    stems.push(await writeSceneBundleFromYaml(workspace, yamlText));
  }
  return stems;
}

export async function readSceneFromBundles(
  workspace: string,
  reference: string,
): Promise<SceneFile | undefined> {
  return await withScenes(async (scenes) => await scenes.read(NodeUri.file(workspace), reference));
}

export async function listScenesFromBundles(workspace: string): Promise<readonly SceneFile[]> {
  return await withScenes(async (scenes) => (await scenes.loadRoster(NodeUri.file(workspace))).scenes);
}

export async function readSceneCardYaml(workspace: string, reference: string): Promise<string> {
  const scene: SceneFile | undefined = await readSceneFromBundles(workspace, reference);
  if (scene === undefined) {
    throw new Error(`씬 번들이 없습니다: ${reference}`);
  }
  return serializeSceneCard(scene.card);
}

export function listSceneStems(workspace: string): string[] {
  const directory: string = join(workspace, 'scene');
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory)
    .filter((name) => name.endsWith('.card'))
    .map((name) => name.slice(0, -'.card'.length))
    .sort();
}
