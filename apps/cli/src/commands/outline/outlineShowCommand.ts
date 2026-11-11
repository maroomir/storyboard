import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { flagBoolean } from '@/cliArguments';
import { success } from '@/commands/outcomes';
import type { CliContainer } from '@/container';
import type { NoteSynopsisCandidate } from '@storyboard/story-engine';
import type { ChapterPlan } from '@storyboard/story-model';

function describeChapterPlan(plan: ChapterPlan): string[] {
  return plan.acts.flatMap((act) => [
    act.title,
    ...act.chapters.map((chapter) => `  ${chapter.title} · 씬 ${chapter.scenes.length}개`),
  ]);
}

function describeCandidate(candidate: NoteSynopsisCandidate): string[] {
  return [`── ${candidate.location} (${candidate.absorbedAt})`, candidate.markdown.trimEnd()];
}

export class OutlineShowCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'outline show',
    group: '기획',
    usage: 'outline show [--pending]',
    summary: '장 계획을 보여 줍니다 (--pending 이면 적용을 기다리는 시놉시스 후보)',
    flags: ['pending'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    return flagBoolean(args.flags, 'pending')
      ? await this.showPending(container)
      : await this.showChapterPlan(container);
  }

  private async showPending(container: CliContainer): Promise<CommandOutcome> {
    const candidates: readonly NoteSynopsisCandidate[] = await container.notes.listSynopsisCandidates(
      container.workspaceRoot,
    );

    return candidates.length === 0
      ? success('기다리는 시놉시스 후보가 없습니다.', { candidates })
      : success(
          [
            ...candidates.flatMap(describeCandidate),
            '받으려면 storyboard outline apply, 버리려면 storyboard outline discard',
          ].join('\n'),
          { candidates },
        );
  }

  private async showChapterPlan(container: CliContainer): Promise<CommandOutcome> {
    const plan: ChapterPlan | undefined = await container.novel.readChapterPlan(
      container.workspaceRoot,
    );

    return plan === undefined
      ? success('장 계획이 없습니다. storyboard outline generate 로 만드세요.', { plan: null })
      : success(describeChapterPlan(plan).join('\n'), { plan });
  }
}
