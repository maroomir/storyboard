import {
  mergeStoryState,
  readStoryState,
  recordStoryStateScene,
  writeStoryState,
  formatStoryStateForPrompt,
  type StoryStateEntry,
} from '@storyboard/story-model';
import type { StoryboardAiService } from '@storyboard/story-ai';
import type { StoryState, StoryStateUpdateItem } from '@storyboard/story-model';
import type { GenerateDraftWorkflowOptions } from './draftGenerationContract';
import type { SceneGenerationInputs } from './sceneGenerationInputs';

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
  const everyone: string[] = characters.map((character) => character.id);
  const idByName: Map<string, string> = witnessIdsByName(characters);

  const unknownWitnesses: Set<string> = new Set<string>();
  const entries: StoryStateUpdateItem[] = items.map((item): StoryStateUpdateItem => {
    const names: readonly string[] = item.witnesses ?? [];
    const unknown: string[] = names.filter((name) => !idByName.has(name));
    unknown.forEach((name) => unknownWitnesses.add(name));

    const witnesses: string[] =
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

function witnessIdsByName(
  characters: readonly {
    readonly id: string;
    readonly name: string;
    readonly aliases?: readonly string[];
  }[],
): Map<string, string> {
  const idByName: Map<string, string> = new Map<string, string>();
  for (const character of characters) {
    idByName.set(character.name, character.id);
    for (const alias of character.aliases ?? []) {
      idByName.set(alias, character.id);
    }
  }

  const idsByToken: Map<string, Set<string>> = new Map<string, Set<string>>();
  for (const character of characters) {
    for (const token of character.name.split(/\s+/).filter((part) => part.length > 0)) {
      idsByToken.set(token, new Set([...(idsByToken.get(token) ?? []), character.id]));
    }
  }
  for (const [token, ids] of idsByToken) {
    if (!idByName.has(token) && ids.size === 1) {
      idByName.set(token, [...ids][0] as string);
    }
  }

  return idByName;
}

export function witnessNameLabels(
  characters: readonly { readonly name: string; readonly aliases?: readonly string[] }[],
): string[] {
  return characters.map((character) =>
    character.aliases && character.aliases.length > 0
      ? `${character.name} (별칭: ${character.aliases.join(', ')})`
      : character.name,
  );
}

export async function updateStoryStateAfterGeneration(
  inputs: SceneGenerationInputs,
  options: GenerateDraftWorkflowOptions,
  aiService: StoryboardAiService,
  draftBody: string,
): Promise<void> {
  try {
    await recordStoryStateFromDraft(inputs, options, aiService, draftBody);
  } catch (error) {
    options.host.logger.warn(`이야기 상태를 갱신하지 못했습니다: ${String(error)}`);
  }
}

export async function recordStoryStateFromDraft(
  inputs: SceneGenerationInputs,
  options: GenerateDraftWorkflowOptions,
  aiService: StoryboardAiService,
  draftBody: string,
): Promise<void> {
  const { threadPaths, scene, context, inputHash } = inputs;

  const previous: StoryState = await readStoryState(
    threadPaths.storyState,
    options.host.fileSystem,
  );
  const items: StoryStateUpdateItem[] = await aiService.updateStoryState(
    {
      sceneTitle: scene.stem,
      draftBody,
      previousState: formatStoryStateForPrompt(previous, scene.order, draftBody),
      characterNames: witnessNameLabels(context.characters),
    },
    {
      providerId: options.ai.gateway.getTaskProvider('storyStateUpdate'),
      attribution: { primary: { kind: 'scene', id: scene.stem } },
    },
  );

  const mapping: StoryStateEntryMapping = toStoryStateEntries(items, context.characters);
  if (mapping.unknownWitnesses.length > 0) {
    options.host.logger.warn(
      `${scene.stem}: 이야기 상태의 목격자 이름 ${mapping.unknownWitnesses.join(', ')}이(가) 등장인물 카드와 맞지 않아 그 항목은 씬의 모든 인물이 아는 것으로 기록했습니다. 가명·호칭이면 그 카드의 aliases 에 적어 주세요`,
    );
  }

  const merged: StoryState =
    items.length === 0
      ? recordStoryStateScene(previous, scene.order, inputHash)
      : mergeStoryState(previous, mapping.entries, scene.order, inputHash);

  await writeStoryState(threadPaths.storyState, merged, options.host.fileSystem);
}
