import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { success } from '@/commands/outcomes';
import { formatSceneNumber, mainThreadId, type SceneListItem } from '@storyboard/story-model';

export const draftStatusLabels: Readonly<Record<SceneListItem['status'], string>> = {
  missing: '초안 없음',
  ready: '초안',
  stale: '낡음',
};

function threadOf(scene: SceneListItem): string {
  return scene.thread ?? mainThreadId;
}

function describeRow(scene: SceneListItem, shouldShowThread: boolean): string {
  return [
    formatSceneNumber(scene.order),
    ...(shouldShowThread ? [threadOf(scene)] : []),
    scene.title ?? scene.slug,
    draftStatusLabels[scene.status],
  ].join('\t');
}

export class SceneListCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'scene list',
    group: '씬',
    usage: 'scene list',
    summary: '씬을 번호 · 줄기 · 제목 · 상태로 봅니다 (줄기가 하나면 줄기 열은 숨김)',
    examples: [
      'storyboard scene list',
      'storyboard scene list --json | jq -r ".data.scenes[].slug"',
    ],
  };

  public async execute({ container }: CommandContext): Promise<CommandOutcome> {
    const scenes: SceneListItem[] = await container.drafts.listScenes(container.workspaceRoot);

    if (scenes.length === 0) {
      return success('씬 카드가 없습니다.', { scenes: [] });
    }

    const shouldShowThread: boolean = new Set(scenes.map(threadOf)).size > 1;
    const header: string = ['번호', ...(shouldShowThread ? ['줄기'] : []), '제목', '상태'].join('\t');

    return success([header, ...scenes.map((scene) => describeRow(scene, shouldShowThread))].join('\n'), {
      scenes: scenes.map((scene) => ({
        uuid: scene.id ?? null,
        slug: scene.slug,
        number: scene.order,
        thread: threadOf(scene),
        title: scene.title ?? null,
        draft: scene.status,
        stem: scene.stem,
      })),
    });
  }
}
