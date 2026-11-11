import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { flagBoolean } from '@/cliArguments';
import { failure, success } from '@/commands/outcomes';
import type { CardRemovalPlan, RemoveCardResult } from '@storyboard/story-engine';

function describePlan(plan: CardRemovalPlan): string[] {
  return [
    `가리키는 곳 ${plan.referencingPaths.length}곳: ${plan.referencingPaths.join(', ')}`,
    ...(plan.droppedLines.length === 0
      ? []
      : ['함께 지울 줄:', ...plan.droppedLines.map((line) => `  - ${line.path}: ${line.value}`)]),
  ];
}

export class CardRemoveCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'card remove',
    writesWorkspace: true,
    group: '카드',
    usage: 'card remove <slug> [--force]',
    summary:
      '카드 번들을 지웁니다. 가리키는 곳이 있으면 지울 줄을 먼저 보여 주고 --force 를 요구합니다',
    flags: ['force'],
    examples: ['storyboard card remove sera', 'storyboard card remove sera --force'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const slug: string | undefined = args.positionals[0];
    if (slug === undefined) {
      return failure('지울 카드를 주세요: storyboard card remove <slug>');
    }

    const result: RemoveCardResult = await container.cards.remove({
      workspaceRoot: container.workspaceRoot,
      slug,
      shouldForce: flagBoolean(args.flags, 'force'),
    });

    if (result.ok) {
      const cleaned: string[] = result.plan.referencingPaths.length === 0 ? [] : describePlan(result.plan);
      return success([`✓ ${result.plan.path} 를 지웠습니다.`, ...cleaned].join('\n'), result);
    }

    return result.kind === 'referenced'
      ? failure([result.message, ...describePlan(result.plan)].join('\n'), result)
      : failure(result.message, result);
  }
}
