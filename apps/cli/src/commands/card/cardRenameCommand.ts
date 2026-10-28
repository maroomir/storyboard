import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import { type CommandSpec, cardCategories } from '@/commands/catalog';
import { cardCategoryFrom, describeMissingCardCategory } from '@/commands/card/cardArguments';
import { flagString } from '@/cliArguments';
import { failure, success } from '@/commands/outcomes';
import type { RenameCardResult } from '@storyboard/story-engine';
import type { BibleSubjectKind } from '@storyboard/story-model';

export class CardRenameCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'card rename',
    writesWorkspace: true,
    group: '카드와 정전',
    usage: `card rename <${cardCategories.join('|')}> <id> --to <id>`,
    summary: '카드 id 를 바꾸고 참조를 함께 고칩니다',
    flags: ['to'],
    examples: ['storyboard card rename character hana --to hana-seo'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const category: BibleSubjectKind | undefined = cardCategoryFrom(args);
    const fromId: string | undefined = args.positionals[1];
    const toId: string | undefined = flagString(args.flags, 'to');

    if (category === undefined) {
      return failure(describeMissingCardCategory('card rename'));
    }

    if (fromId === undefined || toId === undefined) {
      return failure('바꿀 id 와 --to <새 id> 를 지정해 주세요.');
    }

    const cardRename: RenameCardResult = await container.cards.rename({
      workspaceRoot: container.workspaceRoot,
      category,
      fromId,
      toId,
    });

    if (!cardRename.ok) {
      return failure(cardRename.message);
    }

    for (const path of cardRename.unreadableFiles) {
      container.logger.warn(`참조를 갱신하지 못했습니다: ${path}`);
    }

    return success(
      `${fromId} → ${toId}${cardRename.rewrittenCount > 0 ? ` (참조 ${cardRename.rewrittenCount}건 갱신)` : ''}`,
      { oldId: fromId, newId: toId, rewritten: cardRename.rewrittenCount },
    );
  }
}
