import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { describeSceneNarration } from '@/commands/card/narratorViews';
import { failure, success } from '@/commands/outcomes';
import { resolveSceneStemFrom } from '@/commands/sceneArguments';
import {
  sceneBeatText,
  type SceneBeat,
  type SceneBeatDetail,
  type SceneFile,
  type SceneTargetLength,
  type SceneTargetLengthOrigin,
} from '@storyboard/story-model';
import type { SceneThreadContext } from '@storyboard/story-engine';

const targetLengthOriginLabels: Readonly<Record<SceneTargetLengthOrigin, string>> = {
  'scene-card': '씬 카드',
  'scene-body': '씬 본문의 [목표 분량]',
  derived: '씬 개요 길이로 정함',
};

interface NumberedSceneBeat {
  readonly number: number;
  readonly text: string;
  readonly cast?: readonly string[];
  readonly place?: string;
  readonly time?: string;
}

function numberSceneBeats(beats: readonly SceneBeat[] | undefined): NumberedSceneBeat[] {
  return (beats ?? []).map((beat, index) => {
    const detail: Omit<SceneBeatDetail, 'text' | 'break'> = typeof beat === 'string' ? {} : beat;
    return {
      number: index + 1,
      text: sceneBeatText(beat),
      ...(detail.cast === undefined ? {} : { cast: detail.cast }),
      ...(detail.place === undefined ? {} : { place: detail.place }),
      ...(detail.time === undefined ? {} : { time: detail.time }),
    };
  });
}

function describeTargetLength(targetLength: SceneTargetLength | undefined): string {
  return targetLength === undefined
    ? '목표 분량: 정해지지 않음 (scene set --target-words 로 정할 수 있습니다)'
    : `목표 분량: 약 ${targetLength.targetLength.toLocaleString('en-US')}자 (${targetLengthOriginLabels[targetLength.origin]})`;
}

export class SceneShowCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'scene show',
    group: '씬',
    usage: 'scene show <stem>',
    summary: '씬 카드의 내용과 이 씬에 적용될 시점·줄기·목표 분량을 보여 줍니다',
    examples: ['storyboard scene show 003-night-market'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const stem: string | undefined = await resolveSceneStemFrom(container, args);

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
    const targetLength: SceneTargetLength | undefined = await container.drafts.resolveSceneTargetLength(
      container.workspaceRoot,
      scene,
    );

    return success(
      [
        `${scene.card.title ?? stem} (${stem})`,
        `시점: ${narration}`,
        `줄기: ${thread}`,
        describeTargetLength(targetLength),
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
        targetLength: targetLength?.targetLength ?? null,
        targetLengthOrigin: targetLength?.origin ?? null,
        beats: numberSceneBeats(scene.card.beats),
      },
    );
  }
}
