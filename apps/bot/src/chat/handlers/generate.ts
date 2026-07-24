import { STORYBOARD_RELATIVE_PATHS } from '@storyboard/story-format';

import { DuplicateJobError, type IEnqueueJob } from '../../gen/jobManager';
import { defaultJobClass, type JobKind, type JobSpec } from '../../gen/types';
import { hashContent } from '../../workspace/workspaceStore';
import type { ChatContext } from '../context';
import type { IncomingUpdate } from '../ports';
import { commandArgs, isCommand, type ICommandHandler } from '../registry';

const KIND_LABELS: Record<JobKind, string> = {
  draft: '초안 생성',
  review: '리뷰',
  suggest: '제안',
  outline: '시놉시스 생성',
  plan: '챕터 계획 생성',
  manuscript: '원고 조립',
};

async function enqueue(ctx: ChatContext, spec: JobSpec): Promise<void> {
  if (ctx.jobs === undefined) {
    await ctx.reply({ text: '생성 기능이 아직 초기화되지 않았습니다.' });
    return;
  }

  try {
    ctx.jobs.enqueue(spec);
    // The progress reporter posts and edits the live status message from here on.
  } catch (error) {
    if (error instanceof DuplicateJobError) {
      await ctx.reply({
        text: `같은 대상의 작업이 이미 진행 중입니다 (#${error.existingJobId}). /jobs 로 확인해주세요.`,
      });
      return;
    }
    throw error;
  }
}

export function createDraftCommandHandler(): ICommandHandler {
  return {
    command: '/draft',
    description: '씬 초안 생성 (/draft <씬 stem>)',
    match: (update: IncomingUpdate) => isCommand(update, '/draft'),
    execute: async (ctx) => {
      const sceneStem = commandArgs(ctx.update);
      if (sceneStem.length === 0) {
        const scenes = await ctx.content.listScenes();
        await ctx.reply({
          text: [
            '사용법: /draft <씬 stem>',
            '',
            ...scenes.slice(0, 20).map((scene) => `  ${scene.stem}`),
          ].join('\n'),
        });
        return;
      }

      const scenes = await ctx.content.listScenes();
      if (!scenes.some((scene) => scene.stem === sceneStem)) {
        await ctx.reply({ text: `씬을 찾을 수 없습니다: ${sceneStem}` });
        return;
      }

      await enqueue(ctx, {
        kind: 'draft',
        class: defaultJobClass('draft'),
        target: { scene: sceneStem },
        chatId: ctx.chatId,
      });
    },
  };
}

// Tracked outputs capture the file's hash at enqueue (decision #14): if Desktop edits the file
// while the job runs, the write is refused and the job reports the conflict.
function createTrackedGenerationHandler(
  command: string,
  description: string,
  kind: JobKind,
  relativePath: string,
): ICommandHandler {
  return {
    command,
    description,
    match: (update: IncomingUpdate) => isCommand(update, command),
    execute: async (ctx) => {
      let baselineHash: string | undefined;
      try {
        baselineHash = hashContent(await ctx.store.readText(relativePath));
      } catch {
        baselineHash = undefined;
      }

      await enqueue(ctx, {
        kind,
        class: defaultJobClass(kind),
        target: { file: relativePath },
        options: baselineHash === undefined ? {} : { baselineHash },
        chatId: ctx.chatId,
      });
    },
  };
}

export function createOutlineCommandHandler(): ICommandHandler {
  return createTrackedGenerationHandler(
    '/outline',
    '시놉시스 생성 (.storyboard/outline/synopsis.md)',
    'outline',
    STORYBOARD_RELATIVE_PATHS.outlineSynopsis,
  );
}

export function createPlanCommandHandler(): ICommandHandler {
  return createTrackedGenerationHandler(
    '/plan',
    '챕터 계획 생성 (.storyboard/outline/chapters.yaml)',
    'plan',
    STORYBOARD_RELATIVE_PATHS.outlineChapters,
  );
}

