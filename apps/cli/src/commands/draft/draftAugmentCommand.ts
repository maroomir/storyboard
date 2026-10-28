import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { LineRange, rangeFrom } from '@/commands/draft/draftLines';
import { DraftRewriter } from '@/commands/draft/draftRewriting';
import { flagBoolean, flagString } from '@/cliArguments';
import { failure } from '@/commands/outcomes';
import { sceneStemFrom } from '@/commands/sceneArguments';

export class DraftAugmentCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'draft augment',
    writesWorkspace: true,
    rewritesDraft: true,
    group: '초안',
    usage: 'draft augment <stem>',
    summary: '갱신된 카드·정전을 기존 초안에 녹입니다',
    flags: ['lines', 'instruction', 'dry-run'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const stem: string | undefined = sceneStemFrom(args);
    const range: LineRange | 'invalid' | undefined = rangeFrom(args);

    if (stem === undefined) {
      return failure('씬 stem 을 지정해 주세요.');
    }

    if (range === 'invalid') {
      return failure('--lines 는 40-60 형식이어야 합니다.');
    }

    return new DraftRewriter(container).augmentDraftRange(stem, range, {
      scope: range === undefined ? 'draft' : 'selection',
      instruction: flagString(args.flags, 'instruction'),
      isDryRun: flagBoolean(args.flags, 'dry-run'),
      appliedMessage: '카드 기반 보충을 반영했습니다.',
      proposedMessage: '보충안을 만들었습니다 (적용하지 않음).',
      failedLabel: '보충하지 못했습니다',
    });
  }
}
