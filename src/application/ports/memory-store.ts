import type { BackgroundCard, CharacterCard } from '../../shared/card';

export interface IPersonaMemoryStore {
  load(card: CharacterCard): Promise<string | undefined>;
  save(card: CharacterCard, persona: string): Promise<void>;
}

export interface IBackgroundMemoryStore {
  load(card: BackgroundCard): Promise<string | undefined>;
  save(card: BackgroundCard, atmosphere: string): Promise<void>;
}
