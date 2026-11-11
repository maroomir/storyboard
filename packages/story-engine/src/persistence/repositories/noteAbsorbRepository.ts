import { ProjectRepository } from '#engine/persistence/repositories/projectRepository';
import {
  parseSceneFileName,
  serializeSynopsisMarkdown,
  type OutlineSynopsis,
  type SceneCard,
  type StoryUri,
  type StoryboardCard,
  type StoryboardProject,
  getStoryboardProjectPaths,
  mainThreadId,
  noteCandidateFileSchema,
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
import type {
  BibleSubjectKind,
  NoteAbsorbPlan,
  StatementSource,
  ElementMemory,
  StoryboardProjectPaths,
  VoiceSampleLine,
} from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { WorkspaceCards } from '#engine/persistence/bundles/workspaceCards';
import type { WorkspaceScenes } from '#engine/persistence/bundles/workspaceScenes';

const absorbedSource: StatementSource = { origin: 'studio' };
import type { ZodSafeParseResult } from 'zod';

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
  public constructor(
    private readonly fileSystem: IFileSystem,
    private readonly cards: WorkspaceCards,
    private readonly scenes: WorkspaceScenes,
  ) {}

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
    const uri: StoryUri = getStoryboardProjectPaths(workspaceRoot).noteCandidates;

    if (!(await this.fileSystem.exists(uri))) {
      return { kind: 'none' };
    }

    const text: string = new TextDecoder().decode(await this.fileSystem.readFile(uri));
    let json: unknown;

    try {
      json = JSON.parse(text);
    } catch (error) {
      throw unreadableCandidateFile(error);
    }

    if (typeof json === 'object' && json !== null && !('version' in json)) {
      return { kind: 'legacy' };
    }

    const parsed: ZodSafeParseResult<NoteCandidateFile> = noteCandidateFileSchema.safeParse(json);

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
    cardType: BibleSubjectKind,
    id: string,
  ): Promise<StoryboardCard | undefined> {
    const card: StoryboardCard | undefined = await this.cards.findCard(workspaceRoot, id);
    const isRequestedKind: boolean =
      card !== undefined && (card.type === 'character') === (cardType === 'character');

    return isRequestedKind ? card : undefined;
  }

  public async sceneExists(workspaceRoot: StoryUri, fileName: string): Promise<boolean> {
    const slug: string | undefined = parseSceneFileName(fileName)?.slug;
    return slug !== undefined && (await this.scenes.find(workspaceRoot, slug)) !== undefined;
  }

  public async writeScene(
    workspaceRoot: StoryUri,
    fileName: string,
    card: SceneCard,
  ): Promise<void> {
    const slug: string | undefined = parseSceneFileName(fileName)?.slug;
    await this.scenes.writeCard(workspaceRoot, card, {
      source: absorbedSource,
      ...(slug === undefined ? {} : { slug }),
    });
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
    const uri: StoryUri = getStoryboardProjectPaths(workspaceRoot).noteSynopsisCandidate;

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
    location: string,
    seeds: Readonly<Record<string, readonly string[]>>,
  ): Promise<void> {
    for (const [characterId, lines] of Object.entries(seeds)) {
      const memory: ElementMemory = await this.cards.readMemory(
        workspaceRoot,
        'character',
        characterId,
        mainThreadId,
      );
      const known: Set<string> = new Set((memory.voiceSample ?? []).map((sample) => sample.text));
      const added: VoiceSampleLine[] = [];
      for (const text of lines.map((line) => line.trim())) {
        if (text.length > 0 && !known.has(text)) {
          known.add(text);
          added.push({ text, source: `note:${location}` });
        }
      }
      await this.cards.writeMemory(workspaceRoot, 'character', characterId, mainThreadId, {
        ...memory,
        voiceSample: [...(memory.voiceSample ?? []), ...added],
      });
    }
  }

  public async loadProject(workspaceRoot: StoryUri): Promise<StoryboardProject> {
    return await new ProjectRepository(this.fileSystem).read(
      getStoryboardProjectPaths(workspaceRoot).projectJson,
    );
  }

  public async saveProject(workspaceRoot: StoryUri, project: StoryboardProject): Promise<void> {
    await new ProjectRepository(this.fileSystem).write(
      getStoryboardProjectPaths(workspaceRoot).projectJson,
      project,
    );
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
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);

    await this.fileSystem.createDirectory(paths.noteCacheDirectory);
    await this.fileSystem.writeFile(paths[key], content);
  }
}
