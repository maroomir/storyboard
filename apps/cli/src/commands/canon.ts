import { flagBoolean } from '@/cliArguments';
import type { CommandHandler } from '@/commands/outcome';
import { describeNothingToPromote, success } from '@/commands/outcomes';
import type { PrepareBibleCandidatePromotionResult } from '@storyboard/story-engine';
import {
  diffCandidatesAgainstCanon,
  type BibleCandidateRecord,
  type StoryBible,
} from '@storyboard/story-model';

export const promoteBible: CommandHandler = async ({ container, args }) => {
  const prepared: PrepareBibleCandidatePromotionResult =
    await container.cards.prepareBiblePromotion(container.workspaceRoot);

  if (prepared.kind !== 'ready') {
    return success(describeNothingToPromote(prepared.kind), prepared);
  }

  if (flagBoolean(args.flags, 'dry-run')) {
    return success(`승격 후보 ${prepared.facts.length}건`, prepared.facts);
  }

  await container.cards.promoteBibleFacts(container.workspaceRoot, prepared.facts);
  return success(`정전에 ${prepared.facts.length}건을 반영했습니다.`, prepared.facts);
};

export const canonDiff: CommandHandler = async ({ container }) => {
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
};
