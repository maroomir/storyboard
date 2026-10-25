import { listCardFileUris } from '#engine/persistence/cardFiles';
import {
  joinStoryPath,
  type StoryUri,
  parseCard,
  parseDraft,
  readDraftFile,
  readSceneFile,
  getStoryboardProjectPaths,
  isIgnoredSampleCardFileName,
  type StoryboardProjectPaths,
  type SceneFile,
  type Draft,
  type StoryboardCard,
  type BibleSubjectKind,
} from '@storyboard/story-model';
import type { FileSystemDirectoryEntry, IFileSystem } from '#engine/ports/fileSystem';
import type {
  CardRecommendationInput,
  ICardRecommendationRepository,
} from '#engine/application/cards/recommendCardsUseCase';
import type { RecommendationSource } from '#engine/ai/cardRecommendationBuilder';

export class CardRecommendationRepository implements ICardRecommendationRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async load(
    workspaceRoot: StoryUri,
    category: BibleSubjectKind,
  ): Promise<CardRecommendationInput> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
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
    const stems: Set<string> = new Set<string>([...sceneBodies.keys(), ...draftBodies.keys()]);
    const sources: RecommendationSource[] = [];

    for (const stem of stems) {
      const text: string = [sceneBodies.get(stem), draftBodies.get(stem)]
        .filter((part): part is string => part !== undefined && part.trim().length > 0)
        .join('\n\n');

      if (text.trim().length > 0) {
        sources.push({ sceneStem: stem, text });
      }
    }

    return sources;
  }

  private async readSceneBodies(sceneDirectory: StoryUri): Promise<Map<string, string>> {
    const bodies: Map<string, string> = new Map<string, string>();
    const entries: FileSystemDirectoryEntry[] = await this.readDirectorySafely(sceneDirectory);

    for (const [name, fileType] of entries) {
      if (fileType.type !== 'file' || !name.endsWith('.card') || name.startsWith('.')) {
        continue;
      }

      try {
        const scene: SceneFile = await readSceneFile(
          joinStoryPath(sceneDirectory, name),
          this.fileSystem,
          name,
        );
        bodies.set(scene.stem, scene.body);
      } catch {
        continue;
      }
    }

    return bodies;
  }

  private async readDraftBodies(draftDirectory: StoryUri): Promise<Map<string, string>> {
    const bodies: Map<string, string> = new Map<string, string>();
    const entries: FileSystemDirectoryEntry[] = await this.readDirectorySafely(draftDirectory);

    for (const [name, fileType] of entries) {
      if (fileType.type !== 'file' || !name.endsWith('.md')) {
        continue;
      }

      try {
        const draft: Draft = parseDraft(
          await readDraftFile(joinStoryPath(draftDirectory, name), this.fileSystem),
        );
        bodies.set(draft.sceneStem, draft.body);
      } catch {
        continue;
      }
    }

    return bodies;
  }

  private async loadExistingCardNames(
    workspaceRoot: StoryUri,
    category: BibleSubjectKind,
  ): Promise<string[]> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    const directory: StoryUri =
      category === 'character' ? paths.characterDirectory : paths.backgroundDirectory;
    const uris: StoryUri[] = await listCardFileUris(this.fileSystem, directory);
    const names: string[] = [];

    for (const uri of uris) {
      if (isIgnoredSampleCardFileName(uri.path.split('/').at(-1) ?? '')) {
        continue;
      }

      try {
        const card: StoryboardCard = parseCard(
          new TextDecoder().decode(await this.fileSystem.readFile(uri)),
        );
        names.push(card.name, ...(card.aliases ?? []));
      } catch {
        continue;
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
