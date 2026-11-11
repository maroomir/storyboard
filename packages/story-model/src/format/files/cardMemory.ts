import { createHash } from 'node:crypto';

import {
  backgroundPlaceFacts,
  formatCardAttributes,
  joinCardText,
} from '#model/format/card';
import type { BackgroundCard, CharacterCard } from '#model/format/card';
export function computePersonaCardHash(card: CharacterCard, promptFingerprint: string): string {
  const digestSource: Readonly<Record<string, unknown>> = {
    prompt: promptFingerprint,
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
  const digestSource: Readonly<Record<string, unknown>> = {
    type: card.type,
    id: card.id,
    name: card.name,
    description: joinCardText(card.description),
    time: card.time ?? '',
    weather: card.weather ?? '',
    senses: joinCardText(card.senses),
    tags: card.tags ?? [],
    ...backgroundPlaceFacts(card),
  };
  return digestCard(digestSource);
}

function digestCard(digestSource: unknown): string {
  const hash: string = createHash('sha256').update(JSON.stringify(digestSource)).digest('hex');
  return `sha256:${hash}`;
}

