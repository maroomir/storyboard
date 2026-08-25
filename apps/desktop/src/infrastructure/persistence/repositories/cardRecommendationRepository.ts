import * as vscode from 'vscode';

import type {
  CardRecommendationInput,
  ICardRecommendationRepository,
} from '../../../application/cards/recommendCardsUseCase';
import {
  getStoryboardProjectPaths,
  isIgnoredSampleCardFileName,
} from '../../vscode/pathConventions';
import { parseCard, parseDraft, readDraftFile, readSceneFile } from '@storyboard/story-format';
import type { DraftFileSystem, SceneFileSystem } from '@storyboard/story-format';
import type { RecommendationSource } from '../../../infrastructure/ai/cardRecommendationBuilder';
import type { RecommendationCategory } from '@storyboard/story-ai';

const SCENE_FILE_SYSTEM: SceneFileSystem = {
  readFile: (uri): Thenable<Uint8Array> => vscode.workspace.fs.readFile(uri as vscode.Uri),
};

const DRAFT_FILE_SYSTEM: DraftFileSystem = {
  readFile: (uri): Thenable<Uint8Array> => vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri, content): Thenable<void> =>
    vscode.workspace.fs.writeFile(uri as vscode.Uri, content),
};

export class CardRecommendationRepository implements ICardRecommendationRepository {
  public async load(
    workspaceRoot: vscode.Uri,
    category: RecommendationCategory,
  ): Promise<CardRecommendationInput> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    const [sources, existingNames] = await Promise.all([
      this.gatherSources(paths.sceneDirectory, paths.draftDirectory),
      this.loadExistingCardNames(workspaceRoot, category),
    ]);

    return { existingNames, sources };
  }

  private async gatherSources(
    sceneDirectory: vscode.Uri,
    draftDirectory: vscode.Uri,
  ): Promise<RecommendationSource[]> {
    const [sceneBodies, draftBodies] = await Promise.all([
      this.readSceneBodies(sceneDirectory),
      this.readDraftBodies(draftDirectory),
    ]);
    const stems = new Set<string>([...sceneBodies.keys(), ...draftBodies.keys()]);
    const sources: RecommendationSource[] = [];

    for (const stem of stems) {
      const text = [sceneBodies.get(stem), draftBodies.get(stem)]
        .filter((part): part is string => part !== undefined && part.trim().length > 0)
        .join('\n\n');

      if (text.trim().length > 0) {
        sources.push({ sceneStem: stem, text });
      }
    }

    return sources;
  }

  private async readSceneBodies(sceneDirectory: vscode.Uri): Promise<Map<string, string>> {
    const bodies = new Map<string, string>();
    const entries = await this.readDirectorySafely(sceneDirectory);

    for (const [name, fileType] of entries) {
      if (fileType !== vscode.FileType.File || !name.endsWith('.card') || name.startsWith('.')) {
        continue;
      }

      try {
        const scene = await readSceneFile(
          vscode.Uri.joinPath(sceneDirectory, name),
          SCENE_FILE_SYSTEM,
          name,
        );
        bodies.set(scene.stem, scene.body);
      } catch {
        // NOTE: Invalid scene files are intentionally excluded from recommendations.
      }
    }

    return bodies;
  }

  private async readDraftBodies(draftDirectory: vscode.Uri): Promise<Map<string, string>> {
    const bodies = new Map<string, string>();
    const entries = await this.readDirectorySafely(draftDirectory);

    for (const [name, fileType] of entries) {
      if (fileType !== vscode.FileType.File || !name.endsWith('.md')) {
        continue;
      }

      try {
        const draft = parseDraft(
          await readDraftFile(vscode.Uri.joinPath(draftDirectory, name), DRAFT_FILE_SYSTEM),
        );
        bodies.set(draft.sceneStem, draft.body);
      } catch {
        // NOTE: Invalid draft files are intentionally excluded from recommendations.
      }
    }

    return bodies;
  }

  private async loadExistingCardNames(
    workspaceRoot: vscode.Uri,
    category: RecommendationCategory,
  ): Promise<string[]> {
    const glob = category === 'character' ? 'character/*.card' : 'background/*.card';
    const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(workspaceRoot, glob));
    const names: string[] = [];

    for (const uri of uris) {
      if (isIgnoredSampleCardFileName(uri.path.split('/').at(-1) ?? '')) {
        continue;
      }

      try {
        const card = parseCard(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));
        names.push(card.name, ...(card.aliases ?? []));
      } catch {
        // NOTE: Invalid card files cannot be used to filter recommendations.
      }
    }

    return names;
  }

  private async readDirectorySafely(directory: vscode.Uri): Promise<[string, vscode.FileType][]> {
    try {
      return await vscode.workspace.fs.readDirectory(directory);
    } catch {
      return [];
    }
  }
}
