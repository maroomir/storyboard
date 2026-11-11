import {
  extractErrorMessage,
  joinStoryPath,
  parseDraft,
  parseSceneStem,
  readDraftFile,
  writeDraftFile,
} from '@storyboard/story-model';
import type {
  Draft,
  ManuscriptDraftEntry,
  SceneFile,
  SceneFileNameParts,
  StoryboardProjectPaths,
  StoryUri,
} from '@storyboard/story-model';
import type { IDraftRepository } from '#engine/application/drafts/draftRepositories';
import { WorkspaceFiles } from '#engine/persistence/workspaceFiles';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { IStoryboardLogger } from '#engine/ports/logger';

const EXCERPT_LENGTH_LIMIT: number = 800;

function takeLeadingParagraphs(body: string): string | undefined {
  const paragraphs: string[] = body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  const excerpt: string[] = [];
  let length: number = 0;

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

export class DraftRepository implements IDraftRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async write(uri: StoryUri, draft: Draft): Promise<void> {
    await writeDraftFile(uri, this.fileSystem, draft);
  }

  public async collectByOrder(
    paths: StoryboardProjectPaths,
    logger: Pick<IStoryboardLogger, 'warn'>,
  ): Promise<Map<number, ManuscriptDraftEntry>> {
    const draftsByOrder: Map<number, ManuscriptDraftEntry> = new Map<
      number,
      ManuscriptDraftEntry
    >();
    const names: readonly string[] = await new WorkspaceFiles(this.fileSystem).listNames(
      paths.draftDirectory,
      (name) => name.endsWith('.md'),
    );

    for (const name of names) {
      const stem: string = name.slice(0, -'.md'.length);
      const parts: SceneFileNameParts | undefined = parseSceneStem(stem);
      if (!parts) {
        continue;
      }

      const draftUri: StoryUri = joinStoryPath(paths.draftDirectory, name);
      try {
        const draft: Draft = parseDraft(await readDraftFile(draftUri, this.fileSystem));
        draftsByOrder.set(parts.order, { stem, body: draft.body });
      } catch (error) {
        logger.warn(`Skipping unreadable draft: ${name} (${extractErrorMessage(error)})`);
      }
    }

    return draftsByOrder;
  }

  public async findRecentBackgroundExcerpt(
    paths: StoryboardProjectPaths,
    currentScene: Pick<SceneFile, 'order'>,
    scenes: readonly SceneFile[],
    backgroundId: string,
  ): Promise<string | undefined> {
    const earlierScenes: readonly SceneFile[] = scenes
      .filter((scene) => scene.order < currentScene.order && scene.frontmatter.location === backgroundId)
      .sort((left, right) => right.order - left.order);

    for (const scene of earlierScenes) {
      const excerpt: string | undefined = await this.readDraftExcerpt(paths, scene.stem);
      if (excerpt) {
        return excerpt;
      }
    }

    return undefined;
  }

  private async readDraftExcerpt(
    paths: StoryboardProjectPaths,
    sceneStem: string,
  ): Promise<string | undefined> {
    const draftUri: StoryUri = joinStoryPath(paths.draftDirectory, `${sceneStem}.md`);

    try {
      const draft: Draft = parseDraft(await readDraftFile(draftUri, this.fileSystem));
      return takeLeadingParagraphs(draft.body);
    } catch {
      return undefined;
    }
  }
}
