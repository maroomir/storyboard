import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { success } from '@/commands/outcomes';
import type { SceneListItem } from '@storyboard/story-model';

export const draftStatusLabels: Readonly<Record<SceneListItem['status'], string>> = {
  missing: '초안 없음',
  ready: '초안 있음',
  stale: '초안이 카드보다 오래됨',
};

export class SceneListCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'scene list',
    group: '씬',
    usage: 'scene list',
    summary: '씬 카드를 번호순으로, 초안이 있는지와 함께 봅니다',
    examples: [
      'storyboard scene list',
      'storyboard scene list --json | jq -r ".data.scenes[].stem"',
    ],
  };

  public async execute({ container }: CommandContext): Promise<CommandOutcome> {
    const scenes: SceneListItem[] = await container.drafts.listScenes(container.workspaceRoot);

    if (scenes.length === 0) {
      return success('씬 카드가 없습니다.', { scenes: [] });
    }

    return success(
      scenes
        .map((scene) => `${scene.stem}\t${scene.title ?? ''}\t${draftStatusLabels[scene.status]}`)
        .join('\n'),
      {
        scenes: scenes.map((scene) => ({
          stem: scene.stem,
          order: scene.order,
          title: scene.title ?? null,
          draft: scene.status,
        })),
      },
    );
  }
}
