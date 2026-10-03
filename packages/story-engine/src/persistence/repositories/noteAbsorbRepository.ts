import {
  joinStoryPath,
  parseCard,
  serializeSceneCard,
  serializeSynopsisMarkdown,
  type OutlineSynopsis,
  type SceneCard,
  type StoryUri,
  type StoryboardCard,
  type StoryboardProject,
} from '@storyboard/story-format';

import type { INoteAbsorbRepository } from '#engine/application/notes/noteAbsorbRepository';
import type { NoteAbsorbPlan } from '#engine/domain/notes/noteAbsorbPlan';
import {
  backgroundCardPath,
  characterCardPath,
  getStoryboardProjectPaths,
} from '#engine/paths/projectPaths';
import { readProjectJson, writeProjectJson } from '#engine/persistence/projectJson';
import type { IFileSystem } from '#engine/ports/fileSystem';
import {
  noteCandidateFileSchema,
  type NoteBundle,
  type NoteCandidateFile,
} from '#engine/shared/noteAbsorb';

function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function encodeJson(value: unknown): Uint8Array {
  return encodeText(`${JSON.stringify(value, null, 2)}\n`);
}

export class NoteAbsorbRepository implements INoteAbsorbRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async saveBundle(workspaceRoot: StoryUri, bundle: NoteBundle): Promise<void> {
    await this.writeCacheFile(workspaceRoot, 'noteSource', encodeJson(bundle));
  }

  public async savePlan(workspaceRoot: StoryUri, plan: NoteAbsorbPlan): Promise<void> {
    await this.writeCacheFile(workspaceRoot, 'notePlan', encodeJson(plan));
  }

  public async loadCandidates(workspaceRoot: StoryUri): Promise<NoteCandidateFile | undefined> {
    const uri = getStoryboardProjectPaths(workspaceRoot).noteCandidates;

    if (!(await this.fileSystem.exists(uri))) {
      return undefined;
    }

    const text = new TextDecoder().decode(await this.fileSystem.readFile(uri));

    return noteCandidateFileSchema.parse(JSON.parse(text));
  }

  public async saveCandidates(workspaceRoot: StoryUri, file: NoteCandidateFile): Promise<void> {
    if (file.candidates.length === 0) {
      await this.fileSystem.delete(getStoryboardProjectPaths(workspaceRoot).noteCandidates);
      return;
    }

    await this.writeCacheFile(workspaceRoot, 'noteCandidates', encodeJson(file));
  }

  public async loadCard(
    workspaceRoot: StoryUri,
    cardType: 'character' | 'background',
    id: string,
  ): Promise<StoryboardCard | undefined> {
    const uri =
      cardType === 'character'
        ? characterCardPath(workspaceRoot, id)
        : backgroundCardPath(workspaceRoot, id);

    if (!(await this.fileSystem.exists(uri))) {
      return undefined;
    }

    return parseCard(new TextDecoder().decode(await this.fileSystem.readFile(uri)));
  }

  public async sceneExists(workspaceRoot: StoryUri, fileName: string): Promise<boolean> {
    return await this.fileSystem.exists(this.sceneUri(workspaceRoot, fileName));
  }

  public async writeScene(
    workspaceRoot: StoryUri,
    fileName: string,
    card: SceneCard,
  ): Promise<void> {
    await this.fileSystem.writeFile(
      this.sceneUri(workspaceRoot, fileName),
      encodeText(serializeSceneCard(card)),
    );
  }

  public async synopsisExists(workspaceRoot: StoryUri): Promise<boolean> {
    return await this.fileSystem.exists(getStoryboardProjectPaths(workspaceRoot).outlineSynopsis);
  }

  public async writeSynopsis(
    workspaceRoot: StoryUri,
    synopsis: OutlineSynopsis,
    asCandidate: boolean,
  ): Promise<void> {
    const content = encodeText(serializeSynopsisMarkdown(synopsis));

    if (asCandidate) {
      await this.writeCacheFile(workspaceRoot, 'noteSynopsisCandidate', content);
      return;
    }

    await this.fileSystem.writeFile(
      getStoryboardProjectPaths(workspaceRoot).outlineSynopsis,
      content,
    );
  }

  public async loadProject(workspaceRoot: StoryUri): Promise<StoryboardProject> {
    return await readProjectJson(
      this.fileSystem,
      getStoryboardProjectPaths(workspaceRoot).projectJson,
    );
  }

  public async saveProject(workspaceRoot: StoryUri, project: StoryboardProject): Promise<void> {
    await writeProjectJson(
      this.fileSystem,
      getStoryboardProjectPaths(workspaceRoot).projectJson,
      project,
    );
  }

  private sceneUri(workspaceRoot: StoryUri, fileName: string): StoryUri {
    return joinStoryPath(getStoryboardProjectPaths(workspaceRoot).sceneDirectory, fileName);
  }

  private async writeCacheFile(
    workspaceRoot: StoryUri,
    key: 'noteSource' | 'notePlan' | 'noteCandidates' | 'noteSynopsisCandidate',
    content: Uint8Array,
  ): Promise<void> {
    const paths = getStoryboardProjectPaths(workspaceRoot);

    await this.fileSystem.createDirectory(paths.noteCacheDirectory);
    await this.fileSystem.writeFile(paths[key], content);
  }
}
