import { readFile } from 'node:fs/promises';

import { storyboardRelativePaths, parseBackgroundMemory, parsePersonaMemory, serializeBackgroundMemory, serializePersonaMemory } from '@seedkernel/wasm';
import { computeBackgroundCardHash, computePersonaCardHash } from '../../../desktop/src/domain/files/storyFiles';
import type { BackgroundCard, CharacterCard } from '@seedkernel/wasm';
import type { IBackgroundMemoryStore, IPersonaMemoryStore } from '@storyboard/story-pipeline';

import type { ContentService } from '../content/contentService';
import type { WorkspaceStore } from '../workspace/workspaceStore';

function personaMemoryRelativePath(cardId: string): string {
  return `${storyboardRelativePaths().personaMemoryDirectory}/${cardId}.json`;
}

function backgroundMemoryRelativePath(cardId: string): string {
  return `${storyboardRelativePaths().backgroundMemoryDirectory}/${cardId}.json`;
}

// Same cache files the extension maintains: a stale record (card edited since) reads as a miss, and
// saves go through the mutate gate like every other bot write.
export function createPersonaMemoryStore(
  store: WorkspaceStore,
  content: ContentService,
  sceneStem: string,
): IPersonaMemoryStore {
  return {
    async load(card: CharacterCard): Promise<string | undefined> {
      try {
        const raw = await readFile(store.absolutePath(personaMemoryRelativePath(card.id)), 'utf8');
        const record = parsePersonaMemory(raw);
        return record.cardHash === computePersonaCardHash(card) ? record.persona : undefined;
      } catch {
        return undefined;
      }
    },
    async save(card: CharacterCard, persona: string): Promise<void> {
      await content.writeArtifact(
        personaMemoryRelativePath(card.id),
        serializePersonaMemory({
          cardId: card.id,
          persona,
          updatedThroughScene: sceneStem,
          cardHash: computePersonaCardHash(card),
        }),
      );
    },
  };
}

export function createBackgroundMemoryStore(
  store: WorkspaceStore,
  content: ContentService,
  sceneStem: string,
): IBackgroundMemoryStore {
  return {
    async load(card: BackgroundCard): Promise<string | undefined> {
      try {
        const raw = await readFile(
          store.absolutePath(backgroundMemoryRelativePath(card.id)),
          'utf8',
        );
        const record = parseBackgroundMemory(raw);
        return record.cardHash === computeBackgroundCardHash(card) ? record.atmosphere : undefined;
      } catch {
        return undefined;
      }
    },
    async save(card: BackgroundCard, atmosphere: string): Promise<void> {
      await content.writeArtifact(
        backgroundMemoryRelativePath(card.id),
        serializeBackgroundMemory({
          cardId: card.id,
          atmosphere,
          updatedThroughScene: sceneStem,
          cardHash: computeBackgroundCardHash(card),
        }),
      );
    },
  };
}
