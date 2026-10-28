import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import type { AssembleManuscriptResult } from '@storyboard/story-engine';

export class ManuscriptAssembleCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'manuscript assemble',
    writesWorkspace: true,
    group: '원고',
    usage: 'manuscript assemble',
    summary: 'draft/ 를 원고로 조립합니다',
  };

  public async execute({ container }: CommandContext): Promise<CommandOutcome> {
    const assembly: AssembleManuscriptResult = await container.manuscript.assemble({
      workspaceRoot: container.workspaceRoot,
    });
    return {
      ok: assembly.ok,
      message: assembly.ok ? '원고를 조립했습니다.' : '조립하지 못했습니다.',
      data: assembly,
    };
  }
}
