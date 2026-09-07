import type { StoryboardAiService } from '@storyboard/story-ai';
import {
  AssembleManuscriptUseCase,
  ManuscriptAssemblyRepository,
  NodeUri,
  validateGenerationContract,
  type IStoryboardLogger,
} from '@storyboard/story-engine';
import {
  STORYBOARD_RELATIVE_PATHS,
  contractFieldLabels,
  parseSynopsisMarkdown,
  serializeChapterPlan,
  serializeSynopsisMarkdown,
  toOutlineBrief,
  type OutlineCharacterBrief,
  type StoryboardProject,
} from '@storyboard/story-format';

import { BotFileSystem } from './engineAdapters';

import type { ContentService } from '@/content/contentService';
import type { MutateOutcome } from '@/workspace/workspaceChanges';
import type { WorkspaceStore } from '@/workspace/workspaceStore';
import type { IPipeline, PipelineContext } from './pipelineRunner';
import type { GenJob, PipelineResult } from './types';

// Tracked outputs follow decision #14: the chat handler captures the file's content hash at
// enqueue time into job.options.baselineHash, and the mutate gate refuses the write when Desktop
// changed the file while the job was running. `null` records "file did not exist at enqueue".
function enqueueBaseline(job: GenJob): string | undefined {
  const value = job.options['baselineHash'];
  return typeof value === 'string' ? value : undefined;
}

function writeFailure(outcome: MutateOutcome): PipelineResult | undefined {
  if (outcome.status === 'write-failed') {
    return { success: false, failureReason: 'provider_error', errorMessage: outcome.detail };
  }
  if (outcome.status === 'commit-failed') {
    return {
      success: false,
      failureReason: 'provider_error',
      errorMessage: `파일은 저장됐지만 커밋에 실패했습니다: ${outcome.paths.join(', ')}`,
    };
  }
  if (outcome.status === 'blocked') {
    return { success: false, failureReason: 'provider_error', errorMessage: outcome.detail };
  }
  if (outcome.status === 'stale') {
    const files = outcome.files.map((file) => file.relativePath).join(', ');
    return {
      success: false,
      failureReason: 'workspace_conflict',
      errorMessage: `작업 시작 후 Desktop에서 변경되어 저장하지 않았습니다: ${files}. 다시 실행해주세요.`,
    };
  }
  return undefined;
}

// The outline is the one generation whose entire input is the project contract, so an unfilled
// contract cannot be recovered from later — it produces a plausible synopsis about nothing. Desktop
// and the CLI both refuse here; the bot must refuse identically or the three apps disagree about
// what a valid project is.
function contractFailure(project: StoryboardProject): PipelineResult | undefined {
  const missing = validateGenerationContract(project.setting).missing;

  if (missing.length === 0) {
    return undefined;
  }

  const labels = missing.map((key) => contractFieldLabels[key]).join(', ');
  return {
    success: false,
    failureReason: 'provider_error',
    errorMessage: `작품 계약이 비어 있습니다: ${labels}. /set 으로 채운 뒤 다시 실행해주세요.`,
  };
}

export interface WorkspacePipelineOptions {
  readonly store: WorkspaceStore;
  readonly content: ContentService;
  readonly aiService: StoryboardAiService;
}

export class OutlinePipeline implements IPipeline {
  public constructor(private readonly options: WorkspacePipelineOptions) {}

  public async run(job: GenJob, context: PipelineContext): Promise<PipelineResult> {
    await context.reportStage('프로젝트 읽기');
    const project = await this.options.store.readProject();
    const contractFailed = contractFailure(project.value);
    if (contractFailed !== undefined) {
      return contractFailed;
    }
    const brief = toOutlineBrief(project.value);

    await context.reportStage('시놉시스 생성');
    const synopsis = await this.options.aiService.generateOutlineSynopsis(brief);
    if (context.isCancelled()) {
      return { success: false, failureReason: 'cancelled' };
    }

    await context.reportStage('저장');
    const relativePath = STORYBOARD_RELATIVE_PATHS.outlineSynopsis;
    const outcome = await this.options.content.writeTracked(
      relativePath,
      serializeSynopsisMarkdown(synopsis),
      enqueueBaseline(job),
      `storyboard-bot: generate ${relativePath}`,
    );

    return writeFailure(outcome) ?? { success: true, resultRef: relativePath };
  }
}

export class PlanPipeline implements IPipeline {
  public constructor(private readonly options: WorkspacePipelineOptions) {}

