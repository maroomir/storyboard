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

// NOTE: 목격자는 그 씬에 있던 인물이다. 목격 범위 서술자가 자기가 없던 자리의 사실을 아는 것을
// 막으려면, 사실이 확립되는 자리에서 누가 그 자리에 있었는지를 남겨 두어야 한다.
function toStoryStateEntries(
  items: readonly StoryStateUpdateItem[],
  witnesses: readonly string[],
): StoryStateEntry[] {
  return items.map((item) => ({
    section: item.section,
    text: item.text,
    ...(witnesses.length > 0 ? { witnesses } : {}),
  }));
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

    const witnesses = context.characters.map((character) => character.id);
    const merged =
      items.length === 0
        ? recordStoryStateScene(previous, scene.order, inputHash)
        : mergeStoryState(
            previous,
            toStoryStateEntries(items, witnesses),
            scene.order,
            inputHash,
          );

    await writeStoryState(threadPaths.storyState, merged, options.fileSystem);
  } catch (error) {
    options.logger.warn(`이야기 상태를 갱신하지 못했습니다: ${String(error)}`);
  }
}
