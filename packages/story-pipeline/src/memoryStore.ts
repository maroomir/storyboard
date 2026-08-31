import type {
  BackgroundCard,
  CharacterCard,
  SceneDialogueRecord,
} from '@storyboard/story-format';

export interface IPersonaMemoryStore {
  load(card: CharacterCard): Promise<string | undefined>;
  save(card: CharacterCard, persona: string): Promise<void>;
}

export interface IBackgroundMemoryStore {
  load(card: BackgroundCard): Promise<string | undefined>;
  save(card: BackgroundCard, atmosphere: string): Promise<void>;
}

// 파이프라인은 코퍼스를 읽기만 한다. 쓰기는 초안을 디스크에 쓴 뒤 호출자가 한다.
export interface ISceneDialogueCorpus {
  loadCorpus(): Promise<readonly SceneDialogueRecord[]>;
}

export interface ISceneDialogueStore extends ISceneDialogueCorpus {
  save(record: SceneDialogueRecord): Promise<void>;
}
