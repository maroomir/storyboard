import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import { type CommandSpec, draftCheckKinds } from '@/commands/catalog';
import { DraftRewriter } from '@/commands/draft/draftRewriting';
import { failure, success } from '@/commands/outcomes';
import { sceneStemFrom } from '@/commands/sceneArguments';
import type { CheckDraftResult, DraftCheckKind } from '@storyboard/story-engine';

export class DraftCheckCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'draft check',
    group: '초안',
    usage: `draft check <${draftCheckKinds.join('|')}> <stem>`,
    summary:
      '초안을 검사합니다 — grammar 문법, continuity 정전과 어긋나는 곳, slop 상투 표현(AI 호출 없음). 문제가 있으면 종료 코드 1',
    examples: [
      'storyboard draft check slop 01-scene-1-1',
      'storyboard draft check continuity 01-scene-1-1 --json',
    ],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const kind: DraftCheckKind | undefined = draftCheckKinds.find(
      (candidate) => candidate === args.positionals[0],
    );
    const stem: string | undefined = sceneStemFrom(args, 1);

    if (kind === undefined) {
      return failure(
        `검사 종류를 지정해 주세요: storyboard draft check <${draftCheckKinds.join('|')}> <stem>`,
      );
    }

    if (stem === undefined) {
      return failure('씬 stem 을 지정해 주세요.');
    }

    const body: string | undefined = await new DraftRewriter(container).readDraftBody(stem);

    if (body === undefined) {
      return failure(`초안이 없습니다: ${stem}`);
    }

    const draftCheck: CheckDraftResult = await container.drafts.check({
      workspaceRoot: container.workspaceRoot,
      sceneStem: stem,
      kind,
      text: body,
    });

    return describeDraftCheck(draftCheck);
  }
}

function describeFindingCount(
  findings: readonly unknown[],
  cleanMessage: string,
): Pick<CommandOutcome, 'ok' | 'message'> {
  return {
    ok: findings.length === 0,
    message: findings.length === 0 ? cleanMessage : `${findings.length}건`,
  };
}

function describeDraftCheck(draftCheck: CheckDraftResult): CommandOutcome {
  switch (draftCheck.kind) {
    case 'failed':
      return failure(draftCheck.message);
    case 'slop':
      return {
        ...describeFindingCount(draftCheck.findings, '상투 표현을 찾지 못했습니다.'),
        data: draftCheck.findings,
      };
    case 'grammar':
      return {
        ...describeFindingCount(draftCheck.issues, '문법 문제를 찾지 못했습니다.'),
        data: draftCheck.issues,
      };
    case 'continuity':
      if (!draftCheck.hasFacts) {
        return success('대조할 정전 사실이 없습니다.', []);
      }

      return {
        ...describeFindingCount(draftCheck.issues, '연속성 문제를 찾지 못했습니다.'),
        data: draftCheck.issues,
      };
  }
}
