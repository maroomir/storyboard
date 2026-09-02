import type { ParsedArguments } from '@/cliArguments';
import type { CliContainer } from '@/container';

export interface CommandOutcome {
  readonly ok: boolean;
  readonly message: string;
  readonly data?: unknown;
}

export interface CommandContext {
  readonly container: CliContainer;
  readonly args: ParsedArguments;
}

export type CommandHandler = (context: CommandContext) => Promise<CommandOutcome>;
