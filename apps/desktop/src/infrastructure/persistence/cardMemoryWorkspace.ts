import * as vscode from 'vscode';

import type { StoryboardProjectPaths } from '@storyboard/story-engine';
import { uriExists } from '../vscode/workspace';
import { vscodeFsAdapter } from '../vscode/workspaceFsAdapters';
import type { BackgroundCard, CharacterCard, SceneDialogueRecord } from '@storyboard/story-format';
import type {
  IBackgroundMemoryStore,
  IPersonaMemoryStore,
  ISceneDialogueStore,
} from '@storyboard/story-pipeline';
import {
  computeBackgroundCardHash,
  computeDraftBodyHash,
  computePersonaCardHash,
  parseDraft,
  readBackgroundMemoryFile,
  readDraftFile,
  readPersonaMemoryFile,
  readSceneDialogueFile,
  writeBackgroundMemoryFile,
  writePersonaMemoryFile,
  writeSceneDialogueFile,
} from '@storyboard/story-format';

async function ensurePersonaMemoryDirectory(paths: StoryboardProjectPaths): Promise<void> {
  await vscode.workspace.fs.createDirectory(paths.personaMemoryDirectory);
}

async function ensureBackgroundMemoryDirectory(paths: StoryboardProjectPaths): Promise<void> {
  await vscode.workspace.fs.createDirectory(paths.backgroundMemoryDirectory);
}

function personaMemoryFilePath(paths: StoryboardProjectPaths, cardId: string): vscode.Uri {
  return vscode.Uri.joinPath(paths.personaMemoryDirectory, `${cardId}.json`);
}

function backgroundMemoryFilePath(paths: StoryboardProjectPaths, cardId: string): vscode.Uri {
  return vscode.Uri.joinPath(paths.backgroundMemoryDirectory, `${cardId}.json`);
}

export function createPersonaMemoryStore(
  paths: StoryboardProjectPaths,
  sceneStem: string,
): IPersonaMemoryStore {
  return {
    async load(card: CharacterCard): Promise<string | undefined> {
      const uri = personaMemoryFilePath(paths, card.id);

      if (!(await uriExists(uri))) {
        return undefined;
      }

      try {
        const record = await readPersonaMemoryFile(uri, vscodeFsAdapter);
        return record.cardHash === computePersonaCardHash(card) ? record.persona : undefined;
      } catch {
        return undefined;
      }
    },
    async save(card: CharacterCard, persona: string): Promise<void> {
      await ensurePersonaMemoryDirectory(paths);
      await writePersonaMemoryFile(personaMemoryFilePath(paths, card.id), vscodeFsAdapter, {
        cardId: card.id,
        persona,
        updatedThroughScene: sceneStem,
        cardHash: computePersonaCardHash(card),
      });
    },
  };
}

export function createBackgroundMemoryStore(
  paths: StoryboardProjectPaths,
  sceneStem: string,
): IBackgroundMemoryStore {
  return {
    async load(card: BackgroundCard): Promise<string | undefined> {
      const uri = backgroundMemoryFilePath(paths, card.id);

      if (!(await uriExists(uri))) {
        return undefined;
      }

      try {
        const record = await readBackgroundMemoryFile(uri, vscodeFsAdapter);
        return record.cardHash === computeBackgroundCardHash(card) ? record.atmosphere : undefined;
      } catch {
        return undefined;
      }
    },
    async save(card: BackgroundCard, atmosphere: string): Promise<void> {
      await ensureBackgroundMemoryDirectory(paths);
      await writeBackgroundMemoryFile(backgroundMemoryFilePath(paths, card.id), vscodeFsAdapter, {
        cardId: card.id,
        atmosphere,
        updatedThroughScene: sceneStem,
        cardHash: computeBackgroundCardHash(card),
      });
    },
  };
}

function sceneDialogueFilePath(paths: StoryboardProjectPaths, sceneStem: string): vscode.Uri {
  return vscode.Uri.joinPath(paths.sceneDialogueDirectory, `${sceneStem}.json`);
}

export function createSceneDialogueStore(paths: StoryboardProjectPaths): ISceneDialogueStore {
  return {
    async save(record: SceneDialogueRecord): Promise<void> {
      await vscode.workspace.fs.createDirectory(paths.sceneDialogueDirectory);
      await writeSceneDialogueFile(
        sceneDialogueFilePath(paths, record.sceneStem),
        vscodeFsAdapter,
        record,
      );
    },
    async loadCorpus(): Promise<readonly SceneDialogueRecord[]> {
      let entries: [string, vscode.FileType][];
      try {
        entries = await vscode.workspace.fs.readDirectory(paths.sceneDialogueDirectory);
      } catch {
        return [];
      }

      const records: SceneDialogueRecord[] = [];
      for (const [name, fileType] of entries) {
        if (fileType !== vscode.FileType.File || !name.endsWith('.json')) {
          continue;
        }

        try {
          const record = await readSceneDialogueFile(
            vscode.Uri.joinPath(paths.sceneDialogueDirectory, name),
            vscodeFsAdapter,
          );

          const reconciled = await reconcileWithDraft(paths, record);
          if (reconciled) {
            records.push(reconciled);
          }
        } catch {
          continue;
        }
      }

      return records;
    },
  };
}

// NOTE: 초안은 생성 뒤에도 수정 루프와 사람 손을 거치므로 해시는 대개 어긋난다. 어긋났다고 기록을
// 통째로 버리면 코퍼스가 상시 비게 되고, 그대로 믿으면 원고에 없는 대사가 말투 표본이 된다.
// 그래서 지금 초안에 실제로 남아 있는 대사만 남긴다. 해시는 그 대조를 건너뛰는 빠른 길이다.
async function reconcileWithDraft(
  paths: StoryboardProjectPaths,
  record: SceneDialogueRecord,
): Promise<SceneDialogueRecord | undefined> {
  const draftUri = vscode.Uri.joinPath(paths.draftDirectory, `${record.sceneStem}.md`);

  let body: string;
  try {
    body = parseDraft(await readDraftFile(draftUri, vscodeFsAdapter)).body;
  } catch {
    return undefined;
  }

  if (computeDraftBodyHash(body) === record.bodyHash) {
    return record;
  }

  const surviving = record.turns.filter((turn) => body.includes(turn.text));
  return surviving.length > 0 ? { ...record, turns: surviving } : undefined;
}
