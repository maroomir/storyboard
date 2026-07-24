import * as vscode from 'vscode';

import type { StoryboardProjectPaths } from '../vscode/pathConventions';
import { uriExists } from '../vscode/workspace';
import { vscodeFsAdapter } from '../vscode/workspaceFsAdapters';
import type { BackgroundCard, CharacterCard } from '@storyboard/story-format';
import type {
  IBackgroundMemoryStore,
  IPersonaMemoryStore,
} from '../../application/ports/memoryStore';
import {
  computeBackgroundCardHash,
  computePersonaCardHash,
  readBackgroundMemoryFile,
  readPersonaMemoryFile,
  writeBackgroundMemoryFile,
  writePersonaMemoryFile,
} from '../../domain/files/cardMemory';

export async function ensurePersonaMemoryDirectory(paths: StoryboardProjectPaths): Promise<void> {
  await vscode.workspace.fs.createDirectory(paths.personaMemoryDirectory);
}

export async function ensureBackgroundMemoryDirectory(
  paths: StoryboardProjectPaths,
): Promise<void> {
  await vscode.workspace.fs.createDirectory(paths.backgroundMemoryDirectory);
}

export function personaMemoryFilePath(paths: StoryboardProjectPaths, cardId: string): vscode.Uri {
  return vscode.Uri.joinPath(paths.personaMemoryDirectory, `${cardId}.json`);
}

export function backgroundMemoryFilePath(
  paths: StoryboardProjectPaths,
  cardId: string,
): vscode.Uri {
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
