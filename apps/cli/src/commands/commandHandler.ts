import type { CommandSpec } from '@/commands/catalog';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';

export interface ICommandHandler {
  readonly spec: CommandSpec;
  execute(context: CommandContext): Promise<CommandOutcome>;
}
