import type { IPrompter } from '@/adapters/prompter';
import { flagString } from '@/cliArguments';
import type { CommandHandler } from '@/commands/outcome';
import { cancelledBeforeRun, confirmPaidRun } from '@/commands/paidRunConfirmation';
import type { NovelRunResult } from '@storyboard/story-app';
import { novelStageLabel, resolveNovelPipelinePlan } from '@storyboard/story-engine';
import {
  formatUsd,
  type NovelRunMode,
  type NovelRunState,
  type NovelStageName,
  type StoryboardProject,
} from '@storyboard/story-model';

const unattendedRunApprovesEveryGate: NovelRunMode = 'auto';

export const generateNovel: CommandHandler = async ({ container, args }) => {
  const interrupted: NovelRunState | undefined = await container.novel.findResumableRun(
    container.workspaceRoot,
    {
      holdsRunLock: true,
    },
  );
  const restartChoice: 'restart' | 'resume' | undefined =
    interrupted === undefined
      ? 'restart'
      : await askResumeOrRestart(container.prompter, interrupted);

  if (restartChoice === undefined) {
    return cancelledBeforeRun;
  }

  const isConfirmed: boolean = await confirmPaidRun(container, (status) => ({
    title: '장편 생성',
    details: [
      `작품  ${status.project.name}`,
      `지금  씬 ${status.scenes.total}개 · 초안 ${status.drafts.ready}개`,
      '기획부터 원고 조립까지 이어서 돌립니다 (Esc 로 씬 경계에서 멈춤)',
    ],
  }));

  if (!isConfirmed) {
    return cancelledBeforeRun;
  }

  const project: StoryboardProject = await container.novel.readProject(container.workspaceRoot);
  const novelPlan: readonly NovelStageName[] = resolveNovelPipelinePlan();
  const reviseIterations: string | undefined = flagString(args.flags, 'revise-iterations');
  const novelRun: NovelRunResult = await container.novel.run({
    workspaceUri: container.workspaceRoot,
    project,
    runMode: unattendedRunApprovesEveryGate,
    ...(reviseIterations === undefined ? {} : { reviseMaxIterations: Number(reviseIterations) }),
    ...(restartChoice === 'resume' && interrupted !== undefined
      ? { resumeState: interrupted }
      : {}),
    onProgress: (stage, message) =>
      container.progress.update({
        line: `${novelStageLabel(stage)}: ${message}`,
        step: message,
        checklist: {
          labels: novelPlan.map((name) => novelStageLabel(name)),
          currentIndex: novelPlan.indexOf(stage),
        },
      }),
    requestApproval: async () => true,
    shouldCancel: () => false,
    shouldPause: container.pauseRequests.watch(),
  });

  const { spending } = novelRun;
  const budgetNote: string =
    novelRun.outcome === 'paused' && spending.isOverBudget
      ? ` 이번 실행 예산 $${spending.budgetUsd}에 닿았습니다 (쓴 비용 ${formatUsd(spending.costUsd)}).`
      : '';
  const cacheNote: string =
    spending.cache !== undefined && spending.cache.cachedTokens > 0
      ? ` 프롬프트 캐시 적중 ${Math.round((spending.cache.cachedTokens / spending.cache.promptTokens) * 100)}%, 절약 ${formatUsd(spending.cache.savedUsd)}.`
      : '';

  return {
    ok: novelRun.outcome === 'completed',
    message:
      novelRun.outcome === 'failed'
        ? `장편 생성에 실패했습니다: ${novelRun.message}`
        : `${novelRun.message}${budgetNote}${cacheNote}`,
    data: { ...novelRun, costUsd: spending.costUsd },
    ...(novelRun.outcome === 'paused' || novelRun.outcome === 'cancelled'
      ? { stop: novelRun.outcome }
      : {}),
  };
};

async function askResumeOrRestart(
  prompter: IPrompter | undefined,
  interrupted: NovelRunState,
): Promise<'resume' | 'restart' | undefined> {
  if (prompter === undefined) {
    return 'resume';
  }

  const finished: string = interrupted.completedStages
    .map((stage) => novelStageLabel(stage))
    .join(', ');

  return await prompter.choose<'resume' | 'restart'>({
    title: '끊긴 장편 생성이 있습니다',
    details: [`끝난 단계  ${finished.length === 0 ? '없음' : finished}`],
    options: [
      { label: '이어 가기', value: 'resume' },
      { label: '처음부터 (있는 아웃라인·씬 카드는 그대로 씀)', value: 'restart' },
    ],
  });
}
