import {
  mergeStoryState,
  readStoryState,
  writeStoryState,
  formatStoryStateForPrompt,
  type StoryStateEntry,
} from '@storyboard/story-format';
import type { StoryboardAiService, StoryStateUpdateItem } from '@storyboard/story-ai';
import type { GenerateDraftWorkflowOptions } from './generateDraftTypes';
import type { SceneGenerationInputs } from './sceneGenerationInputs';

function toStoryStateEntries(items: readonly StoryStateUpdateItem[]): StoryStateEntry[] {
  return items.map((item) => ({ section: item.section, text: item.text }));
}

// NOTE: 다음 씬 생성이 이 원장을 읽으므로 백그라운드 큐가 아니라 저장 경로에서 await 한다.
// 실패해도 초안 저장은 이미 끝난 뒤이므로 경고만 남기고 생성 흐름을 막지 않는다.
export async function updateStoryStateAfterGeneration(
  inputs: SceneGenerationInputs,
  options: GenerateDraftWorkflowOptions,
  aiService: StoryboardAiService,
  draftBody: string,
): Promise<void> {
  const { paths, scene } = inputs;

  try {
    const previous = await readStoryState(paths.storyState, options.fileSystem);
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

    if (items.length === 0) {
      return;
    }

    const merged = mergeStoryState(previous, toStoryStateEntries(items), scene.order);
    await writeStoryState(paths.storyState, merged, options.fileSystem);
  } catch (error) {
    options.logger.warn(`이야기 상태를 갱신하지 못했습니다: ${String(error)}`);
  }
}
