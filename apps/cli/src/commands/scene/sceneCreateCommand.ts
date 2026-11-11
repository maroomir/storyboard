import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { describeLineDiff } from '@/commands/card/cardEditCommand';
import { flagString } from '@/cliArguments';
import { failure, success } from '@/commands/outcomes';
import type { CliContainer } from '@/container';
import type { CreateSceneResult, StudioCreateResult } from '@storyboard/story-engine';
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
    usage: 'scene create ["<설명>"] [--name <slug>] [--after <씬>]',
    summary:
      '씬 카드를 만들고 설명이 있으면 스튜디오가 채웁니다 (--after 면 그 씬 뒤에 끼우고 뒤 씬 번호를 다시 매김)',
    flags: ['name', 'after'],
    examples: [
      'storyboard scene create "옥상에서 둘이 처음 마주친다" --name rooftop',
      'storyboard scene create --name rain --after 2',
    ],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const description: string | undefined = args.positionals[0]?.trim() || undefined;
    const name: string | undefined = flagString(args.flags, 'name');
    const after: string | undefined = flagString(args.flags, 'after');

    if (description === undefined && (name === undefined || name.trim().length === 0)) {
      return failure('씬을 설명하거나 --name 으로 이름을 주세요: storyboard scene create "<설명>"');
    }

    const slug: string | undefined = name === undefined ? undefined : slugify(name);
    return description === undefined
      ? await this.createEmpty(container, slug, after)
      : await this.createDescribed(container, description, slug, after);
  }

  private async createEmpty(
    container: CliContainer,
    slug: string | undefined,
    after: string | undefined,
  ): Promise<CommandOutcome> {
    const created: CreateSceneResult = await container.drafts.createScene({
      workspaceRoot: container.workspaceRoot,
      ...(slug === undefined ? {} : { slug }),
      ...(after === undefined ? {} : { after }),
    });

    return created.ok
      ? success(`${created.stem}.card 를 만들었습니다.`, {
          stem: created.stem,
          path: (created.uri as StoryUri).fsPath,
        })
      : failure(created.message);
  }

  private async createDescribed(
    container: CliContainer,
    description: string,
    slug: string | undefined,
    after: string | undefined,
  ): Promise<CommandOutcome> {
    const sceneCount: number = (await container.drafts.listScenes(container.workspaceRoot)).length;
    const created: StudioCreateResult = await container.studio.create({
      workspaceRoot: container.workspaceRoot,
      kind: 'scene',
      slug: slug ?? `scene-${sceneCount + 1}`,
      name: slug ?? description,
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
