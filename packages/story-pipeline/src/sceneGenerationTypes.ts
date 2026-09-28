import type {
  ProjectFormat,
  SceneContext,
  SceneDialogueRecord,
} from '@storyboard/story-format';
import type {
  IBackgroundMemoryStore,
  IPersonaMemoryStore,
  ISceneDialogueCorpus,
  ISceneDialogueStore,
} from './memoryStore';
import type { AiProviderId, StoryboardAiService, StyleDirective } from '@storyboard/story-ai';
import type { SceneGenerationTuning } from './sceneGenerationTuning';
import type { SceneStageId } from './sceneStageCatalog';
export type SceneGenerationPipelineAiService = Pick<
  StoryboardAiService,
  | 'createCharacterPersona'
  | 'describeBackground'
  | 'draftSceneSkeleton'
  | 'polishSceneDialogue'
  | 'attributeSceneDialogue'
  | 'expandSceneSection'
>;

export type SceneGenerationPipelineStage =
  | 'buildPersonas'
  | 'draftSkeleton'
  | 'polishDialogue'
  | 'attributeDialogue'
  | 'expandSection';

export interface SceneGenerationPipelineTaskProviders {
  readonly personaGeneration?: AiProviderId;
  readonly sceneSkeleton?: AiProviderId;
  readonly sceneDialoguePolish?: AiProviderId;
  readonly sceneDialogueAttribution?: AiProviderId;
  readonly sceneSectionExpansion?: AiProviderId;
}

export type PersonaMemoryStore = IPersonaMemoryStore;
export type BackgroundMemoryStore = IBackgroundMemoryStore;
export type SceneDialogueStore = ISceneDialogueStore;
export type SceneDialogueCorpus = ISceneDialogueCorpus;

export class SceneGenerationPipelineCancelledError extends Error {
  public constructor() {
    super('씬 초안 생성이 취소되었습니다.');
    this.name = 'SceneGenerationPipelineCancelledError';
  }
}

export type { SceneGenerationTuning } from './sceneGenerationTuning';

export interface RunSceneGenerationPipelineInput {
  readonly context: SceneContext;
  readonly aiService: SceneGenerationPipelineAiService;
  readonly format: ProjectFormat;
  readonly styleDirective?: StyleDirective;
  readonly previousContext?: string;
  readonly providers?: Readonly<SceneGenerationPipelineTaskProviders>;
  readonly onProgress?: (
    stage: SceneGenerationPipelineStage,
    current: number,
    total: number,
  ) => void;
  readonly shouldCancel?: () => boolean;
  readonly sceneStem?: string;
  readonly backgroundId?: string;
  readonly canonFactLines?: readonly string[];
  readonly useContextCondense?: boolean;
  // 한 번의 살붙임 호출이 낼 수 있는 최대 글자 수. 목표 분량을 이 값으로 나눠 구간 수가 정해진다.
  readonly sectionOutputLimit?: number;
  // 모델마다 실측으로 달리 잡는 손잡이. 생략한 값은 파이프라인 기본값을 쓴다.
  readonly tuning?: SceneGenerationTuning;
  readonly personaStore?: PersonaMemoryStore;
  readonly backgroundStore?: BackgroundMemoryStore;
  readonly dialogueCorpus?: SceneDialogueCorpus;
  // 같은 장소가 다시 나올 때 직전 등장 씬에서 뽑은 발췌. 있으면 배경 묘사를 캐시 대신 갱신한다.
  readonly backgroundRecentExcerpt?: string;
  // The stages to run, in order. Left out, the plan in force (the author's pipelines/scene.yaml
  // over the bundled order) applies.
  readonly stages?: readonly SceneStageId[];
}

export interface RunSceneGenerationPipelineResult {
  readonly draftBody: string;
  // 1단계 산출물. 사건·등장·종료 지점이 여기서 확정되므로 캐시와 디버깅의 기준이 된다.
  readonly skeleton: string;
  // 재시도로도 못 고친 검증 위반. 원고 헤더에 실려 읽는 사람에게 보인다.
  readonly warnings: readonly string[];
  readonly detectedCharacters: readonly string[];
  readonly personasUsed: ReadonlyMap<string, string>;
  readonly providers: Readonly<SceneGenerationPipelineTaskProviders>;
  // 완성된 초안 본문의 대사 귀속. 호출자가 초안을 쓴 뒤 저장한다.
  readonly dialogueRecord?: SceneDialogueRecord;
}
