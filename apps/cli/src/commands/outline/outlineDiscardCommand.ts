import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { success } from '@/commands/outcomes';

export class OutlineDiscardCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'outline discard',
    writesWorkspace: true,
    group: '기획',
    usage: 'outline discard [<위치>]',
    summary: '노트 흡수가 남긴 시놉시스 후보를 버립니다 (위치가 없으면 전부)',
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const discarded: number = await container.notes.discardSynopsisCandidates(
      container.workspaceRoot,
      args.positionals[0],
    );

    return success(
      discarded === 0 ? '버릴 시놉시스 후보가 없습니다.' : `시놉시스 후보 ${discarded}개를 버렸습니다.`,
      { discarded },
    );
  }
}
