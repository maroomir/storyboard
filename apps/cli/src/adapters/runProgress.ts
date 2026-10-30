import type { IStoryboardLogger } from '@storyboard/story-engine';

import type { Theme } from '@/terminal/theme';

import type { LiveArea } from '@/adapters/liveArea';
import { formatUsd } from '@storyboard/story-model';

export interface ProgressUnit {
  readonly current: number;
  readonly total: number;
  readonly label: string;
}

export interface RunProgressUpdate {
  readonly line: string;
  readonly unit?: ProgressUnit;
  readonly step?: string;
  readonly checklist?: ProgressChecklist;
}

export interface ProgressChecklist {
  readonly labels: readonly string[];
  readonly currentIndex: number;
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

const spinnerFrames: string[] = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const writerPhrases: string[] = [
  '구상하는 중',
  '문장을 고르는 중',
  '장면을 잇는 중',
  '퇴고하는 중',
];
const phraseMilliseconds: number = 4_000;
const progressBarWidth: number = 20;
const redrawMilliseconds: number = 100;

export interface RailRunProgressDependencies {
  readonly liveArea: LiveArea;
  readonly theme: Theme;
  readonly readCostUsd: () => number;
  readonly readUnpricedTokens?: () => number;
  readonly readCacheHitRate?: () => number | undefined;
  readonly now?: () => number;
}

export function describeChecklist(checklist: ProgressChecklist, theme: Theme): string {
  return checklist.labels
    .map((label, index) => {
      if (index < checklist.currentIndex) {
        return theme.paint('success', `✓ ${label}`);
      }
      return index === checklist.currentIndex
        ? theme.paint('accent', `› ${label}`)
        : theme.paint('muted', `· ${label}`);
    })
    .join('  ');
}

export function formatElapsed(milliseconds: number): string {
  const seconds: number = Math.floor(milliseconds / 1000);
  const minutes: number = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export class RailRunProgress implements IRunProgress {
  private readonly now: () => number;
  private startedAt: number | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private unit: ProgressUnit | undefined;
  private step: string = '';
  private checklist: ProgressChecklist | undefined;
  private frame: number = 0;

  public constructor(private readonly deps: RailRunProgressDependencies) {
    this.now = deps.now ?? Date.now;
  }

  public update(progress: RunProgressUpdate): void {
    if (progress.unit !== undefined) {
      this.unit = progress.unit;
    }
    this.step = progress.step ?? (progress.unit === undefined ? progress.line : '');
    if (progress.checklist !== undefined) {
      this.checklist = progress.checklist;
    }

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
    const spinner: string = paint('accent', spinnerFrames[this.frame % spinnerFrames.length] ?? '');
    const batchItemLabel: string =
      this.unit === undefined ? '' : `${this.unit.current}/${this.unit.total} ${this.unit.label}`;
    const what: string = [batchItemLabel, this.step]
      .filter((part) => part.length > 0)
      .join(paint('muted', ' · '));
    const cost: number = this.deps.readCostUsd();
    const unpricedTokens: number = this.deps.readUnpricedTokens?.() ?? 0;
    const cacheHitRate: number | undefined = this.deps.readCacheHitRate?.();
    const meta: string = [
      formatElapsed(this.now() - (this.startedAt ?? this.now())),
      ...(cost > 0 ? [formatUsd(cost)] : []),
      ...(cost <= 0 && unpricedTokens > 0
        ? [`${Math.round(unpricedTokens).toLocaleString('en-US')} 토큰`]
        : []),
      ...(cacheHitRate !== undefined && cacheHitRate > 0
        ? [`캐시 ${Math.round(cacheHitRate * 100)}%`]
        : []),
    ].join(' · ');
    const elapsed: number = this.now() - (this.startedAt ?? this.now());
    const phrase: string | undefined =
      writerPhrases[Math.floor(elapsed / phraseMilliseconds) % writerPhrases.length];
    const lines: string[] = [
      `${spinner} ${paint('muted', `${phrase}…`)} ${what}  ${paint('muted', meta)}`,
    ];

    if (this.checklist !== undefined) {
      lines.push(`  ${describeChecklist(this.checklist, this.deps.theme)}`);
    }

    if (this.unit !== undefined && this.unit.total > 1) {
      const filled: number = Math.round(
        ((this.unit.current - 1) / this.unit.total) * progressBarWidth,
      );
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
