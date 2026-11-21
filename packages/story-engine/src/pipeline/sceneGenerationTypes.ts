import type {
  ProjectFormat,
  SceneContext,
  SceneDialogueRecord,
  AiProviderId,
  SectionViolationKind,
  StyleDirective,
  TraceBeatVerdict,
  TraceDialogueLineChange,
  TraceEventKind,
  TraceSectionLengthName,
} from '@storyboard/story-model';
import type {
  IBackgroundFactConflictStore,
  IBackgroundMemoryStore,
  IPersonaMemoryStore,
  ISceneDialogueCorpus,
} from '#engine/pipeline/memoryStore';
import type { StoryboardAiService } from '@storyboard/story-ai';
import type { SceneGenerationTuning } from '#engine/pipeline/sceneGenerationTuning';
import type { SceneStageId } from '#engine/pipeline/sceneStageCatalog';
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
  | 'proofreadSceneText'
  | 'expandSceneSection'
>;

export type SceneGenerationPipelineStage =
  | 'buildPersonas'
  | 'draftSkeleton'
  | 'actBeats'
  | 'polishDialogue'
  | 'attributeDialogue'
  | 'expandSection'
  | 'proofreadDraft';

export interface SceneGenerationPipelineTaskProviders {
  readonly personaGeneration?: AiProviderId;
  readonly sceneSkeleton?: AiProviderId;
  readonly sceneBeatActor?: AiProviderId;
  readonly sceneBeatArbiter?: AiProviderId;
  readonly sceneBeatJudge?: AiProviderId;
  readonly sceneDialoguePolish?: AiProviderId;
  readonly sceneDialogueAttribution?: AiProviderId;
  readonly sceneSectionExpansion?: AiProviderId;
  readonly sceneProofread?: AiProviderId;
}

export class SceneGenerationPipelineCancelledError extends Error {
  public constructor() {
    super('씬 초안 생성이 취소되었습니다.');
    this.name = 'SceneGenerationPipelineCancelledError';
  }
}

export type { SceneGenerationTuning } from '#engine/pipeline/sceneGenerationTuning';

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
  readonly observer?: IScenePipelineObserver;
}

export interface ScenePipelineEvent {
  readonly kind: TraceEventKind;
  readonly sectionIndex?: number;
  readonly attempt?: number;
  readonly rule?: string;
  readonly reasons?: readonly string[];
  readonly message?: string;
  readonly beforeText?: string;
  readonly afterText?: string;
  readonly lengths?: Readonly<Partial<Record<TraceSectionLengthName, number>>>;
  readonly beats?: readonly TraceBeatVerdict[];
  readonly beatNumbers?: readonly number[];
  readonly startOffset?: number;
  readonly subject?: string;
  readonly lines?: readonly TraceDialogueLineChange[];
}

export interface IScenePipelineObserver {
  onPlan(stageIds: readonly SceneStageId[]): void;
  onEvent(event: ScenePipelineEvent): void;
  onStageStart(stageId: SceneStageId): void;
  onStageEnd(stageId: SceneStageId, failure?: unknown): void;
}

export interface DialoguePolishSummary {
  readonly lineCount: number;
  readonly polishedCount: number;
  readonly contestedCount: number;
}

export interface SceneWarning {
  readonly message: string;
  readonly kinds?: readonly SectionViolationKind[];
  readonly sectionNumber?: number;
}

export interface SceneStageWarning extends SceneWarning {
  readonly stage: SceneStageId;
}

export interface RunSceneGenerationPipelineResult {
  readonly draftBody: string;
  readonly skeleton: string;
  readonly sceneCoordinates: readonly string[];
  readonly warnings: readonly SceneStageWarning[];
  readonly detectedCharacters: readonly string[];
  readonly personasUsed: ReadonlyMap<string, string>;
  readonly providers: Readonly<SceneGenerationPipelineTaskProviders>;
  readonly dialogueRecord?: SceneDialogueRecord;
  readonly dialoguePolish?: DialoguePolishSummary;
}
