import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { flagBoolean } from '@/cliArguments';
import { failure, success } from '@/commands/outcomes';
import type { ElementBundle, StudioEditResult, StudioProposalDiff } from '@storyboard/story-engine';

type EditableKind = 'character' | 'background';

function isEditableKind(kind: string): kind is EditableKind {
  return kind === 'character' || kind === 'background';
}

export function describeLineDiff(diff: StudioProposalDiff): string[] {
  const before: readonly string[] = diff.before.split('\n');
  const after: readonly string[] = diff.after.split('\n');
  const kept: ReadonlySet<string> = new Set(before.filter((line) => after.includes(line)));

  return [
    `--- ${diff.targetFile}`,
    ...before.filter((line) => !kept.has(line) && line.trim().length > 0).map((line) => `- ${line}`),
    ...after.filter((line) => !kept.has(line) && line.trim().length > 0).map((line) => `+ ${line}`),
  ];
}

function describeEdit(slug: string, result: Extract<StudioEditResult, { readonly ok: true }>): string {
  switch (result.kind) {
    case 'applied':
      return `✓ ${result.summary}\n  ${result.message}`;
    case 'proposed':
      return [
        `제안: ${result.summary}`,
        ...describeLineDiff(result.diff),
        `받으려면 storyboard card apply ${slug}, 버리려면 storyboard card discard ${slug}`,
      ].join('\n');
    default:
      return result.message;
  }
}

export class CardEditCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'card edit',
    writesWorkspace: true,
    group: '카드',
    usage: 'card edit <slug> "<지시>" [--propose]',
    summary: '스튜디오의 «고치기»로 카드를 고칩니다 (바로 씀, --propose 면 세션에 제안과 diff 만)',
    flags: ['propose'],
    examples: [
      'storyboard card edit elia "말투를 더 퉁명스럽게"',
      'storyboard card edit elia "과거사를 보강" --propose',
    ],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const [slug, instruction] = args.positionals;
    if (slug === undefined || instruction === undefined || instruction.trim().length === 0) {
      return failure('고칠 카드와 지시를 주세요: storyboard card edit <slug> "<지시>"');
    }

    const bundle: ElementBundle | undefined = await container.cards.readBundle(
      container.workspaceRoot,
      slug,
    );
    const kind: string | undefined = bundle?.header.kind;
    if (kind === undefined || !isEditableKind(kind)) {
      return failure(
        kind === undefined
          ? `카드를 찾을 수 없습니다: ${slug}`
          : `스튜디오는 아직 ${kind} 카드를 고치지 않습니다: ${slug}`,
      );
    }

    const result: StudioEditResult = await container.studio.edit({
      workspaceRoot: container.workspaceRoot,
      entity: { kind, key: slug },
      instruction,
      shouldPropose: flagBoolean(args.flags, 'propose'),
    });

    return result.ok ? success(describeEdit(slug, result), result) : failure(result.message, result);
  }
}
