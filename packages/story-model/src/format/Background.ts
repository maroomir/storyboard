import type { BackgroundCard, LocationBackgroundCard } from '#model/format/card';

export type Background = BackgroundCard;

export function createEmptyBackground(id: string, name: string): LocationBackgroundCard {
  return {
    type: 'location',
    id,
    name,
    characterIds: [],
    tags: [],
    description: [],
    senses: [],
  };
}