  public async run(job: GenJob, context: PipelineContext): Promise<PipelineResult> {
    await context.reportStage('시놉시스 읽기');
    const synopsisFile = await this.options.store.readSynopsis();
    if (synopsisFile === undefined) {
      return {
        success: false,
        failureReason: 'provider_error',
        errorMessage: '시놉시스가 없습니다. 먼저 /outline 을 실행해주세요.',
      };
    }

    const project = await this.options.store.readProject();
    const contractFailed = contractFailure(project.value);
    if (contractFailed !== undefined) {
      return contractFailed;
    }
    const brief = toOutlineBrief(project.value);
    const synopsis = parseSynopsisMarkdown(synopsisFile.value);
    const characters = await this.loadCharacterBriefs();

    await context.reportStage('챕터 구성');
    const plan = await this.options.aiService.generateChapterPlan(brief, synopsis, characters);
    if (context.isCancelled()) {
      return { success: false, failureReason: 'cancelled' };
    }

    await context.reportStage('저장');
    const relativePath = STORYBOARD_RELATIVE_PATHS.outlineChapters;
    const outcome = await this.options.content.writeTracked(
      relativePath,
      serializeChapterPlan(plan),
      enqueueBaseline(job),
      `storyboard-bot: generate ${relativePath}`,
    );

    return writeFailure(outcome) ?? { success: true, resultRef: relativePath };
  }

  private async loadCharacterBriefs(): Promise<OutlineCharacterBrief[]> {
    const summaries = await this.options.store.listCards();
    const briefs: OutlineCharacterBrief[] = [];

    for (const summary of summaries) {
      if (summary.kind !== 'character') {
        continue;
      }
      const card = await this.options.store.readCard('character', summary.id);
      if (card.value.type === 'character') {
        briefs.push({ id: card.value.id, name: card.value.name, role: card.value.role });
      }
    }

    return briefs;
  }
}

export class ManuscriptPipeline implements IPipeline {
  public constructor(private readonly options: WorkspacePipelineOptions) {}

  public async run(_job: GenJob, context: PipelineContext): Promise<PipelineResult> {
    await context.reportStage('원고 조립');
    const workspaceRoot = NodeUri.file(this.options.store.root);
    // `manuscript/` is gitignored, so the engine's plain writes land as artefacts and commit
    // nothing — the same outcome the pipeline used to get from ContentService.writeArtifact.
    const fileSystem = new BotFileSystem(this.options.content, workspaceRoot);
    const useCase = new AssembleManuscriptUseCase(
      createJobLogger(context),
      new ManuscriptAssemblyRepository(fileSystem),
    );

    const result = await useCase.execute(workspaceRoot);

    if (!result.ok) {
      return { success: false, failureReason: 'provider_error', errorMessage: describe(result) };
    }

    context.log(
      '조립',
      `씬 ${result.result.includedCount}개 포함, ${result.result.missingCount}개 미생성, 계획 외 ${result.result.extraCount}개, 복선 ${result.result.foreshadowingCount}건`,
    );
    return { success: true, resultRef: STORYBOARD_RELATIVE_PATHS.manuscriptVolume };
  }
}

// The engine's warnings (an unreadable draft, a scene missing from the plan) belong in the job log
// where /joblog can show them, not on the operator's console.
function createJobLogger(context: PipelineContext): IStoryboardLogger {
  return {
    info: (message) => context.log('조립', message),
    warn: (message) => context.log('조립', message),
    error: (message) => context.log('조립', message, 'error'),
    show: () => undefined,
  };
}

function describe(result: { readonly kind: string; readonly message?: string }): string {
  switch (result.kind) {
    case 'missing_outline':
      return '챕터 계획이 없습니다. 먼저 /plan 을 실행해주세요.';
    case 'missing_drafts':
      return '조립할 초안이 없습니다. 먼저 /draft 로 씬을 생성해주세요.';
    default:
      return result.message ?? '원고를 조립하지 못했습니다.';
  }
}

// Routes a job to its pipeline by kind. Registering a new kind here is the only wiring a new
// generation command needs on the execution side.
export class KindDispatchPipeline implements IPipeline {
  public constructor(private readonly pipelines: Partial<Record<GenJob['kind'], IPipeline>>) {}

  public async run(job: GenJob, context: PipelineContext): Promise<PipelineResult> {
    const pipeline = this.pipelines[job.kind];
    if (pipeline === undefined) {
      return {
        success: false,
        failureReason: 'provider_error',
        errorMessage: `지원하지 않는 작업 종류입니다: ${job.kind}`,
      };
    }

    return pipeline.run(job, context);
  }
}
