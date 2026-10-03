import type { StoryUri } from '@storyboard/story-model';
import {
  planSceneBeatCount,
  renderSceneCardBody,
  resolveSceneTargetLength,
  type SceneFile,
} from '@storyboard/story-model';
import type { AiGateway } from '#engine/application/ai/aiGateway';
import type { IStoryboardLogger } from '#engine/ports/logger';
import type { ISceneRepository } from '#engine/application/drafts/draftRepositories';
import type { ConfigBridge } from '@storyboard/story-ai';

export interface SceneBeatsOptions {
  readonly aiGateway: AiGateway;
  readonly configBridge: ConfigBridge;
  readonly sceneRepository: ISceneRepository;
  readonly logger: IStoryboardLogger;
}

export function hasSceneBeats(scene: SceneFile): boolean {
  return (scene.card.beats?.length ?? 0) > 0;
}

// 초안 뼈대는 입력에 없는 사건을 지어내지 못하므로 비트 수가 분량의 상한이다. 비트가 없는 씬은
// 생성 직전에 뽑아 카드에 남겨, 다음 생성에서도 같은 사건을 쓴다(사실 시트와 같은 패턴).
export async function resolveSceneBeats(
  sceneUri: StoryUri,
  scene: SceneFile,
  characterNames: readonly string[],
  options: SceneBeatsOptions,
): Promise<SceneFile> {
  if (!options.configBridge.isAutoBeatsEnabled() || hasSceneBeats(scene)) {
    return scene;
  }

  let beats: string[];
  try {
    beats = await proposeSceneBeats(sceneUri, scene, characterNames, options);
  } catch (error) {
    // 비트 전개는 분량 보조 단계다. 실패해도 생성 자체는 막지 않는다.
    options.logger.warn(`씬 비트를 전개하지 못했습니다: ${String(error)}`);
    return scene;
  }

  if (beats.length === 0) {
    options.logger.warn('씬 비트 전개 응답이 비어 있어 카드의 재료로만 생성합니다.');
    return scene;
  }

  try {
    await options.sceneRepository.writeBeats(sceneUri, beats);
  } catch (error) {
    options.logger.warn(`씬 비트를 저장하지 못했습니다: ${String(error)}`);
  }

  return withSceneBeats(scene, beats);
}

export async function proposeSceneBeats(
  sceneUri: StoryUri,
  scene: SceneFile,
  characterNames: readonly string[],
  options: SceneBeatsOptions,
): Promise<string[]> {
  const targetLength = resolveSceneTargetLength(scene.frontmatter.targetWordCount, scene.body);
  const beatCount = planSceneBeatCount(
    targetLength,
    options.configBridge.getCharsPerBeat(),
    options.configBridge.getMinBeats(),
  );

  return await options.aiGateway.createService(sceneUri).proposeSceneBeats(
    {
      sceneBody: renderSceneCardBody({ ...scene.card, beats: undefined }),
      ...(scene.summaryText === undefined ? {} : { summary: scene.summaryText }),
      grounding: scene.frontmatter.grounding,
      characterNames,
      beatCount,
    },
    {
      providerId: options.aiGateway.getTaskProvider('sceneBeats'),
      attribution: { primary: { kind: 'scene', id: scene.stem } },
    },
  );
}

export function withSceneBeats(scene: SceneFile, beats: readonly string[]): SceneFile {
  const card = { ...scene.card, beats: [...beats] };

  return { ...scene, card, body: renderSceneCardBody(card, scene.summaryText) };
}
