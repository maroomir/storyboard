import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { failure, success } from '@/commands/outcomes';
import type { ApplySynopsisCandidateResult } from '@storyboard/story-engine';

export class OutlineApplyCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'outline apply',
    writesWorkspace: true,
    group: '기획',
    usage: 'outline apply [<위치>]',
    summary: '노트 흡수가 남긴 시놉시스 후보를 outline/synopsis.md 에 씁니다 (위치가 없으면 가장 최근 것)',
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const applied: ApplySynopsisCandidateResult = await container.notes.applySynopsisCandidate(
      container.workspaceRoot,
      args.positionals[0],
    );

    return applied.ok
      ? success(`✓ 시놉시스를 바꿨습니다 (${applied.location}). 남은 후보는 지웠습니다.`, applied)
      : failure(applied.message, applied);
  }
}
