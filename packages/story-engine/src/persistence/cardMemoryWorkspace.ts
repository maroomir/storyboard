import {
  joinStoryPath,
  type StoryUri,
  computeBackgroundCardHash,
  computeDraftBodyHash,
  computePersonaCardHash,
  parseDraft,
  readBackgroundMemoryFile,
  readDraftFile,
  readPersonaMemoryFile,
  parseSceneStem,
  readSceneDialogueFile,
  writeBackgroundMemoryFile,
  writePersonaMemoryFile,
  writeSceneDialogueFile,
} from '@storyboard/story-model';
import { promptResourceFingerprint } from '@storyboard/story-ai';
import type { IFileSystem } from '#engine/ports/fileSystem';
import { readDirectoryFiles } from '#engine/persistence/directoryFiles';
import type {
  StoryboardProjectPaths,
  BackgroundCard,
  CharacterCard,
  SceneDialogueRecord,
} from '@storyboard/story-model';
import type {
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

// 씬 N을 만드는 동안, N 이후까지 진화한 기억은 두 가지로 쓸 수 없다: 아직 오지 않은 씬의 정보를
// 담고 있고(스포일러), N을 다시 만든다면 그 기억이 전제한 판본이 폐기된다. 원장의 되감기와 같은
// 판정이다. 씬 번호를 읽을 수 없으면 근거가 없으므로 그대로 쓴다.
function isMemoryAheadOfScene(updatedThroughScene: string, sceneStem: string): boolean {
  const memoryOrder = parseSceneStem(updatedThroughScene)?.order;
  const currentOrder = parseSceneStem(sceneStem)?.order;

  return memoryOrder !== undefined && currentOrder !== undefined && memoryOrder >= currentOrder;
}

export function createPersonaMemoryStore(
  fs: IFileSystem,
  paths: StoryboardProjectPaths,
  sceneStem: string,
): IPersonaMemoryStore {
  // NOTE: 페르소나는 personaGeneration 프롬프트의 산출물이다. 그 문구(작가의 덮어쓰기 포함)를 키에
  // 넣어야 프롬프트를 고친 뒤에도 옛 문구로 만든 페르소나가 재사용되지 않는다.
  const promptFingerprint = promptResourceFingerprint('personaGeneration');

  return {
    async load(card: CharacterCard): Promise<string | undefined> {
      const uri = personaMemoryFilePath(paths, card.id);

      if (!(await fs.exists(uri))) {
        return undefined;
      }

      try {
        const record = await readPersonaMemoryFile(uri, fs);
        const isReusable =
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
      const uri = backgroundMemoryFilePath(paths, card.id);

      if (!(await fs.exists(uri))) {
        return undefined;
      }

      try {
        const record = await readBackgroundMemoryFile(uri, fs);
        const isReusable =
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
      const records = await readDirectoryFiles(fs, paths.sceneDialogueDirectory, {
        isEligible: (name) => name.endsWith('.json'),
        read: async (uri) =>
          await reconcileWithDraft(fs, paths, await readSceneDialogueFile(uri, fs)),
      });

      return records;
    },
  };
}

// NOTE: 초안은 생성 뒤에도 수정 루프와 사람 손을 거치므로 해시는 대개 어긋난다. 어긋났다고 기록을
// 통째로 버리면 코퍼스가 상시 비게 되고, 그대로 믿으면 원고에 없는 대사가 말투 표본이 된다.
// 그래서 지금 초안에 실제로 남아 있는 대사만 남긴다. 해시는 그 대조를 건너뛰는 빠른 길이다.
async function reconcileWithDraft(
  fs: IFileSystem,
  paths: StoryboardProjectPaths,
  record: SceneDialogueRecord,
): Promise<SceneDialogueRecord | undefined> {
  const draftUri = joinStoryPath(paths.draftDirectory, `${record.sceneStem}.md`);

  let body: string;
  try {
    body = parseDraft(await readDraftFile(draftUri, fs)).body;
  } catch {
    return undefined;
  }

  if (computeDraftBodyHash(body) === record.bodyHash) {
    return record;
  }

  const surviving = record.turns.filter((turn) => body.includes(turn.text));
  return surviving.length > 0 ? { ...record, turns: surviving } : undefined;
}
