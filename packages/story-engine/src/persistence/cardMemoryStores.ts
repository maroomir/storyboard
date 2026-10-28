import {
  joinStoryPath,
  type StoryUri,
  computeBackgroundCardHash,
  computeBackgroundFactConflictKey,
  parseBackgroundFactConflictRecords,
  serializeBackgroundFactConflictRecords,
  type BackgroundFactConflictRecords,
  computeDraftBodyHash,
  computePersonaCardHash,
  parseDraft,
  readBackgroundMemoryFile,
  readDraftFile,
  readPersonaMemoryFile,
  parseSceneStem,
  readSceneDialogueFile,
  readVoiceSeedsFile,
  writeBackgroundMemoryFile,
  writePersonaMemoryFile,
  writeSceneDialogueFile,
} from '@storyboard/story-model';
import { promptResourceFingerprint } from '@storyboard/story-ai';
import type { IFileSystem } from '#engine/ports/fileSystem';
import { WorkspaceFiles } from '#engine/persistence/workspaceFiles';
import type {
  StoryboardProjectPaths,
  BackgroundCard,
  CharacterCard,
  SceneDialogueRecord,
  VoiceSeeds,
  PersonaMemoryRecord,
  BackgroundMemoryRecord,
  BackgroundFactConflictRecord,
  SceneDialogueTurn,
  BackgroundFactConflict,
} from '@storyboard/story-model';
import type {
  IBackgroundFactConflictStore,
  IBackgroundMemoryStore,
  IPersonaMemoryStore,
  ISceneDialogueStore,
} from '#engine/pipeline/memoryStore';

function isMemoryAheadOfScene(updatedThroughScene: string, sceneStem: string): boolean {
  const memoryOrder: number | undefined = parseSceneStem(updatedThroughScene)?.order;
  const currentOrder: number | undefined = parseSceneStem(sceneStem)?.order;

  return memoryOrder !== undefined && currentOrder !== undefined && memoryOrder >= currentOrder;
}

export class PersonaMemoryStore implements IPersonaMemoryStore {
  private readonly promptFingerprint: string = promptResourceFingerprint('personaGeneration');

  public constructor(
    private readonly fileSystem: IFileSystem,
    private readonly paths: StoryboardProjectPaths,
    private readonly sceneStem: string,
  ) {}

  public async load(card: CharacterCard): Promise<string | undefined> {
    const uri: StoryUri = this.filePath(card.id);

    if (!(await this.fileSystem.exists(uri))) {
      return undefined;
    }

    try {
      const record: PersonaMemoryRecord = await readPersonaMemoryFile(uri, this.fileSystem);
      const isReusable: boolean =
        record.cardHash === computePersonaCardHash(card, this.promptFingerprint) &&
        !isMemoryAheadOfScene(record.updatedThroughScene, this.sceneStem);

      return isReusable ? record.persona : undefined;
    } catch {
      return undefined;
    }
  }

  public async save(card: CharacterCard, persona: string): Promise<void> {
    await this.fileSystem.createDirectory(this.paths.personaMemoryDirectory);
    await writePersonaMemoryFile(this.filePath(card.id), this.fileSystem, {
      cardId: card.id,
      persona,
      updatedThroughScene: this.sceneStem,
      cardHash: computePersonaCardHash(card, this.promptFingerprint),
    });
  }

  private filePath(cardId: string): StoryUri {
    return joinStoryPath(this.paths.personaMemoryDirectory, `${cardId}.json`);
  }
}

export class BackgroundMemoryStore implements IBackgroundMemoryStore {
  public constructor(
    private readonly fileSystem: IFileSystem,
    private readonly paths: StoryboardProjectPaths,
    private readonly sceneStem: string,
  ) {}

  public async load(card: BackgroundCard): Promise<string | undefined> {
    const uri: StoryUri = this.filePath(card.id);

    if (!(await this.fileSystem.exists(uri))) {
      return undefined;
    }

    try {
      const record: BackgroundMemoryRecord = await readBackgroundMemoryFile(uri, this.fileSystem);
      const isReusable: boolean =
        record.cardHash === computeBackgroundCardHash(card) &&
        !isMemoryAheadOfScene(record.updatedThroughScene, this.sceneStem);

      return isReusable ? record.atmosphere : undefined;
    } catch {
      return undefined;
    }
  }

