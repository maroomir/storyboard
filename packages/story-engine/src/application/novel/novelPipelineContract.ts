import type { AiGateway } from '#engine/application/ai/aiGateway';
import type {
  StoryUri,
  StoryboardProject,
  NovelRunMode,
  NovelRunState,
  NovelStageName,
} from '@storyboard/story-model';
import type {
  AiServices,
  HostAdapters,
  WorkspaceRepositories,
} from '#engine/application/engineServices';
import type { AssembleManuscriptUseCase } from '#engine/application/manuscript/assembleManuscriptUseCase';
import type { GenerateDraftUseCase } from '#engine/application/drafts/generateDraftUseCase';
import type { ReviseDraftUseCase } from '#engine/application/drafts/reviseDraftUseCase';
import type { SummarizeChaptersUseCase } from '#engine/application/manuscript/summarizeChaptersUseCase';
import type { ReviseSeedIssues } from '#engine/pipeline/reviseLoop';

export type NovelAiService = ReturnType<AiGateway['createService']>;

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
  readonly shouldPause?: () => boolean;
  readonly stages?: readonly NovelStageName[];
}

export interface NovelPipelineServices {
  readonly host: HostAdapters;
  readonly ai: AiServices;
  readonly repositories: WorkspaceRepositories;
  readonly collaborators: NovelPipelineCollaborators;
}

export type NovelPipelineOptions = NovelPipelineRunOptions & {
  readonly deps: NovelPipelineServices;
};

export type NovelPipelineOutcome = 'completed' | 'paused' | 'cancelled' | 'failed';

export interface NovelPipelineResult {
  readonly outcome: NovelPipelineOutcome;
  readonly message: string;
}

export interface ReviewTarget {
  readonly sceneStem: string;
  readonly seedIssues: ReviseSeedIssues;
}

export interface ReviewStageResult {
  readonly targets: readonly ReviewTarget[];
  readonly highCount: number;
}

export interface NovelPipelineCollaborators {
  readonly assembleManuscriptUseCase: AssembleManuscriptUseCase;
  readonly generateDraftUseCase: GenerateDraftUseCase;
  readonly reviseDraftUseCase: ReviseDraftUseCase;
  readonly summarizeChaptersUseCase: SummarizeChaptersUseCase;
}
