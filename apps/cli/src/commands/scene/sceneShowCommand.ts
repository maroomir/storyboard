import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { describeSceneNarration } from '@/commands/narrator/narratorViews';
import { failure, success } from '@/commands/outcomes';
import { sceneStemFrom } from '@/commands/sceneArguments';
import type { SceneFile } from '@storyboard/story-model';
import type { SceneThreadContext } from '@storyboard/story-engine';

export class SceneShowCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'scene show',
    group: '씬',
    usage: 'scene show <stem>',
    summary: '씬 카드의 내용과 이 씬에 적용될 시점·줄기를 보여 줍니다',
    examples: ['storyboard scene show 03-night-market'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const stem: string | undefined = sceneStemFrom(args);

    if (stem === undefined) {
      return failure('씬 stem 을 지정해 주세요.');
    }

    const scene: SceneFile | undefined = await container.drafts.readScene(
      container.workspaceRoot,
      stem,
    );

    if (scene === undefined) {
      return failure(`씬을 찾을 수 없습니다: ${stem}`);
    }
    const narration: string = await describeSceneNarration(container, scene);
    const { threadId: thread }: SceneThreadContext = await container.drafts.resolveSceneThread(
      container.workspaceRoot,
      scene,
    );

    return success(
      [
        `${scene.card.title ?? stem} (${stem})`,
        `시점: ${narration}`,
        `줄기: ${thread}`,
        ...(scene.card.characters && scene.card.characters.length > 0
          ? [`인물: ${scene.card.characters.join(', ')}`]
          : []),
        ...(scene.card.location === undefined ? [] : [`배경: ${scene.card.location}`]),
        ...(scene.card.summary === undefined ? [] : ['', scene.card.summary]),
      ].join('\n'),
      {
        stem,
        title: scene.card.title ?? null,
        narrator: scene.card.narrator ?? null,
        narration,
        thread,
        characters: scene.card.characters ?? [],
      },
    );
  }
}
