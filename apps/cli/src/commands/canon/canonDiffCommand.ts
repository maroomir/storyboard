import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { success } from '@/commands/outcomes';
import {
  diffCandidatesAgainstCanon,
  type BibleCandidateRecord,
  type StoryBible,
} from '@storyboard/story-model';

export class CanonDiffCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'canon diff',
    group: '카드와 정전',
    usage: 'canon diff',
    summary: '정전에 아직 없는 설정 후보를 보고합니다 (읽기 전용)',
  };

  public async execute({ container }: CommandContext): Promise<CommandOutcome> {
    const canon: StoryBible = await container.cards.bibleCandidates.loadCanon(
      container.workspaceRoot,
    );
    const candidates: readonly BibleCandidateRecord[] =
      await container.cards.bibleCandidates.loadRecords(container.workspaceRoot);
    const { pending } = diffCandidatesAgainstCanon(canon, candidates);

    return success(
      pending.length === 0 ? '정전과 어긋나는 후보가 없습니다.' : `미승격 후보 ${pending.length}건`,
      pending,
    );
  }
}
