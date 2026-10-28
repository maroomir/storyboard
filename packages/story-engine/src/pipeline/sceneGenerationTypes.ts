import type {
  ProjectFormat,
  SceneContext,
  SceneDialogueRecord,
  AiProviderId,
  StyleDirective,
} from '@storyboard/story-model';
import type {
  IBackgroundFactConflictStore,
  IBackgroundMemoryStore,
  IPersonaMemoryStore,
  ISceneDialogueCorpus,
} from './memoryStore';
import type { StoryboardAiService } from '@storyboard/story-ai';
import type { SceneGenerationTuning } from './sceneGenerationTuning';
import type { SceneStageId } from './sceneStageCatalog';
export type SceneGenerationPipelineAiService = Pick<
  StoryboardAiService,
  | 'createCharacterPersona'
  | 'describeBackground'
  | 'findBackgroundFactConflicts'
  | 'draftSceneSkeleton'
  | 'checkSceneCoverage'
  | 'proposeBeatAction'
  | 'arbitrateBeat'
  | 'judgeBeat'
  | 'polishSceneDialogue'
  | 'attributeSceneDialogue'
  | 'expandSceneSection'
>;

export type SceneGenerationPipelineStage =
  | 'buildPersonas'
  | 'draftSkeleton'
  | 'actBeats'
  | 'polishDialogue'
  | 'attributeDialogue'
  | 'expandSection';

export interface SceneGenerationPipelineTaskProviders {
  readonly personaGeneration?: AiProviderId;
  readonly sceneSkeleton?: AiProviderId;
  readonly sceneBeatActor?: AiProviderId;
  readonly sceneBeatArbiter?: AiProviderId;
  readonly sceneBeatJudge?: AiProviderId;
  readonly sceneDialoguePolish?: AiProviderId;
  readonly sceneDialogueAttribution?: AiProviderId;
  readonly sceneSectionExpansion?: AiProviderId;
}

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
  readonly characterKnowledge?: ReadonlyMap<string, readonly string[]>;
  readonly characterRelations?: ReadonlyMap<string, readonly string[]>;
  readonly useContextCondense?: boolean;
  readonly sectionOutputLimit?: number;
  readonly tuning?: SceneGenerationTuning;
  readonly personaStore?: IPersonaMemoryStore;
  readonly backgroundStore?: IBackgroundMemoryStore;
  readonly backgroundFactConflictStore?: IBackgroundFactConflictStore;
  readonly dialogueCorpus?: ISceneDialogueCorpus;
  readonly backgroundRecentExcerpt?: string;
  readonly stages?: readonly SceneStageId[];
}

export interface DialoguePolishSummary {
  readonly lineCount: number;
  readonly polishedCount: number;
  readonly contestedCount: number;
}

export interface RunSceneGenerationPipelineResult {
  readonly draftBody: string;
  readonly skeleton: string;
  readonly sceneCoordinates: readonly string[];
  readonly warnings: readonly string[];
  readonly detectedCharacters: readonly string[];
  readonly personasUsed: ReadonlyMap<string, string>;
  readonly providers: Readonly<SceneGenerationPipelineTaskProviders>;
  readonly dialogueRecord?: SceneDialogueRecord;
  readonly dialoguePolish?: DialoguePolishSummary;
}
