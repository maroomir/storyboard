import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import {
  describeDrafts,
  describeManuscript,
  describeMissingContract,
  describeNextStep,
  nextStepCommands,
} from '@/commands/workspaceNextStep';
import type { WorkspaceStatus } from '@storyboard/story-app';
import { success } from '@/commands/outcomes';

export class StatusCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'status',
    group: '시작하기',
    usage: 'status',
    summary:
      '작품 현황(계약·아웃라인·카드·씬·초안·정전 후보·원고)과 다음에 실행할 명령을 보여 줍니다',
    examples: ['storyboard status', 'storyboard status --json | jq -r .data.next.command'],
  };

  public async execute({ container }: CommandContext): Promise<CommandOutcome> {
    const status: WorkspaceStatus = await container.describeWorkspace();
    const command: string | undefined = nextStepCommands[status.nextStep];
    const reason: string = describeNextStep(status);

    return success(
      [
        status.project.name,
        `계약      ${status.project.missingContract.length === 0 ? '채워짐' : `${describeMissingContract(status)} 비어 있음`}`,
        `아웃라인  ${status.outline.hasChapterPlan ? '있음' : '없음'}`,
        `카드      인물 ${status.cards.characters} · 배경 ${status.cards.backgrounds} · 서술자 ${status.cards.narrators}`,
        `씬        ${status.scenes.total}`,
        `초안      ${describeDrafts(status)}`,
        `정전      미승격 후보 ${status.canon.pendingFacts}건`,
        `원고      ${describeManuscript(status)}`,
        '',
        command === undefined
          ? `다음      ${reason}`
          : `다음      storyboard ${command} — ${reason}`,
      ].join('\n'),
      { ...status, next: { step: status.nextStep, command: command ?? null, reason } },
    );
  }
}