  public async save(card: BackgroundCard, atmosphere: string): Promise<void> {
    await this.fileSystem.createDirectory(this.paths.backgroundMemoryDirectory);
    await writeBackgroundMemoryFile(this.filePath(card.id), this.fileSystem, {
      cardId: card.id,
      atmosphere,
      updatedThroughScene: this.sceneStem,
      cardHash: computeBackgroundCardHash(card),
    });
  }

  private filePath(cardId: string): StoryUri {
    return joinStoryPath(this.paths.backgroundMemoryDirectory, `${cardId}.json`);
  }
}

export class BackgroundFactConflictStore implements IBackgroundFactConflictStore {
  private readonly promptFingerprint: string = promptResourceFingerprint('backgroundFactConflicts');

  public constructor(
    private readonly fileSystem: IFileSystem,
    private readonly paths: StoryboardProjectPaths,
  ) {}

  public async load(card: BackgroundCard): Promise<readonly BackgroundFactConflict[] | undefined> {
    const record: BackgroundFactConflictRecord | undefined = (await this.readRecords())[card.id];
    const isCurrent: boolean =
      record?.inputKey === computeBackgroundFactConflictKey(card, this.promptFingerprint);

    return isCurrent ? record?.conflicts : undefined;
  }

  public async save(card: BackgroundCard, conflicts: readonly BackgroundFactConflict[]): Promise<void> {
    const records: BackgroundFactConflictRecords = await this.readRecords();
    const next: BackgroundFactConflictRecords = {
      ...records,
      [card.id]: {
        inputKey: computeBackgroundFactConflictKey(card, this.promptFingerprint),
        conflicts,
      },
    };
    await this.fileSystem.createDirectory(this.paths.cacheDirectory);
    await this.fileSystem.writeFile(
      this.paths.backgroundFactConflicts,
      new TextEncoder().encode(serializeBackgroundFactConflictRecords(next)),
    );
  }

  public async readRecords(): Promise<BackgroundFactConflictRecords> {
    if (!(await this.fileSystem.exists(this.paths.backgroundFactConflicts))) {
      return {};
    }

    try {
      const raw: string = new TextDecoder().decode(
        await this.fileSystem.readFile(this.paths.backgroundFactConflicts),
      );
      return parseBackgroundFactConflictRecords(raw);
    } catch {
      return {};
    }
  }
}

export class SceneDialogueStore implements ISceneDialogueStore {
  public constructor(
    private readonly fileSystem: IFileSystem,
    private readonly paths: StoryboardProjectPaths,
  ) {}

  public async save(record: SceneDialogueRecord): Promise<void> {
    await this.fileSystem.createDirectory(this.paths.sceneDialogueDirectory);
    await writeSceneDialogueFile(this.filePath(record.sceneStem), this.fileSystem, record);
  }

  public async loadCorpus(): Promise<readonly SceneDialogueRecord[]> {
    return await new WorkspaceFiles(this.fileSystem).readAll(this.paths.sceneDialogueDirectory, {
      isEligible: (name) => name.endsWith('.json'),
      read: async (uri) =>
        await this.reconcileWithDraft(await readSceneDialogueFile(uri, this.fileSystem)),
    });
  }

  public async loadVoiceSeeds(): Promise<VoiceSeeds> {
    if (!(await this.fileSystem.exists(this.paths.voiceSeeds))) {
      return { characters: {} };
    }

    return await readVoiceSeedsFile(this.paths.voiceSeeds, this.fileSystem);
  }

  private filePath(sceneStem: string): StoryUri {
    return joinStoryPath(this.paths.sceneDialogueDirectory, `${sceneStem}.json`);
  }

  private async reconcileWithDraft(
    record: SceneDialogueRecord,
  ): Promise<SceneDialogueRecord | undefined> {
    const draftUri: StoryUri = joinStoryPath(this.paths.draftDirectory, `${record.sceneStem}.md`);

    let body: string;
    try {
      body = parseDraft(await readDraftFile(draftUri, this.fileSystem)).body;
    } catch {
      return undefined;
    }

    if (computeDraftBodyHash(body) === record.bodyHash) {
      return record;
    }

    const surviving: SceneDialogueTurn[] = record.turns.filter((turn) => body.includes(turn.text));
    return surviving.length > 0 ? { ...record, turns: surviving } : undefined;
  }
}
