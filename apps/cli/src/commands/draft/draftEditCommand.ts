import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { LineRange, rangeFrom } from '@/commands/draft/draftLines';
import { DraftRewriter } from '@/commands/draft/draftRewriting';
import { flagBoolean, flagString } from '@/cliArguments';
import { failure } from '@/commands/outcomes';
import { sceneStemFrom } from '@/commands/sceneArguments';

export class DraftEditCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'draft edit',
    writesWorkspace: true,
    rewritesDraft: true,
    group: '초안',
    usage: 'draft edit <stem> --instruction <text>',
    summary: '지시대로 고칩니다 (--lines 로 구간 지정)',
    flags: ['instruction', 'lines', 'dry-run'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const stem: string | undefined = sceneStemFrom(args);
    const range: LineRange | 'invalid' | undefined = rangeFrom(args);
    const instruction: string | undefined = flagString(args.flags, 'instruction');

    if (stem === undefined) {
      return failure('씬 stem 을 지정해 주세요.');
    }

    if (range === 'invalid') {
      return failure('--lines 는 40-60 형식이어야 합니다.');
    }

    if (instruction === undefined || instruction.trim().length === 0) {
      return failure('--instruction 으로 어떻게 고칠지 알려 주세요.');
    }

    return new DraftRewriter(container).augmentDraftRange(stem, range, {
      scope: 'selection',
      instruction,
      isDryRun: flagBoolean(args.flags, 'dry-run'),
      appliedMessage: '지시대로 고쳤습니다.',
      proposedMessage: '수정안을 만들었습니다 (적용하지 않음).',
      failedLabel: '고치지 못했습니다',
    });
  }
}
