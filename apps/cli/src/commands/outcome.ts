import type { ParsedArguments } from '@/cliArguments';
import type { CliContainer } from '@/container';
import type { TerminalStream } from '@/terminal/profile';

export interface CommandOutcome {
  readonly ok: boolean;
  readonly message: string;
  readonly data?: unknown;
}

export interface CommandContext {
  readonly container: CliContainer;
  readonly args: ParsedArguments;
  // Where the result goes. A handler that draws (doctor's panels) reads it; absent means a pipe.
  readonly stdout?: TerminalStream;
}

export type CommandHandler = (context: CommandContext) => Promise<CommandOutcome>;
