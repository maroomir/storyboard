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

// 카드 줄이 같으면 답도 같으므로 상충 판정은 카드가 바뀔 때만 다시 부른다. undefined 는 판정한 적 없음.
export interface IBackgroundFactConflictStore {
  load(card: BackgroundCard): Promise<readonly BackgroundFactConflict[] | undefined>;
  save(card: BackgroundCard, conflicts: readonly BackgroundFactConflict[]): Promise<void>;
}

// 파이프라인은 코퍼스를 읽기만 한다. 쓰기는 초안을 디스크에 쓴 뒤 호출자가 한다.
export interface ISceneDialogueCorpus {
  loadCorpus(): Promise<readonly SceneDialogueRecord[]>;
  // 노트에서 옮긴 인물별 예시 대사. 코퍼스가 표본 한도를 못 채울 때만 쓴다.
  loadVoiceSeeds?(): Promise<VoiceSeeds>;
}

export interface ISceneDialogueStore extends ISceneDialogueCorpus {
  save(record: SceneDialogueRecord): Promise<void>;
}
