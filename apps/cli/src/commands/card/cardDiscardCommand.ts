import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { cardIdPattern } from '@/commands/card/cardArguments';
import { flagString } from '@/cliArguments';
import { failure, success } from '@/commands/outcomes';
import type { CliContainer } from '@/container';
import type { DiscardNoteCandidatesResult } from '@storyboard/story-engine';

export class CardDiscardCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'card discard',
    writesWorkspace: true,
    group: '카드와 정전',
    usage: 'card discard <id> [--change <ref>]',
    summary:
      '승격하지 않은 카드 후보를 버립니다 (id 를 여럿 줄 수 있고, 없으면 전부 · --change 는 그 카드의 노트 후보 하나만)',
    flags: ['change'],
    examples: [
      'storyboard card discard hana',
      'storyboard card discard hana --change s2:attribute:age',
      'storyboard card discard',
    ],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const invalidId: string | undefined = args.positionals.find((id) => !cardIdPattern.test(id));

    if (invalidId !== undefined) {
      return failure(`카드 id 가 올바르지 않습니다: ${invalidId}`);
    }

    const changeRef: string | undefined = flagString(args.flags, 'change');

    return changeRef === undefined
      ? this.discardCards(container, args.positionals)
      : this.discardChange(container, args.positionals, changeRef);
  }

  private async discardChange(
    container: CliContainer,
    positionals: readonly string[],
    changeRef: string,
  ): Promise<CommandOutcome> {
    const [cardId] = positionals;

    if (cardId === undefined || positionals.length > 1) {
      return failure('--change 는 카드 id 하나와 함께 씁니다: card discard <id> --change <ref>');
    }

    const discard: DiscardNoteCandidatesResult = await container.notes.discardCandidates(
      container.workspaceRoot,
      {
        kind: 'change',
        cardId,
        ref: changeRef,
      },
    );

    return discard.kind === 'change_not_found'
      ? failure(
          `${cardId} 의 노트 후보에 ${changeRef} 가 없습니다. card promote --dry-run 으로 확인하세요.`,
        )
      : success(`${cardId} 의 노트 후보 ${changeRef} 를 버렸습니다.`, discard);
  }

  private async discardCards(
    container: CliContainer,
    positionals: readonly string[],
  ): Promise<CommandOutcome> {
    const cardIds: Set<string> | undefined =
      positionals.length > 0 ? new Set(positionals) : undefined;
    const notes: DiscardNoteCandidatesResult = await container.notes.discardCandidates(
      container.workspaceRoot,
      {
        kind: 'cards',
        ...(cardIds === undefined ? {} : { cardIds }),
      },
    );
    const draftItemCount: number = await container.cards.discardCandidates(
      container.workspaceRoot,
      cardIds,
    );
    const noteCardIds: readonly string[] = notes.kind === 'discarded' ? notes.cardIds : [];

    if (noteCardIds.length === 0 && draftItemCount === 0) {
      return success('버릴 후보가 없습니다.', { notes: [], drafts: 0 });
    }

    return success(
      [
        '후보를 버렸습니다.',
        ...(noteCardIds.length > 0 ? [`  노트에서  ${noteCardIds.join(', ')}`] : []),
        ...(draftItemCount > 0 ? [`  초안에서  ${draftItemCount}건`] : []),
      ].join('\n'),
      { notes: noteCardIds, drafts: draftItemCount },
    );
  }
}
