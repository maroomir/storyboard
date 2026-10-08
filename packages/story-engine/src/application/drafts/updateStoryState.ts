import {
  mergeStoryState,
  readStoryState,
  recordStoryStateScene,
  writeStoryState,
  formatStoryStateForPrompt,
  type StoryStateEntry,
} from '@storyboard/story-model';
import type { StoryboardAiService } from '@storyboard/story-ai';
import type { StoryStateUpdateItem } from '@storyboard/story-model';
import type { GenerateDraftWorkflowOptions } from './generateDraftTypes';
import type { SceneGenerationInputs } from './sceneGenerationInputs';

// NOTE: 목격자는 그 사실이 확립되는 자리에 있던 인물이다. 목격 범위 서술자가 자기가 없던 자리의
// 사실을 아는 것을 막으려면 누가 그 자리에 있었는지를 남겨 두어야 한다. 모델이 항목마다 이름을
// 달아 주면 그것을 카드 id로 옮긴다. 달지 않았거나, 단 이름 중 하나라도 카드와 맞지 않으면 씬의
// 모든 인물이다 — 성을 뺀 이름이나 호칭을 붙인 이름을 버리면 그 인물이 실제로 본 사실이 그 인물의
// 지식에서 조용히 빠지기 때문이다. 좁히는 것은 모든 이름이 맞을 때만이다.
export interface StoryStateEntryMapping {
  readonly entries: StoryStateEntry[];
  readonly unknownWitnesses: readonly string[];
}

export function toStoryStateEntries(
  items: readonly StoryStateUpdateItem[],
  characters: readonly {
    readonly id: string;
    readonly name: string;
    readonly aliases?: readonly string[];
  }[],
): StoryStateEntryMapping {
  const everyone = characters.map((character) => character.id);
  const idByName = new Map<string, string>();
  for (const character of characters) {
    idByName.set(character.name, character.id);
    for (const alias of character.aliases ?? []) {
      idByName.set(alias, character.id);
    }
  }

  const unknownWitnesses = new Set<string>();
  const entries = items.map((item) => {
    const names = item.witnesses ?? [];
    const unknown = names.filter((name) => !idByName.has(name));
    unknown.forEach((name) => unknownWitnesses.add(name));

    const witnesses =
      names.length === 0 || unknown.length > 0
        ? everyone
        : [...new Set(names.map((name) => idByName.get(name) as string))];

    return {
      section: item.section,
      text: item.text,
      ...(witnesses.length > 0 ? { witnesses } : {}),
    };
  });

  return { entries, unknownWitnesses: [...unknownWitnesses] };
}

// NOTE: 다음 씬 생성이 이 원장을 읽으므로 백그라운드 큐가 아니라 저장 경로에서 await 한다.
// 실패해도 초안 저장은 이미 끝난 뒤이므로 경고만 남기고 생성 흐름을 막지 않는다.
export async function updateStoryStateAfterGeneration(
  inputs: SceneGenerationInputs,
  options: GenerateDraftWorkflowOptions,
  aiService: StoryboardAiService,
  draftBody: string,
): Promise<void> {
  const { threadPaths, scene, context, inputHash } = inputs;

  try {
    const previous = await readStoryState(threadPaths.storyState, options.fileSystem);
    const items = await aiService.updateStoryState(
      {
        sceneTitle: scene.stem,
        draftBody,
        previousState: formatStoryStateForPrompt(previous, scene.order, draftBody),
      },
      {
        providerId: options.aiGateway.getTaskProvider('storyStateUpdate'),
        attribution: { primary: { kind: 'scene', id: scene.stem } },
      },
    );

    const mapping = toStoryStateEntries(items, context.characters);
    if (mapping.unknownWitnesses.length > 0) {
      options.logger.warn(
        `${scene.stem}: 이야기 상태의 목격자 이름 ${mapping.unknownWitnesses.join(', ')}이(가) 등장인물 카드와 맞지 않아 그 항목은 씬의 모든 인물이 아는 것으로 기록했습니다`,
      );
    }

    const merged =
      items.length === 0
        ? recordStoryStateScene(previous, scene.order, inputHash)
        : mergeStoryState(previous, mapping.entries, scene.order, inputHash);

    await writeStoryState(threadPaths.storyState, merged, options.fileSystem);
  } catch (error) {
    options.logger.warn(`이야기 상태를 갱신하지 못했습니다: ${String(error)}`);
  }
}
