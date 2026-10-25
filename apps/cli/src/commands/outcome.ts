import type { ParsedArguments } from '@/cliArguments';
import type { CliContainer } from '@/container';
import type { TerminalStream } from '@/terminal/profile';

export interface CommandOutcome {
  readonly ok: boolean;
  readonly message: string;
  readonly data?: unknown;
  readonly stop?: 'paused' | 'cancelled';
  readonly isDrawn?: boolean;
}

export interface CommandContext {
  readonly container: CliContainer;
  readonly args: ParsedArguments;
  readonly stdout?: TerminalStream;
}

export type CommandHandler = (context: CommandContext) => Promise<CommandOutcome>;
