import {
  extractInlineSceneSummary,
  joinStoryPath,
  parseCard,
  serializeSceneCard,
  serializeSynopsisMarkdown,
  type OutlineSynopsis,
  type SceneCard,
  type StoryUri,
  type StoryboardCard,
  type StoryboardProject,
  backgroundCardPath,
  characterCardPath,
  getStoryboardProjectPaths,
  mergeVoiceSeeds,
  noteCandidateFileSchema,
  readVoiceSeedsFile,
  writeVoiceSeedsFile,
  STORYBOARD_RELATIVE_PATHS,
  type NoteBundle,
  type NoteCandidateFile,
  type NoteExtractionResponse,
} from '@storyboard/story-model';

import {
  NoteCandidateFileError,
  type INoteAbsorbRepository,
  type NoteCandidateLoad,
} from '#engine/application/notes/noteAbsorbRepository';
import type { NoteAbsorbPlan } from '@storyboard/story-model';
import { readProjectJson, writeProjectJson } from '#engine/persistence/projectJson';
import type { IFileSystem } from '#engine/ports/fileSystem';

function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function encodeJson(value: unknown): Uint8Array {
  return encodeText(`${JSON.stringify(value, null, 2)}\n`);
}

function unreadableCandidateFile(cause: unknown): NoteCandidateFileError {
  return new NoteCandidateFileError(
    'unreadable',
    `노트 카드 후보 파일을 읽지 못했습니다 (JSON 이 아니거나 형식이 맞지 않습니다): ${STORYBOARD_RELATIVE_PATHS.noteCandidates}\n고치거나 지운 뒤 다시 실행하세요. 지우면 승격을 기다리던 노트 후보가 사라집니다.`,
    cause,
  );
}

export class NoteAbsorbRepository implements INoteAbsorbRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async saveBundle(workspaceRoot: StoryUri, bundle: NoteBundle): Promise<void> {
    await this.writeCacheFile(workspaceRoot, 'noteSource', encodeJson(bundle));
  }

  public async savePlan(workspaceRoot: StoryUri, plan: NoteAbsorbPlan): Promise<void> {
    await this.writeCacheFile(workspaceRoot, 'notePlan', encodeJson(plan));
  }

  public async saveExtractionResponses(
    workspaceRoot: StoryUri,
    responses: readonly NoteExtractionResponse[],
  ): Promise<void> {
    await this.writeCacheFile(workspaceRoot, 'noteExtractionResponses', encodeJson(responses));
  }

  public async loadCandidates(workspaceRoot: StoryUri): Promise<NoteCandidateLoad> {
    const uri = getStoryboardProjectPaths(workspaceRoot).noteCandidates;

    if (!(await this.fileSystem.exists(uri))) {
      return { kind: 'none' };
    }

    const text = new TextDecoder().decode(await this.fileSystem.readFile(uri));
    let json: unknown;

    try {
      json = JSON.parse(text);
    } catch (error) {
      throw unreadableCandidateFile(error);
    }

    if (typeof json === 'object' && json !== null && !('version' in json)) {
      return { kind: 'legacy' };
    }

    const parsed = noteCandidateFileSchema.safeParse(json);

    if (!parsed.success) {
      throw unreadableCandidateFile(parsed.error);
    }

    return { kind: 'current', file: parsed.data };
  }

  public async saveCandidates(workspaceRoot: StoryUri, file: NoteCandidateFile): Promise<void> {
    if (file.sources.length === 0) {
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
    const extraction = extractInlineSceneSummary(card);

    if (extraction !== undefined) {
      await this.fileSystem.writeFile(
        this.sceneUri(workspaceRoot, extraction.summaryFileName),
        encodeText(extraction.summaryText),
      );
    }

    await this.fileSystem.writeFile(
      this.sceneUri(workspaceRoot, fileName),
      encodeText(serializeSceneCard(extraction?.card ?? card)),
    );
  }

  public async synopsisExists(workspaceRoot: StoryUri): Promise<boolean> {
    return await this.fileSystem.exists(getStoryboardProjectPaths(workspaceRoot).outlineSynopsis);
  }

  public async writeSynopsis(workspaceRoot: StoryUri, synopsis: OutlineSynopsis): Promise<void> {
    await this.fileSystem.writeFile(
      getStoryboardProjectPaths(workspaceRoot).outlineSynopsis,
      encodeText(serializeSynopsisMarkdown(synopsis)),
    );
  }

  public async loadSynopsisCandidate(workspaceRoot: StoryUri): Promise<string | undefined> {
    const uri = getStoryboardProjectPaths(workspaceRoot).noteSynopsisCandidate;

    if (!(await this.fileSystem.exists(uri))) {
      return undefined;
    }

    return new TextDecoder().decode(await this.fileSystem.readFile(uri));
  }

  public async saveSynopsisCandidate(workspaceRoot: StoryUri, text: string): Promise<void> {
    if (text.length === 0) {
      await this.fileSystem.delete(getStoryboardProjectPaths(workspaceRoot).noteSynopsisCandidate);
      return;
    }

    await this.writeCacheFile(workspaceRoot, 'noteSynopsisCandidate', encodeText(text));
  }

  public async addVoiceSeeds(
    workspaceRoot: StoryUri,
    seeds: Readonly<Record<string, readonly string[]>>,
  ): Promise<void> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    const existing = (await this.fileSystem.exists(paths.voiceSeeds))
      ? await readVoiceSeedsFile(paths.voiceSeeds, this.fileSystem)
      : { characters: {} };

    await this.fileSystem.createDirectory(paths.memoryDirectory);
    await writeVoiceSeedsFile(paths.voiceSeeds, this.fileSystem, mergeVoiceSeeds(existing, seeds));
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
    key:
      | 'noteSource'
      | 'notePlan'
      | 'noteCandidates'
      | 'noteSynopsisCandidate'
      | 'noteExtractionResponses',
    content: Uint8Array,
  ): Promise<void> {
    const paths = getStoryboardProjectPaths(workspaceRoot);

    await this.fileSystem.createDirectory(paths.noteCacheDirectory);
    await this.fileSystem.writeFile(paths[key], content);
  }
}
