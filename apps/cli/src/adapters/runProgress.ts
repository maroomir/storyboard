import type { IStoryboardLogger } from '@storyboard/story-engine';

import type { Theme } from '@/terminal/theme';

import type { LiveArea } from './liveArea';

// 긴 실행의 진행 보고. 터미널이면 제자리에서 갱신되는 레일, 아니면 지금까지와 같은 한 줄씩.

export interface ProgressUnit {
  readonly current: number;
  readonly total: number;
  readonly label: string;
}

export interface RunProgressUpdate {
  // The line a pipe or a log reader gets, exactly as before the rail existed.
  readonly line: string;
  // The item of a batch being worked on (scene 12 of 32); it stays until the next one arrives.
  readonly unit?: ProgressUnit;
  // What is happening inside it (a stage, a chapter); without one the line is shown.
  readonly step?: string;
}

export interface IRunProgress {
  update(progress: RunProgressUpdate): void;
  finish(): void;
}

export class LineRunProgress implements IRunProgress {
  public constructor(private readonly logger: IStoryboardLogger) {}

  public update(progress: RunProgressUpdate): void {
    this.logger.info(progress.line);
  }

  public finish(): void {}
}

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const progressBarWidth = 20;
const redrawMilliseconds = 100;

export interface RailRunProgressDependencies {
  readonly liveArea: LiveArea;
  readonly theme: Theme;
  // Dollars spent by this run so far; 0 for an unpriced (local) model.
  readonly readCostUsd: () => number;
  readonly now?: () => number;
}

export function formatElapsed(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

// The rail: a spinner, the batch item and its step, elapsed time and cost, and for a batch a bar.
// It starts on the first update, so a command that never reports draws nothing.
export class RailRunProgress implements IRunProgress {
  private readonly now: () => number;
  private startedAt: number | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private unit: ProgressUnit | undefined;
  private step = '';
  private frame = 0;

  public constructor(private readonly deps: RailRunProgressDependencies) {
    this.now = deps.now ?? Date.now;
  }

  public update(progress: RunProgressUpdate): void {
    if (progress.unit !== undefined) {
      this.unit = progress.unit;
    }
    this.step = progress.step ?? (progress.unit === undefined ? progress.line : '');

    if (this.startedAt === undefined) {
      this.startedAt = this.now();
      this.timer = setInterval(() => this.render(), redrawMilliseconds);
      this.timer.unref?.();
    }

    this.render();
  }

  public finish(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.deps.liveArea.clear();
  }

  public describeLines(): string[] {
    const { paint } = this.deps.theme;
    const spinner = paint('accent', spinnerFrames[this.frame % spinnerFrames.length] ?? '');
    const item =
      this.unit === undefined ? '' : `${this.unit.current}/${this.unit.total} ${this.unit.label}`;
    const what = [item, this.step].filter((part) => part.length > 0).join(paint('muted', ' · '));
    const cost = this.deps.readCostUsd();
    const meta = [
      formatElapsed(this.now() - (this.startedAt ?? this.now())),
      ...(cost > 0 ? [`$${cost.toFixed(2)}`] : []),
    ].join(' · ');
    const lines = [`${spinner} ${what}  ${paint('muted', meta)}`];

    if (this.unit !== undefined && this.unit.total > 1) {
      const filled = Math.round(((this.unit.current - 1) / this.unit.total) * progressBarWidth);
      lines.push(
        `  ${paint('accent', '█'.repeat(filled))}${paint('muted', '░'.repeat(progressBarWidth - filled))}`,
      );
    }

    return lines;
  }

  private render(): void {
    this.frame += 1;
    this.deps.liveArea.show(this.describeLines());
  }
}
