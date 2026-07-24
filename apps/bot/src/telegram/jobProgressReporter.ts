import type { InlineKeyboard, ISendMessage, SentMessageRef } from '../chat/ports';
import type { IJobProgressListener } from '../gen/progress';
import type { GenJob, PipelineResult } from '../gen/types';
import type { Logger } from '../util/logger';

export interface TelegramProgressReporterOptions {
  readonly sender: ISendMessage;
  readonly logger: Logger;
  readonly onProgressMessageCreated?: (ref: SentMessageRef) => void;
}

// The Telegram adapter for gen's IJobProgressListener port: it renders progress/finish text and the
// Stop/read/retry inline keyboards and edits a single live message per job.
export class TelegramProgressReporter implements IJobProgressListener {
  private progressRef: SentMessageRef | null = null;
  private lastStage = '';

  public constructor(private readonly options: TelegramProgressReporterOptions) {}

  public async onJobStarted(job: GenJob): Promise<void> {
    try {
      this.progressRef = await this.options.sender.sendMessage(job.chatId, {
        text: formatProgress(job, '접수됨', 0),
        keyboard: stopKeyboard(job),
      });
      this.options.onProgressMessageCreated?.(this.progressRef);
    } catch (error) {
      this.options.logger.error(`진행 메시지 생성 실패: job=${job.id}`, error);
    }
  }

  public async onStage(job: GenJob, stage: string): Promise<void> {
    this.lastStage = stage;
    await this.edit(job, stage, Date.now() - (job.startedAt ?? job.createdAt));
  }

  public async onHeartbeat(job: GenJob, elapsedMs: number): Promise<void> {
    await this.edit(job, this.lastStage || '실행 중', elapsedMs);
  }

  public async onFinished(job: GenJob, result: PipelineResult): Promise<void> {
    const text = result.success
      ? `✅ 잡 #${job.id} 완료 (${job.kind})\n${result.resultRef ?? '결과 없음'}`
      : `❌ 잡 #${job.id} 실패 (${job.kind})\n${result.errorMessage ?? result.failureReason ?? 'unknown'}`;

    const keyboard = result.success
      ? [
          [
            {
              text: finishedButtonLabel(job.kind),
              callbackData: `j:${job.id}:read`,
            },
          ],
        ]
      : [[{ text: '재시도', callbackData: `j:${job.id}:retry` }]];

    try {
      if (this.progressRef) {
        await this.options.sender.editMessage(this.progressRef, { text, keyboard });
      } else {
        await this.options.sender.sendMessage(job.chatId, { text, keyboard });
      }
    } catch (error) {
      this.options.logger.error(`완료 알림 발신 실패: job=${job.id}`, error);
    }
  }

  private async edit(job: GenJob, stage: string, elapsedMs: number): Promise<void> {
    if (!this.progressRef) {
      return;
    }

    try {
      await this.options.sender.editMessage(this.progressRef, {
        text: formatProgress(job, stage, elapsedMs),
        keyboard: stopKeyboard(job),
      });
    } catch (error) {
      this.options.logger.error(`진행 메시지 편집 실패: job=${job.id}`, error);
    }
  }
}

// A live job carries a Stop button so the writer can cancel without typing `/stop <id>`. onFinished
// replaces this keyboard with the read/retry action.
function stopKeyboard(job: GenJob): InlineKeyboard {
  return [[{ text: '⏹ 중지', callbackData: `j:${job.id}:stop` }]];
}

function formatProgress(job: GenJob, stage: string, elapsedMs: number): string {
  const elapsedSec = Math.max(0, Math.floor(elapsedMs / 1000));
  return `⏳ 잡 #${job.id} (${job.kind})\n단계: ${stage}\n경과: ${elapsedSec}s`;
}

function finishedButtonLabel(kind: GenJob['kind']): string {
  if (kind === 'review') {
    return '리포트 보기';
  }

  if (kind === 'suggest') {
    return '제안 보기';
  }

  if (kind === 'outline') {
    return '아웃라인 보기';
  }

  if (kind === 'plan') {
    return '챕터 플랜 보기';
  }

  return '초안 보기';
}
