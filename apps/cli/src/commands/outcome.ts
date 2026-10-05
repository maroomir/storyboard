import type { ParsedArguments } from '@/cliArguments';
import type { CliContainer } from '@/container';
import type { TerminalStream } from '@/terminal/profile';

export interface CommandOutcome {
  readonly ok: boolean;
  readonly message: string;
  readonly data?: unknown;
  // A run a person stopped (a pause, a declined question) did not fail, but it did not finish
  // either: it exits non-zero without the failure mark and suggests no next step.
  readonly stop?: 'paused' | 'cancelled';
  // A result that draws its own verdict (doctor's panels) gets no mark in front of it.
  readonly isDrawn?: boolean;
}

export interface CommandContext {
  readonly container: CliContainer;
  readonly args: ParsedArguments;
  // Where the result goes. A handler that draws (doctor's panels) reads it; absent means a pipe.
  readonly stdout?: TerminalStream;
}

export type CommandHandler = (context: CommandContext) => Promise<CommandOutcome>;
