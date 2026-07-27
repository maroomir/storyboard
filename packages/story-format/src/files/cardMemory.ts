import { createHash } from 'node:crypto';
import { z } from 'zod';

import { cardIdPattern, formatCardAttributes, joinCardText } from '../card';
import type { BackgroundCard, CharacterCard } from '../card';
export interface PersonaMemoryRecord {
  readonly cardId: string;
  readonly persona: string;
  readonly updatedThroughScene: string;
  readonly cardHash: string;
}

export interface BackgroundMemoryRecord {
  readonly cardId: string;
  readonly atmosphere: string;
  readonly updatedThroughScene: string;
  readonly cardHash: string;
}

export interface CardMemoryFileSystem {
  readonly readFile: (uri: unknown) => PromiseLike<Uint8Array>;
  readonly writeFile: (uri: unknown, content: Uint8Array) => PromiseLike<void>;
}

const cardHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

const personaMemoryRecordSchema = z.object({
  cardId: z.string().regex(cardIdPattern),
  persona: z.string(),
  updatedThroughScene: z.string(),
  cardHash: cardHashSchema,
});

const backgroundMemoryRecordSchema = z.object({
  cardId: z.string().regex(cardIdPattern),
  atmosphere: z.string(),
  updatedThroughScene: z.string(),
  cardHash: cardHashSchema,
});

export function serializePersonaMemory(record: PersonaMemoryRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

export function parsePersonaMemory(rawMemory: string): PersonaMemoryRecord {
  return personaMemoryRecordSchema.parse(JSON.parse(rawMemory));
}

export function serializeBackgroundMemory(record: BackgroundMemoryRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

export function parseBackgroundMemory(rawMemory: string): BackgroundMemoryRecord {
  return backgroundMemoryRecordSchema.parse(JSON.parse(rawMemory));
}

export function computePersonaCardHash(card: CharacterCard): string {
  const digestSource = {
    id: card.id,
    name: card.name,
    role: card.role,
    voice: joinCardText(card.voice),
    description: joinCardText(card.description),
    desire: joinCardText(card.desire),
    attributes: formatCardAttributes(card.attributes),
    traits: card.traits ?? [],
  };
  return digestCard(digestSource);
}

export function computeBackgroundCardHash(card: BackgroundCard): string {
  const digestSource = {
    type: card.type,
    id: card.id,
    name: card.name,
    description: joinCardText(card.description),
    time: card.time ?? '',
    weather: card.weather ?? '',
    senses: joinCardText(card.senses),
    tags: card.tags ?? [],
  };
  return digestCard(digestSource);
}

function digestCard(digestSource: unknown): string {
  const hash = createHash('sha256').update(JSON.stringify(digestSource)).digest('hex');
  return `sha256:${hash}`;
}

export async function readPersonaMemoryFile(
  uri: unknown,
  fileSystem: CardMemoryFileSystem,
): Promise<PersonaMemoryRecord> {
  const bytes = await fileSystem.readFile(uri);
  return parsePersonaMemory(new TextDecoder().decode(bytes));
}

export async function writePersonaMemoryFile(
  uri: unknown,
  fileSystem: CardMemoryFileSystem,
  record: PersonaMemoryRecord,
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(serializePersonaMemory(record)));
}

export async function readBackgroundMemoryFile(
  uri: unknown,
  fileSystem: CardMemoryFileSystem,
): Promise<BackgroundMemoryRecord> {
  const bytes = await fileSystem.readFile(uri);
  return parseBackgroundMemory(new TextDecoder().decode(bytes));
}

export async function writeBackgroundMemoryFile(
  uri: unknown,
  fileSystem: CardMemoryFileSystem,
  record: BackgroundMemoryRecord,
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(serializeBackgroundMemory(record)));
}
