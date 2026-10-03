import type { IFileSystem } from '#engine/ports/fileSystem';
import type { AiGateway } from '#engine/application/ai/aiGateway';
import type { GenerateDraftUseCase } from '#engine/application/drafts/generateDraftUseCase';
import type { ReviseDraftUseCase } from '#engine/application/drafts/reviseDraftUseCase';
import type { AssembleManuscriptUseCase } from '#engine/application/manuscript/assembleManuscriptUseCase';
import type { SummarizeChaptersUseCase } from '#engine/application/manuscript/summarizeChaptersUseCase';
import type {
  StoryUri,
  StoryboardProject,
  NovelRunMode,
  NovelRunState,
  NovelStageName,
} from '@storyboard/story-model';
import type { IStoryboardLogger } from '#engine/ports/logger';
import type { AiProviderRegistry, ConfigBridge } from '@storyboard/story-ai';
import type { IUsageSink } from '#engine/ports/usageSink';
import type {
  INovelOutlineRepository,
  INovelReviewRepository,
  INovelRunStateRepository,
  ISceneSeedRepository,
} from './novelPipelinePorts';

export type NovelAiService = ReturnType<AiGateway['createService']>;

export interface NovelPipelineDependencies {
  readonly aiGateway: AiGateway;
  readonly aiProviderRegistry: AiProviderRegistry;
  readonly assembleManuscriptUseCase: AssembleManuscriptUseCase;
  readonly configBridge: ConfigBridge;
  readonly generateDraftUseCase: GenerateDraftUseCase;
  readonly logger: IStoryboardLogger;
  readonly novelReviewRepository: INovelReviewRepository;
  readonly novelRunStateRepository: INovelRunStateRepository;
  readonly outlineRepository: INovelOutlineRepository;
  readonly reviseDraftUseCase: ReviseDraftUseCase;
  readonly sceneSeedRepository: ISceneSeedRepository;
  readonly summarizeChaptersUseCase: SummarizeChaptersUseCase;
  readonly usageSink: IUsageSink;
  readonly fileSystem: IFileSystem;
}

export type NovelApprovalKind = 'outline' | 'chapter' | 'review';

export interface NovelPipelineRunOptions {
  readonly workspaceUri: StoryUri;
  readonly project: StoryboardProject;
  readonly runMode: NovelRunMode;
  readonly resumeState?: NovelRunState;
  readonly reviseMaxIterations: number;
  readonly onProgress: (stage: NovelStageName, message: string) => void;
  readonly requestApproval: (kind: NovelApprovalKind, info: string) => Promise<boolean>;
  readonly shouldCancel: () => boolean;
  // Stops at the next scene or stage boundary instead of abandoning the scene in progress, so a
  // budget stop or a pause button never throws away tokens already spent. The run resumes where
  // it stopped.
  readonly shouldPause?: () => boolean;
  // The stages to run, in order. Left out, the plan in force (the author's pipelines/novel.yaml
  // over the bundled order) applies.
  readonly stages?: readonly NovelStageName[];
}

export type NovelPipelineOptions = NovelPipelineRunOptions & {
  readonly deps: NovelPipelineDependencies;
};

export type NovelPipelineOutcome = 'completed' | 'paused' | 'cancelled' | 'failed';

export interface NovelPipelineResult {
  readonly outcome: NovelPipelineOutcome;
  readonly message: string;
}
