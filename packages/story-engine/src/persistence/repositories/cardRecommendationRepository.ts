import { listCardFileUris } from '../cardFiles';
import { joinStoryPath, type StoryUri } from '../../paths/storyUri';
import type { FileSystemDirectoryEntry, IFileSystem } from '../../ports/fileSystem';
import type {
  CardRecommendationInput,
  ICardRecommendationRepository,
} from '../../application/cards/recommendCardsUseCase';
import { getStoryboardProjectPaths, isIgnoredSampleCardFileName } from '../../paths/projectPaths';
import { parseCard, parseDraft, readDraftFile, readSceneFile } from '@storyboard/story-format';
import type { DraftFileSystem, SceneFileSystem } from '@storyboard/story-format';
import type { RecommendationSource } from '../../ai/cardRecommendationBuilder';
import type { RecommendationCategory } from '@storyboard/story-ai';

export class CardRecommendationRepository implements ICardRecommendationRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async load(
    workspaceRoot: StoryUri,
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
    sceneDirectory: StoryUri,
    draftDirectory: StoryUri,
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

  private async readSceneBodies(sceneDirectory: StoryUri): Promise<Map<string, string>> {
    const bodies = new Map<string, string>();
    const entries = await this.readDirectorySafely(sceneDirectory);

    for (const [name, fileType] of entries) {
      if (fileType.type !== 'file' || !name.endsWith('.card') || name.startsWith('.')) {
        continue;
      }

      try {
        const scene = await readSceneFile(
          joinStoryPath(sceneDirectory, name),
          this.fileSystem,
          name,
        );
        bodies.set(scene.stem, scene.body);
      } catch {
        // NOTE: Invalid scene files are intentionally excluded from recommendations.
      }
    }

    return bodies;
  }

  private async readDraftBodies(draftDirectory: StoryUri): Promise<Map<string, string>> {
    const bodies = new Map<string, string>();
    const entries = await this.readDirectorySafely(draftDirectory);

    for (const [name, fileType] of entries) {
      if (fileType.type !== 'file' || !name.endsWith('.md')) {
        continue;
      }

      try {
        const draft = parseDraft(
          await readDraftFile(joinStoryPath(draftDirectory, name), this.fileSystem),
        );
        bodies.set(draft.sceneStem, draft.body);
      } catch {
        // NOTE: Invalid draft files are intentionally excluded from recommendations.
      }
    }

    return bodies;
  }

  private async loadExistingCardNames(
    workspaceRoot: StoryUri,
    category: RecommendationCategory,
  ): Promise<string[]> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    const directory =
      category === 'character' ? paths.characterDirectory : paths.backgroundDirectory;
    const uris = await listCardFileUris(this.fileSystem, directory);
    const names: string[] = [];

    for (const uri of uris) {
      if (isIgnoredSampleCardFileName(uri.path.split('/').at(-1) ?? '')) {
        continue;
      }

      try {
        const card = parseCard(new TextDecoder().decode(await this.fileSystem.readFile(uri)));
        names.push(card.name, ...(card.aliases ?? []));
      } catch {
        // NOTE: Invalid card files cannot be used to filter recommendations.
      }
    }

    return names;
  }

  private async readDirectorySafely(directory: StoryUri): Promise<FileSystemDirectoryEntry[]> {
    try {
      return await this.fileSystem.readDirectory(directory);
    } catch {
      return [];
    }
  }
}
