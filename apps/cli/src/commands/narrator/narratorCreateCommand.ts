import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import {
  BuildCardResult,
  buildCard,
  narratorIdPattern,
} from '@/commands/narrator/narratorCardForm';
import type { StoryUri } from '@storyboard/story-model';
import { flagString } from '@/cliArguments';
import type { CreateNarratorCardResult } from '@storyboard/story-engine';
import { success, failure } from '@/commands/outcomes';
import { toNarratorData } from '@/commands/narrator/narratorViews';

export class NarratorCreateCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'narrator create',
    writesWorkspace: true,
    group: '기획',
    usage: 'narrator create <id> [--person …]',
    summary: '이름 붙인 서술자 카드를 만듭니다 (씬·장이 골라 쓰는 시점)',
    flags: ['id', 'name', 'person', 'knowledge', 'tense', 'focal', 'voice'],
    examples: [
      'storyboard narrator create hana-first --person first --focal hana',
      'storyboard narrator create narrator-old --person first --knowledge retrospective --focal hana',
    ],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const id: string | undefined = flagString(args.flags, 'id') ?? args.positionals[0];

    if (id === undefined || !narratorIdPattern.test(id)) {
      return failure('서술자 id 는 영소문자·숫자·하이픈만 쓸 수 있습니다 (예: hana-first).');
    }

    const card: BuildCardResult = buildCard(id, args.flags);

    if (!card.ok) {
      return card.outcome;
    }

    const created: CreateNarratorCardResult = await container.cards.createNarrator(
      container.workspaceRoot,
      card.card,
    );

    if (!created.ok) {
      return failure(`이미 있습니다: narrator/${id}.card`);
    }

    return success(
      `narrator/${id}.card 를 만들었습니다. 씬 카드의 narrator 에 이 id 를 적으면 그 씬에 적용됩니다.`,
      { ...toNarratorData(card.card), path: (created.uri as StoryUri).fsPath },
    );
  }
}
