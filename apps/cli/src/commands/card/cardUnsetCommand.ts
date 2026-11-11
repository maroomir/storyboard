import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { flagString } from '@/cliArguments';
import { failure, success } from '@/commands/outcomes';
import type { UnsetCardStatementResult } from '@storyboard/story-engine';

export class CardUnsetCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'card unset',
    writesWorkspace: true,
    group: '카드',
    usage: 'card unset <slug> <facet> ["<값>"] [--key <key>] [--about <slug>]',
    summary: 'statements.yaml 에서 맞는 줄을 지웁니다 (값을 주면 그 줄만)',
    flags: ['key', 'about'],
    examples: ['storyboard card unset elia speech --about jun'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const [slug, facet, value] = args.positionals;
    if (slug === undefined || facet === undefined) {
      return failure('지울 줄을 주세요: storyboard card unset <slug> <facet> ["<값>"]');
    }

    const key: string | undefined = flagString(args.flags, 'key');
    const about: string | undefined = flagString(args.flags, 'about');
    const result: UnsetCardStatementResult = await container.cards.unsetStatement({
      workspaceRoot: container.workspaceRoot,
      slug,
      facet,
      ...(value === undefined ? {} : { value }),
      ...(key === undefined ? {} : { key }),
      ...(about === undefined ? {} : { about }),
    });

    return result.ok
      ? success(
          [`✓ ${result.removed.length}줄을 지웠습니다.`, ...result.removed.map((line) => `  - ${line.facet}: ${line.value}`)].join('\n'),
          result,
        )
      : failure(result.message, result);
  }
}
