import { WorkspaceFiles } from '#engine/persistence/workspaceFiles';
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

async function ensurePersonaMemoryDirectory(
  fs: IFileSystem,
  paths: StoryboardProjectPaths,
): Promise<void> {
  await fs.createDirectory(paths.personaMemoryDirectory);
}

async function ensureBackgroundMemoryDirectory(
  fs: IFileSystem,
  paths: StoryboardProjectPaths,
): Promise<void> {
  await fs.createDirectory(paths.backgroundMemoryDirectory);
}

function personaMemoryFilePath(paths: StoryboardProjectPaths, cardId: string): StoryUri {
  return joinStoryPath(paths.personaMemoryDirectory, `${cardId}.json`);
}

function backgroundMemoryFilePath(paths: StoryboardProjectPaths, cardId: string): StoryUri {
  return joinStoryPath(paths.backgroundMemoryDirectory, `${cardId}.json`);
}

function isMemoryAheadOfScene(updatedThroughScene: string, sceneStem: string): boolean {
  const memoryOrder: number | undefined = parseSceneStem(updatedThroughScene)?.order;
  const currentOrder: number | undefined = parseSceneStem(sceneStem)?.order;

  return memoryOrder !== undefined && currentOrder !== undefined && memoryOrder >= currentOrder;
}

export function createPersonaMemoryStore(
  fs: IFileSystem,
  paths: StoryboardProjectPaths,
  sceneStem: string,
): IPersonaMemoryStore {
  const promptFingerprint: string = promptResourceFingerprint('personaGeneration');

  return {
    async load(card: CharacterCard): Promise<string | undefined> {
      const uri: StoryUri = personaMemoryFilePath(paths, card.id);

      if (!(await fs.exists(uri))) {
        return undefined;
      }

      try {
        const record: PersonaMemoryRecord = await readPersonaMemoryFile(uri, fs);
        const isReusable: boolean =
          record.cardHash === computePersonaCardHash(card, promptFingerprint) &&
          !isMemoryAheadOfScene(record.updatedThroughScene, sceneStem);

        return isReusable ? record.persona : undefined;
      } catch {
        return undefined;
      }
    },
    async save(card: CharacterCard, persona: string): Promise<void> {
      await ensurePersonaMemoryDirectory(fs, paths);
      await writePersonaMemoryFile(personaMemoryFilePath(paths, card.id), fs, {
        cardId: card.id,
        persona,
        updatedThroughScene: sceneStem,
        cardHash: computePersonaCardHash(card, promptFingerprint),
      });
    },
  };
}

export function createBackgroundMemoryStore(
  fs: IFileSystem,
  paths: StoryboardProjectPaths,
  sceneStem: string,
): IBackgroundMemoryStore {
  return {
    async load(card: BackgroundCard): Promise<string | undefined> {
      const uri: StoryUri = backgroundMemoryFilePath(paths, card.id);

      if (!(await fs.exists(uri))) {
        return undefined;
      }

      try {
        const record: BackgroundMemoryRecord = await readBackgroundMemoryFile(uri, fs);
        const isReusable: boolean =
          record.cardHash === computeBackgroundCardHash(card) &&
          !isMemoryAheadOfScene(record.updatedThroughScene, sceneStem);

        return isReusable ? record.atmosphere : undefined;
      } catch {
        return undefined;
      }
    },
    async save(card: BackgroundCard, atmosphere: string): Promise<void> {
      await ensureBackgroundMemoryDirectory(fs, paths);
      await writeBackgroundMemoryFile(backgroundMemoryFilePath(paths, card.id), fs, {
        cardId: card.id,
        atmosphere,
        updatedThroughScene: sceneStem,
        cardHash: computeBackgroundCardHash(card),
      });
    },
  };
}

export async function readBackgroundFactConflictRecords(
  fs: IFileSystem,
  paths: StoryboardProjectPaths,
): Promise<BackgroundFactConflictRecords> {
  if (!(await fs.exists(paths.backgroundFactConflicts))) {
    return {};
  }

  try {
    const raw: string = new TextDecoder().decode(await fs.readFile(paths.backgroundFactConflicts));
    return parseBackgroundFactConflictRecords(raw);
  } catch {
    return {};
  }
}

export function createBackgroundFactConflictStore(
  fs: IFileSystem,
  paths: StoryboardProjectPaths,
): IBackgroundFactConflictStore {
  const promptFingerprint: string = promptResourceFingerprint('backgroundFactConflicts');

  return {
    async load(card: BackgroundCard): Promise<readonly BackgroundFactConflict[] | undefined> {
      const record: BackgroundFactConflictRecord | undefined = (
        await readBackgroundFactConflictRecords(fs, paths)
      )[card.id];
      const isCurrent: boolean =
        record?.inputKey === computeBackgroundFactConflictKey(card, promptFingerprint);

      return isCurrent ? record?.conflicts : undefined;
    },
    async save(card: BackgroundCard, conflicts: readonly BackgroundFactConflict[]): Promise<void> {
      const records: BackgroundFactConflictRecords = await readBackgroundFactConflictRecords(
        fs,
        paths,
      );
      const next: BackgroundFactConflictRecords = {
        ...records,
        [card.id]: {
          inputKey: computeBackgroundFactConflictKey(card, promptFingerprint),
          conflicts,
        },
      };
      await fs.createDirectory(paths.cacheDirectory);
      await fs.writeFile(
        paths.backgroundFactConflicts,
        new TextEncoder().encode(serializeBackgroundFactConflictRecords(next)),
      );
    },
  };
}

function sceneDialogueFilePath(paths: StoryboardProjectPaths, sceneStem: string): StoryUri {
  return joinStoryPath(paths.sceneDialogueDirectory, `${sceneStem}.json`);
}

export function createSceneDialogueStore(
  fs: IFileSystem,
  paths: StoryboardProjectPaths,
): ISceneDialogueStore {
  return {
    async save(record: SceneDialogueRecord): Promise<void> {
      await fs.createDirectory(paths.sceneDialogueDirectory);
      await writeSceneDialogueFile(sceneDialogueFilePath(paths, record.sceneStem), fs, record);
    },
    async loadCorpus(): Promise<readonly SceneDialogueRecord[]> {
      const records: SceneDialogueRecord[] = await new WorkspaceFiles(fs).readAll(
        paths.sceneDialogueDirectory,
        {
          isEligible: (name) => name.endsWith('.json'),
          read: async (uri) =>
            await reconcileWithDraft(fs, paths, await readSceneDialogueFile(uri, fs)),
        },
      );

      return records;
    },
    async loadVoiceSeeds(): Promise<VoiceSeeds> {
      if (!(await fs.exists(paths.voiceSeeds))) {
        return { characters: {} };
      }

      return await readVoiceSeedsFile(paths.voiceSeeds, fs);
    },
  };
}

async function reconcileWithDraft(
  fs: IFileSystem,
  paths: StoryboardProjectPaths,
  record: SceneDialogueRecord,
): Promise<SceneDialogueRecord | undefined> {
  const draftUri: StoryUri = joinStoryPath(paths.draftDirectory, `${record.sceneStem}.md`);

  let body: string;
  try {
    body = parseDraft(await readDraftFile(draftUri, fs)).body;
  } catch {
    return undefined;
  }

  if (computeDraftBodyHash(body) === record.bodyHash) {
    return record;
  }

  const surviving: SceneDialogueTurn[] = record.turns.filter((turn) => body.includes(turn.text));
  return surviving.length > 0 ? { ...record, turns: surviving } : undefined;
}
