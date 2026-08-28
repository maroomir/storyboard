import type { ProjectFormat, SceneContext } from '@storyboard/story-format';
import type { IBackgroundMemoryStore, IPersonaMemoryStore } from './memoryStore';
import type { AiProviderId, StoryboardAIService, StyleDirective } from '@storyboard/story-ai';
export type SceneGenerationPipelineAiService = Pick<
  StoryboardAIService,
  'createCharacterPersona' | 'describeBackground' | 'draftSceneSkeleton' | 'expandSceneSection'
>;

export type SceneGenerationPipelineStage = 'buildPersonas' | 'draftSkeleton' | 'expandSection';

export interface SceneGenerationPipelineTaskProviders {
  readonly personaGeneration?: AiProviderId;
  readonly sceneSkeleton?: AiProviderId;
  readonly sceneSectionExpansion?: AiProviderId;
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
  readonly canonFactLines?: readonly string[];
  readonly useContextCondense?: boolean;
  readonly personaStore?: PersonaMemoryStore;
  readonly backgroundStore?: BackgroundMemoryStore;
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
}
