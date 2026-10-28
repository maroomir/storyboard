import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { LineRange, rangeFrom } from '@/commands/draft/draftLines';
import { DraftRewriter } from '@/commands/draft/draftRewriting';
import { failure } from '@/commands/outcomes';
import { sceneStemFrom } from '@/commands/sceneArguments';
import type { ExpandDraftResult } from '@storyboard/story-engine';

export class DraftExpandCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'draft expand',
    writesWorkspace: true,
    rewritesDraft: true,
    group: '초안',
    usage: 'draft expand <stem>',
    summary: '초안을 늘립니다',
    flags: ['lines'],
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

    return new DraftRewriter(container).rewriteDraft(stem, range, async (target) => {
      const expanded: ExpandDraftResult = await container.drafts.expand({
        workspaceRoot: container.workspaceRoot,
        sceneStem: stem,
        selectedText: target,
      });

      return expanded.ok
        ? { ok: true, text: expanded.text, message: '구간을 늘렸습니다.' }
        : failure(`늘리지 못했습니다 (${expanded.kind}).`);
    });
  }
}