export function createManuscriptCommandHandler(): ICommandHandler {
  return {
    command: '/manuscript',
    description: '챕터 계획 기준으로 원고 조립',
    match: (update: IncomingUpdate) => isCommand(update, '/manuscript'),
    execute: async (ctx) => {
      await enqueue(ctx, {
        kind: 'manuscript',
        class: defaultJobClass('manuscript'),
        target: { file: STORYBOARD_RELATIVE_PATHS.manuscriptVolume },
        chatId: ctx.chatId,
      });
    },
  };
}

export function createJobsHandler(): ICommandHandler {
  return {
    command: '/jobs',
    description: '최근 생성 작업 목록',
    match: (update: IncomingUpdate) => isCommand(update, '/jobs'),
    execute: async (ctx) => {
      const views = ctx.jobs?.getRecent(10) ?? [];
      if (views.length === 0) {
        await ctx.reply({ text: '아직 실행한 작업이 없습니다.' });
        return;
      }

      const lines = views.map(({ job }) => {
        const label = KIND_LABELS[job.kind] ?? job.kind;
        const target = typeof job.target.scene === 'string' ? ` ${job.target.scene}` : '';
        return `  #${job.id} ${label}${target} — ${job.state}`;
      });

      await ctx.reply({ text: ['🧵 최근 작업', ...lines, '', '/stop <번호> 로 취소'].join('\n') });
    },
  };
}

export function createStopHandler(): ICommandHandler {
  return {
    command: '/stop',
    description: '진행 중 작업 취소 (/stop <작업 번호>)',
    match: (update: IncomingUpdate) => isCommand(update, '/stop'),
    execute: async (ctx) => {
      const jobId = Number.parseInt(commandArgs(ctx.update), 10);
      if (!Number.isInteger(jobId)) {
        await ctx.reply({ text: '사용법: /stop <작업 번호> (/jobs 로 번호 확인)' });
        return;
      }

      const cancelled = ctx.jobs?.cancel(jobId) ?? false;
      await ctx.reply({
        text: cancelled
          ? `⏹ 작업 #${jobId} 취소를 요청했습니다.`
          : `취소할 수 없습니다: #${jobId} (이미 종료되었거나 없는 작업)`,
      });
    },
  };
}

// The progress message's inline buttons: j:<id>:stop / j:<id>:read / j:<id>:retry.
export async function handleJobCallback(ctx: ChatContext, data: string): Promise<boolean> {
  const match = data.match(/^j:(\d+):(stop|read|retry)$/);
  if (!match || ctx.jobs === undefined) {
    return false;
  }

  const jobId = Number.parseInt(match[1] ?? '', 10);
  const action = match[2];

  if (action === 'stop') {
    const cancelled = ctx.jobs.cancel(jobId);
    await ctx.answerCallback(cancelled ? '취소를 요청했습니다.' : '이미 종료된 작업입니다.');
    return true;
  }

  const view = ctx.jobs.getStatus(jobId);
  const job = view === undefined || Array.isArray(view) ? undefined : view.job;

  if (action === 'read') {
    if (job?.resultRef === undefined || job.resultRef === null) {
      await ctx.answerCallback('결과 파일이 없습니다.');
      return true;
    }
    try {
      const body = await ctx.store.readText(job.resultRef);
      await ctx.answerCallback();
      await ctx.reply({ text: `📄 ${job.resultRef}\n\n${body}` });
    } catch {
      await ctx.answerCallback('결과 파일을 읽을 수 없습니다.');
    }
    return true;
  }

  // retry: re-enqueue the same spec; the paid AI call only re-runs on this explicit tap.
  if (job === undefined) {
    await ctx.answerCallback('작업 정보를 찾을 수 없습니다.');
    return true;
  }
  try {
    ctx.jobs.enqueue({
      kind: job.kind,
      class: job.class,
      target: job.target,
      options: job.options,
      provider: job.provider,
      chatId: ctx.chatId,
    });
    await ctx.answerCallback('다시 실행합니다.');
  } catch (error) {
    if (error instanceof DuplicateJobError) {
      await ctx.answerCallback(`이미 진행 중입니다 (#${error.existingJobId}).`);
    } else {
      throw error;
    }
  }
  return true;
}

export type { IEnqueueJob };
