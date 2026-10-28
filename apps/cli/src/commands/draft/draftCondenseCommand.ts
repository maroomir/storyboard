import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { LineRange, rangeFrom } from '@/commands/draft/draftLines';
import { DraftRewriter } from '@/commands/draft/draftRewriting';
import { failure } from '@/commands/outcomes';
import { sceneStemFrom } from '@/commands/sceneArguments';
import type { CondenseDraftResult } from '@storyboard/story-engine';
import type { StoryboardProject } from '@storyboard/story-model';

export class DraftCondenseCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'draft condense',
    writesWorkspace: true,
    rewritesDraft: true,
    group: '초안',
    usage: 'draft condense <stem>',
    summary: '초안을 압축합니다',
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

    const project: StoryboardProject = await container.novel.readProject(container.workspaceRoot);

    return new DraftRewriter(container).rewriteDraft(stem, range, async (target) => {
      const condensed: CondenseDraftResult = await container.drafts.condense({
        workspaceRoot: container.workspaceRoot,
        sceneStem: stem,
        format: project.format,
        body: target,
        maxCompressionPercent: container.configBridge.getMaxCompressionPercent(),
      });

      return condensed.ok
        ? { ok: true, text: condensed.text, message: '초안을 압축했습니다.' }
        : failure(`압축하지 못했습니다 (${condensed.kind}).`);
    });
  }
}
