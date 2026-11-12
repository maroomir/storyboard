import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { describeLineDiff } from '@/commands/card/cardEditCommand';
import { flagString } from '@/cliArguments';
import { failure, success } from '@/commands/outcomes';
import type { CliContainer } from '@/container';
import type { StudioCreateResult } from '@storyboard/story-engine';
import { slugify, type StoryUri } from '@storyboard/story-model';

function describeFill(edit: Extract<StudioCreateResult, { readonly ok: true }>['edit']): string[] {
  if (!edit.ok) {
    return [`설명을 씬에 채우지 못했습니다: ${edit.message}`];
  }
  if (edit.kind === 'proposed') {
    return [`제안: ${edit.summary}`, ...describeLineDiff(edit.diff)];
  }

  return edit.kind === 'applied' ? [`✓ ${edit.summary}`] : [`스튜디오: ${edit.message}`];
}

export class SceneCreateCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'scene create',
    writesWorkspace: true,
    group: '씬',
    usage: 'scene create "<설명>" [--name <slug>] [--after <씬>]',
    summary:
      '설명에서 씬 카드를 만들고 스튜디오가 채웁니다 (--after 면 그 씬 뒤에 끼우고 뒤 씬 번호를 다시 매김)',
    flags: ['name', 'after'],
    examples: [
      'storyboard scene create "옥상에서 둘이 처음 마주친다" --name rooftop',
      'storyboard scene create "골목에 비가 쏟아진다" --name rain --after 2',
    ],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const description: string | undefined = args.positionals[0]?.trim() || undefined;
    const name: string | undefined = flagString(args.flags, 'name');
    const after: string | undefined = flagString(args.flags, 'after');

    if (description === undefined) {
      return failure('씬을 설명해 주세요: storyboard scene create "<설명>"');
    }

    const slug: string | undefined = name === undefined ? undefined : slugify(name);
    return await this.createDescribed(container, description, slug, after);
  }

  private async createDescribed(
    container: CliContainer,
    description: string,
    slug: string | undefined,
    after: string | undefined,
  ): Promise<CommandOutcome> {
    const created: StudioCreateResult = await container.studio.create({
      workspaceRoot: container.workspaceRoot,
      kind: 'scene',
      ...(slug === undefined ? {} : { slug }),
      description,
      shouldPropose: false,
      ...(after === undefined ? {} : { after }),
    });
    if (!created.ok) {
      return failure(created.message, created);
    }

    return success(
      [`✓ ${created.key}.card 를 만들었습니다.`, ...describeFill(created.edit)].join('\n'),
      { stem: created.key, path: (created.uri as StoryUri).fsPath, edit: created.edit },
    );
  }
}
