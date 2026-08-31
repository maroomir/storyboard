import * as vscode from 'vscode';

import type { ISceneSidebarRepository } from '../../../application/cards/sceneSidebarRepository';
import {
  draftPath,
  getStoryboardProjectPaths,
  isHiddenSceneFileName,
} from '@storyboard/story-engine';
import { isOutlineStale } from '@storyboard/story-engine';
import { parseSceneFileName, readSceneFile } from '@storyboard/story-format';
import type { SceneFileSystem } from '@storyboard/story-format';
import type { SceneListItem } from '@storyboard/story-engine';
const VSCODE_FILE_SYSTEM: SceneFileSystem = {
  readFile: (uri): Thenable<Uint8Array> => vscode.workspace.fs.readFile(uri as vscode.Uri),
};

export class SceneSidebarRepository implements ISceneSidebarRepository {
  public async list(workspaceRoot: vscode.Uri): Promise<SceneListItem[]> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    const entries = await vscode.workspace.fs.readDirectory(paths.sceneDirectory);
    const names = entries
      .filter(([, type]) => type === vscode.FileType.File)
      .map(([name]) => name)
      .filter((name) => !isHiddenSceneFileName(name))
      .filter((name) => parseSceneFileName(name) !== undefined);
    const outlineMtime = await this.tryStatMtime(paths.outlineChapters);
    const items = await Promise.all(
      names.map(async (name) => await this.toItem(workspaceRoot, name, outlineMtime)),
    );
    return items.sort((left, right) => left.order - right.order);
  }

  private async toItem(
    root: vscode.Uri,
    name: string,
    outlineMtime: number | undefined,
  ): Promise<SceneListItem> {
    const parts = parseSceneFileName(name);
    if (!parts) throw new Error(`Invariant: invalid scene file name ${name}`);
    const paths = getStoryboardProjectPaths(root);
    const sceneUri = vscode.Uri.joinPath(paths.sceneDirectory, name);
    const draftUri = draftPath(root, parts.stem);
    const sceneMtime = (await vscode.workspace.fs.stat(sceneUri)).mtime ?? 0;
    let draftMtime: number | undefined;
    let draftUriString: string | undefined;
    let status: SceneListItem['status'];
    try {
      draftMtime = (await vscode.workspace.fs.stat(draftUri)).mtime ?? 0;
      draftUriString = draftUri.toString();
      status = draftMtime >= sceneMtime ? 'ready' : 'stale';
    } catch {
      status = 'missing';
    }
    let title: string | undefined;
    try {
      const scene = await readSceneFile(sceneUri, VSCODE_FILE_SYSTEM, name);
      const raw = scene.frontmatter.title?.trim();
      title = raw || undefined;
    } catch {
      // NOTE: A malformed scene stays visible without a frontmatter title.
    }
    return {
      stem: parts.stem,
      order: parts.order,
      slug: parts.slug,
      title,
      sceneUri: sceneUri.toString(),
      draftUri: draftUriString,
      status,
      sceneMtime,
      draftMtime,
      outlineStale: isOutlineStale(outlineMtime, sceneMtime),
    };
  }

  private async tryStatMtime(uri: vscode.Uri): Promise<number | undefined> {
    try {
      return (await vscode.workspace.fs.stat(uri)).mtime ?? 0;
    } catch {
      return undefined;
    }
  }
}
