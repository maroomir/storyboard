import type {
  BackgroundCard,
  BackgroundFactConflict,
  CharacterCard,
  SceneDialogueRecord,
  VoiceSeeds,
} from '@storyboard/story-model';

export interface IPersonaMemoryStore {
  load(card: CharacterCard): Promise<string | undefined>;
  save(card: CharacterCard, persona: string): Promise<void>;
}

export interface IBackgroundMemoryStore {
  load(card: BackgroundCard): Promise<string | undefined>;
  save(card: BackgroundCard, atmosphere: string): Promise<void>;
}

export interface IBackgroundFactConflictStore {
  load(card: BackgroundCard): Promise<readonly BackgroundFactConflict[] | undefined>;
  save(card: BackgroundCard, conflicts: readonly BackgroundFactConflict[]): Promise<void>;
}

export interface ISceneDialogueCorpus {
  loadCorpus(): Promise<readonly SceneDialogueRecord[]>;
  loadVoiceSeeds?(): Promise<VoiceSeeds>;
}

export interface ISceneDialogueStore extends ISceneDialogueCorpus {
  save(record: SceneDialogueRecord): Promise<void>;
}
