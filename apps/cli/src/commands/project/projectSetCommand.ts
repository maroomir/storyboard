import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { WorkspaceInput, type ContractInput } from '@/commands/workspaceInput';
import { failure, success } from '@/commands/outcomes';
import type { UpdateProjectContractResult } from '@storyboard/story-engine';

export class ProjectSetCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'project set',
    writesWorkspace: true,
    group: '기획',
    usage: 'project set [--genre …]',
    summary: '작품 계약을 고칩니다 (적지 않은 항목은 그대로 둡니다)',
    flags: [
      'from',
      'genre',
      'audience',
      'pov',
      'target-words',
      'chapters',
      'scenes-per-chapter',
      'concept',
      'description',
      'composition',
      'episodes',
      'pov-characters',
    ],
    examples: [
      'storyboard project set --target-words 320000',
      'storyboard project set --composition alternating-pov --pov-characters hana,jun',
      'storyboard project set --from contract.json',
    ],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const contract: ContractInput = await new WorkspaceInput(container).readContract(args);

    if ('message' in contract) {
      return failure(contract.message);
    }

    if (contract.setting === undefined) {
      return failure(
        '바꿀 값을 지정해 주세요. --genre --audience --pov --target-words --chapters --scenes-per-chapter --concept --description --composition 또는 --from <json>.',
      );
    }

    const updated: UpdateProjectContractResult = await container.project.updateContract({
      workspaceRoot: container.workspaceRoot,
      setting: contract.setting,
      ...(contract.narratorCards === undefined ? {} : { narratorCards: contract.narratorCards }),
    });

    if (!updated.ok) {
      return failure(updated.message);
    }

    return success('작품 계약을 갱신했습니다.', updated.setting);
  }
}
