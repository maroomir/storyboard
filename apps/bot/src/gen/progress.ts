import type { GenJob, PipelineResult } from './types';

// The generation core's progress port. Transport-neutral: the Telegram rendering lives in the
// adapter telegram/jobProgressReporter.ts, so gen never depends on the chat/telegram layers.
export interface IJobProgressListener {
  onJobStarted(job: GenJob): Promise<void>;
  onStage(job: GenJob, stage: string): Promise<void>;
  onHeartbeat(job: GenJob, elapsedMs: number): Promise<void>;
  onFinished(job: GenJob, result: PipelineResult): Promise<void>;
}

export class NullProgressListener implements IJobProgressListener {
  public async onJobStarted(): Promise<void> {}
  public async onStage(): Promise<void> {}
  public async onHeartbeat(): Promise<void> {}
  public async onFinished(): Promise<void> {}
}
