import type * as vscode from 'vscode';

import type { AiGateway } from '../ai/aiGateway';
import type { GenerateDraftUseCase } from '../drafts/generateDraftUseCase';
import type { ReviseDraftUseCase } from '../drafts/reviseDraftUseCase';
import type { AssembleManuscriptUseCase } from '../manuscript/assembleManuscriptUseCase';
import type { SummarizeChaptersUseCase } from '../manuscript/summarizeChaptersUseCase';
import type { StoryboardLogger } from '../../infrastructure/vscode/logger';
import type { NovelRunMode, NovelRunState, NovelStageName } from '../../domain/files/novelRunState';
import type { AiProviderRegistry, ConfigBridge } from '@storyboard/story-ai';
import type { UsageRecorder } from '../../infrastructure/ai/UsageRecorder';
import type { StoryboardProject } from '@seedkernel/wasm';
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
  readonly logger: StoryboardLogger;
  readonly novelReviewRepository: INovelReviewRepository;
  readonly novelRunStateRepository: INovelRunStateRepository;
  readonly outlineRepository: INovelOutlineRepository;
  readonly reviseDraftUseCase: ReviseDraftUseCase;
  readonly sceneSeedRepository: ISceneSeedRepository;
  readonly summarizeChaptersUseCase: SummarizeChaptersUseCase;
  readonly usageRecorder: UsageRecorder;
}

export type NovelApprovalKind = 'outline' | 'chapter';

export interface NovelPipelineRunOptions {
  readonly workspaceUri: vscode.Uri;
  readonly project: StoryboardProject;
  readonly runMode: NovelRunMode;
  readonly resumeState?: NovelRunState;
  readonly reviseMaxIterations: number;
  readonly onProgress: (stage: NovelStageName, message: string) => void;
  readonly requestApproval: (kind: NovelApprovalKind, info: string) => Promise<boolean>;
  readonly shouldCancel: () => boolean;
}

export type NovelPipelineOptions = NovelPipelineRunOptions & {
  readonly deps: NovelPipelineDependencies;
};

export type NovelPipelineOutcome = 'completed' | 'paused' | 'cancelled' | 'failed';

export interface NovelPipelineResult {
  readonly outcome: NovelPipelineOutcome;
  readonly message: string;
}
