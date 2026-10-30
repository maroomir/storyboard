import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import {
  describeBatchFailure,
  describeBatchStep,
  sceneStageLabels,
} from '@/commands/draft/draftProgress';
import { flagBoolean } from '@/cliArguments';
import { failure, success } from '@/commands/outcomes';
import { WorkspaceInput, cancelledBeforeRun } from '@/commands/workspaceInput';
import { sceneStemFrom, sceneUriFor } from '@/commands/sceneArguments';
import {
  describeReviseOutcome,
  type GenerateAllDraftsResult,
  type GenerateAllDraftsSummary,
  type ReviseDraftWorkflowResult,
  type ReviseOutcome,
} from '@storyboard/story-engine';
import type { GenerateAndReviseDraftResult, ReadyDraft } from '@storyboard/story-app';
import type { StoryUri } from '@storyboard/story-model';

export class DraftGenerateCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'draft generate',
    writesWorkspace: true,
    group: '초안',
    usage: 'draft generate <stem> | --all',
    summary: '씬 초안을 생성합니다 (--force 로 재생성, --all 은 필요한 씬만)',
    flags: ['all', 'force', 'no-revise', 'revise-iterations'],
    examples: ['storyboard draft generate 01-scene-1-1', 'storyboard draft generate --all'],
  };

  public async execute(context: CommandContext): Promise<CommandOutcome> {
    return flagBoolean(context.args.flags, 'all')
      ? this.generateAll(context)
      : this.generateScene(context);
  }

  private async generateAll({ container }: CommandContext): Promise<CommandOutcome> {
    const isConfirmed: boolean = await new WorkspaceInput(container).confirmPaidRun((status) => {
      const pending: number = status.drafts.missing + status.drafts.stale;
      return {
        title: `초안 ${pending}개 생성`,
        details: [
          `대상  초안이 없거나 카드보다 오래된 씬 ${pending}개 (전체 ${status.scenes.total}개)`,
        ],
      };
    });

    if (!isConfirmed) {
      return cancelledBeforeRun;
    }

    const batchGeneration: GenerateAllDraftsResult = await container.drafts.generateAll({
      shouldPause: container.pauseRequests.watch(),
      onProgress: (progress) => {
        const step: string = describeBatchStep(progress);
        container.progress.update({
          line: `${progress.current}/${progress.total} ${progress.label} · ${step}`,
          unit: { current: progress.current, total: progress.total, label: progress.label },
          step,
        });
      },
    });

    if (!batchGeneration.ok) {
      return failure(describeBatchFailure(batchGeneration.kind), batchGeneration);
    }

    return describeBatchSummary(batchGeneration.summary);
  }

  private async generateScene({ container, args }: CommandContext): Promise<CommandOutcome> {
    const stem: string | undefined = sceneStemFrom(args);
    if (stem === undefined) {
      return failure('씬 stem을 지정해 주세요. 예: storyboard draft generate 01-scene-1-1');
    }

    const { generation, revision }: GenerateAndReviseDraftResult =
      await container.drafts.generateAndRevise({
        sceneUri: sceneUriFor(container.workspaceRoot, stem),
        force: flagBoolean(args.flags, 'force'),
        isReviseAllowed: !flagBoolean(args.flags, 'no-revise'),
        onPipelineProgress: (stage, current, total) => {
          const step: string = `${sceneStageLabels[stage] ?? stage} ${current}/${total}`;
          container.progress.update({ line: step, step });
        },
        onDraftReady: (draft) => {
          for (const warning of draftWarningsOf(draft)) {
            container.logger.warn(warning);
          }
        },
        onReviseProgress: (message) => container.progress.update({ line: message, step: message }),
      });

    if (!generation.ok) {
      return failure(generation.kind === 'failed' ? generation.message : '취소했습니다.');
    }

    return this.describeGeneratedScene(container, generation, revision);
  }

  private describeGeneratedScene(
    container: CommandContext['container'],
    draft: ReadyDraft,
    revision: ReviseDraftWorkflowResult | undefined,
  ): CommandOutcome {
    const warnings: readonly string[] = draftWarningsOf(draft);
    const revise: ReviseOutcome | undefined = revision && describeReviseOutcome(revision);

    if (revise?.warning) {
      container.logger.warn(revise.warning);
    }

    return success(
      draft.kind === 'cache_hit' ? '입력이 같아 기존 초안을 씁니다.' : '초안을 생성했습니다.',
      {
        draft: (draft.draftUri as StoryUri).fsPath,
        warnings: revise?.warning ? [...warnings, revise.warning] : warnings,
        ...(revise === undefined ? {} : { revise }),
      },
    );
  }
}

function draftWarningsOf(draft: ReadyDraft): readonly string[] {
  return draft.kind === 'generated' ? draft.warnings : [];
}

function describeBatchSummary(summary: GenerateAllDraftsSummary): CommandOutcome {
  const { cacheHits, failureLabels, failures, generated, pausedWithRemaining } = summary;

  if (pausedWithRemaining !== undefined) {
    return {
      ok: false,
      message:
        `멈췄습니다: 생성 ${generated}건, 남은 씬 ${pausedWithRemaining}개. ` +
        '다시 실행하면 남은 씬부터 이어 갑니다.',
      data: summary,
      stop: 'paused',
    };
  }

  return {
    ok: failures === 0,
    message:
      failures === 0
        ? `초안 ${generated}건 생성, ${cacheHits}건은 입력이 같아 그대로 둡니다.`
        : `${failures}건 실패 (생성 ${generated}건, 캐시 ${cacheHits}건): ${failureLabels.join(', ')}`,
    data: summary,
  };
}
