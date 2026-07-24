import type { ProjectFormat, SceneContext } from '@storyboard/story-format';
import type { IBackgroundMemoryStore, IPersonaMemoryStore } from './memoryStore';
import type {
  AiProviderId,
  SituationWithCharacters,
  StoryboardAIService,
  StyleDirective,
} from '@storyboard/story-ai';
export type SceneGenerationPipelineAiService = Pick<
  StoryboardAIService,
  | 'extractSituations'
  | 'createCharacterPersona'
  | 'describeBackground'
  | 'generatePersonaDialogue'
  | 'applyGenreFormat'
>;

export type SceneGenerationPipelineStage =
  | 'extractSituations'
  | 'buildPersonas'
  | 'generateDialogue'
  | 'applyFormat';

export interface SceneGenerationPipelineTaskProviders {
  readonly situationExtraction?: AiProviderId;
  readonly personaGeneration?: AiProviderId;
  readonly personaDialogue?: AiProviderId;
  readonly sceneDraft?: AiProviderId;
}

export type PersonaMemoryStore = IPersonaMemoryStore;
export type BackgroundMemoryStore = IBackgroundMemoryStore;

export class SceneGenerationPipelineCancelledError extends Error {
  public constructor() {
    super('씬 초안 생성이 취소되었습니다.');
    this.name = 'SceneGenerationPipelineCancelledError';
  }
}

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
  readonly useContextCondense?: boolean;
  readonly personaStore?: PersonaMemoryStore;
  readonly backgroundStore?: BackgroundMemoryStore;
  readonly sceneBreakJoiner?: string;
}

export interface RunSceneGenerationPipelineResult {
  readonly draftBody: string;
  readonly detectedCharacters: readonly string[];
  readonly situations: readonly SituationWithCharacters[];
  readonly personasUsed: ReadonlyMap<string, string>;
  readonly providers: Readonly<SceneGenerationPipelineTaskProviders>;
}
