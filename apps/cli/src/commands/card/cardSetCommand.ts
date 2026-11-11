import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { flagString } from '@/cliArguments';
import { failure, success } from '@/commands/outcomes';
import type { CardStatementOrigin, SetCardStatementResult } from '@storyboard/story-engine';

const setOutcomeLabels: Readonly<Record<'added' | 'replaced' | 'unchanged', string>> = {
  added: '한 줄을 더했습니다',
  replaced: '한 줄을 바꿨습니다',
  unchanged: '이미 같은 줄이 있습니다',
};

export class CardSetCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'card set',
    writesWorkspace: true,
    group: '카드',
    usage: 'card set <slug> <facet> "<값>" [--key <key>] [--about <slug>]',
    summary:
      'statements.yaml 에 한 줄을 씁니다 (작가의 줄. 사람이 답할 수 없는 실행이면 출처는 agent)',
    flags: ['key', 'about'],
    examples: [
      'storyboard card set elia traits "몰리면 먼저 웃는다"',
      'storyboard card set elia speech "반말" --about jun',
    ],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const [slug, facet, value] = args.positionals;
    if (slug === undefined || facet === undefined || value === undefined || value.trim().length === 0) {
      return failure('쓸 줄을 모두 주세요: storyboard card set <slug> <facet> "<값>"');
    }

    const key: string | undefined = flagString(args.flags, 'key');
    const about: string | undefined = flagString(args.flags, 'about');
    const origin: CardStatementOrigin = container.prompter === undefined ? 'agent' : 'author';
    const result: SetCardStatementResult = await container.cards.setStatement({
      workspaceRoot: container.workspaceRoot,
      slug,
      facet,
      value,
      origin,
      ...(key === undefined ? {} : { key }),
      ...(about === undefined ? {} : { about }),
    });

    return result.ok
      ? success(`✓ ${result.path}/statements.yaml 에 ${setOutcomeLabels[result.kind]} (출처 ${origin})`, result)
      : failure(result.message, result);
  }
}
