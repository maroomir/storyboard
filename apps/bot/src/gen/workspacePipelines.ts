import type { StoryboardAIService } from '@storyboard/story-ai';
import {
  storyboardRelativePaths,
  assembleManuscript,
  parseSynopsisMarkdown,
  serializeChapterPlan,
  serializeSynopsisMarkdown,
  toOutlineBrief,
  type ManuscriptDraftEntry,
  type OutlineCharacterBrief,
} from '@seedkernel/wasm';

import type { ContentService } from '../content/contentService';
import type { MutateOutcome } from '../workspace/workspaceChanges';
import type { WorkspaceStore } from '../workspace/workspaceStore';
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
      failureReason: 'provider_error',
      errorMessage: `작업 시작 후 Desktop에서 변경되어 저장하지 않았습니다: ${files}. 다시 실행해주세요.`,
    };
  }
  return undefined;
}

export interface WorkspacePipelineOptions {
  readonly store: WorkspaceStore;
  readonly content: ContentService;
  readonly aiService: StoryboardAIService;
}

export class OutlinePipeline implements IPipeline {
  public constructor(private readonly options: WorkspacePipelineOptions) {}

  public async run(job: GenJob, context: PipelineContext): Promise<PipelineResult> {
    await context.reportStage('프로젝트 읽기');
    const project = await this.options.store.readProject();
    const brief = toOutlineBrief(project.value);

    await context.reportStage('시놉시스 생성');
    const synopsis = await this.options.aiService.generateOutlineSynopsis(brief);
    if (context.isCancelled()) {
      return { success: false, failureReason: 'cancelled' };
    }

    await context.reportStage('저장');
    const relativePath = storyboardRelativePaths().outlineSynopsis;
    const outcome = await this.options.content.writeTracked(
      relativePath,
      serializeSynopsisMarkdown(synopsis),
      enqueueBaseline(job),
      `storygram: generate ${relativePath}`,
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
    const brief = toOutlineBrief(project.value);
    const synopsis = parseSynopsisMarkdown(synopsisFile.value);
    const characters = await this.loadCharacterBriefs();

    await context.reportStage('챕터 구성');
    const plan = await this.options.aiService.generateChapterPlan(brief, synopsis, characters);
    if (context.isCancelled()) {
      return { success: false, failureReason: 'cancelled' };
    }

    await context.reportStage('저장');
    const relativePath = storyboardRelativePaths().outlineChapters;
    const outcome = await this.options.content.writeTracked(
      relativePath,
      serializeChapterPlan(plan),
      enqueueBaseline(job),
      `storygram: generate ${relativePath}`,
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
    await context.reportStage('챕터 계획 읽기');
    const planFile = await this.options.store.readChapterPlan();
    if (planFile === undefined) {
      return {
        success: false,
        failureReason: 'provider_error',
        errorMessage: '챕터 계획이 없습니다. 먼저 /plan 을 실행해주세요.',
      };
    }

    await context.reportStage('초안 수집');
    const project = await this.options.store.readProject();
    const scenes = await this.options.store.listScenes();
    const draftsByOrder = new Map<number, ManuscriptDraftEntry>();

    for (const scene of scenes) {
      const draft = await this.options.store.readDraft(scene.stem);
      if (draft !== undefined) {
        draftsByOrder.set(scene.order, { stem: scene.stem, body: draft.value });
      }
    }

    await context.reportStage('원고 조립');
    const assembled = assembleManuscript({
      plan: planFile.value,
      projectName: project.value.name,
      draftsByOrder,
    });

    const relativePath = storyboardRelativePaths().manuscriptVolume;
    const outcome = await this.options.content.writeArtifact(
      relativePath,
      assembled.volumeMarkdown,
    );
    const failure = writeFailure(outcome);
    if (failure !== undefined) {
      return failure;
    }

    context.log(
      '조립',
      `씬 ${assembled.includedCount}개 포함, ${assembled.missingCount}개 미생성, 계획 외 ${assembled.extraCount}개`,
    );
    return { success: true, resultRef: relativePath };
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
