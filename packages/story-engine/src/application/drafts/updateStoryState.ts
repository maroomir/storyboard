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
// 지식에서 조용히 빠지기 때문이다. 좁히는 것은 모든 이름이 맞을 때만이다. 이름은 카드의 이름·별칭
// 그대로이거나, 띄어 쓴 이름의 한 낱말(«카일런 베인»의 «카일런»)이 꼭 한 카드만 가리킬 때 맞는다.
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
  const idByName = witnessIdsByName(characters);

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

function witnessIdsByName(
  characters: readonly {
    readonly id: string;
    readonly name: string;
    readonly aliases?: readonly string[];
  }[],
): Map<string, string> {
  const idByName = new Map<string, string>();
  for (const character of characters) {
    idByName.set(character.name, character.id);
    for (const alias of character.aliases ?? []) {
      idByName.set(alias, character.id);
    }
  }

  const idsByToken = new Map<string, Set<string>>();
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

// 프롬프트의 [등장인물] 한 줄. 모델이 본문의 가명·호칭 대신 이 표기로 목격자를 달게 한다.
export function witnessNameLabels(
  characters: readonly { readonly name: string; readonly aliases?: readonly string[] }[],
): string[] {
  return characters.map((character) =>
    character.aliases && character.aliases.length > 0
      ? `${character.name} (별칭: ${character.aliases.join(', ')})`
      : character.name,
  );
}

// NOTE: 다음 씬 생성이 이 원장을 읽으므로 백그라운드 큐가 아니라 저장 경로에서 await 한다.
// 실패해도 초안 저장은 이미 끝난 뒤이므로 경고만 남기고 생성 흐름을 막지 않는다.
export async function updateStoryStateAfterGeneration(
  inputs: SceneGenerationInputs,
  options: GenerateDraftWorkflowOptions,
  aiService: StoryboardAiService,
  draftBody: string,
): Promise<void> {
  try {
    await recordStoryStateFromDraft(inputs, options, aiService, draftBody);
  } catch (error) {
    options.logger.warn(`이야기 상태를 갱신하지 못했습니다: ${String(error)}`);
  }
}

// 초안 본문에서 이 씬의 상태 변화를 뽑아 원장에 합친다. 생성 직후와 기존 초안에서 원장을 세우는
// 명령이 같은 길을 쓴다. 실패는 던진다 — 어떻게 받을지는 부르는 쪽이 정한다.
export async function recordStoryStateFromDraft(
  inputs: SceneGenerationInputs,
  options: GenerateDraftWorkflowOptions,
  aiService: StoryboardAiService,
  draftBody: string,
): Promise<void> {
  const { threadPaths, scene, context, inputHash } = inputs;

  const previous = await readStoryState(threadPaths.storyState, options.fileSystem);
  const items = await aiService.updateStoryState(
    {
      sceneTitle: scene.stem,
      draftBody,
      previousState: formatStoryStateForPrompt(previous, scene.order, draftBody),
      characterNames: witnessNameLabels(context.characters),
    },
    {
      providerId: options.aiGateway.getTaskProvider('storyStateUpdate'),
      attribution: { primary: { kind: 'scene', id: scene.stem } },
    },
  );

  const mapping = toStoryStateEntries(items, context.characters);
  if (mapping.unknownWitnesses.length > 0) {
    options.logger.warn(
      `${scene.stem}: 이야기 상태의 목격자 이름 ${mapping.unknownWitnesses.join(', ')}이(가) 등장인물 카드와 맞지 않아 그 항목은 씬의 모든 인물이 아는 것으로 기록했습니다. 가명·호칭이면 그 카드의 aliases 에 적어 주세요`,
    );
  }

  const merged =
    items.length === 0
      ? recordStoryStateScene(previous, scene.order, inputHash)
      : mergeStoryState(previous, mapping.entries, scene.order, inputHash);

  await writeStoryState(threadPaths.storyState, merged, options.fileSystem);
}
