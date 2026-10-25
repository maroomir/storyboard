import type { StoryUri } from '@storyboard/story-model';
import {
  planSceneBeatCount,
  renderSceneCardBody,
  resolveSceneTargetLength,
  type SceneBeat,
  type ExpandedSceneBeat,
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

export interface SceneBeatCastCard {
  readonly id: string;
  readonly name: string;
  readonly aliases?: readonly string[];
}

// 초안 뼈대는 입력에 없는 사건을 지어내지 못하므로 비트 수가 분량의 상한이다. 비트가 없는 씬은
// 생성 직전에 뽑아 카드에 남겨, 다음 생성에서도 같은 사건을 쓴다(사실 시트와 같은 패턴).
export async function resolveSceneBeats(
  sceneUri: StoryUri,
  scene: SceneFile,
  characters: readonly SceneBeatCastCard[],
  options: SceneBeatsOptions,
): Promise<SceneFile> {
  if (!options.configBridge.isAutoBeatsEnabled() || hasSceneBeats(scene)) {
    return scene;
  }

  let beats: SceneBeat[];
  try {
    beats = await proposeSceneBeats(sceneUri, scene, characters, options);
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
  characters: readonly SceneBeatCastCard[],
  options: SceneBeatsOptions,
): Promise<SceneBeat[]> {
  const targetLength: number | undefined = resolveSceneTargetLength(
    scene.frontmatter.targetWordCount,
    scene.body,
  );
  const beatCount: number = planSceneBeatCount(
    targetLength,
    options.configBridge.getCharsPerBeat(),
    options.configBridge.getMinBeats(),
  );

  const proposals: ExpandedSceneBeat[] = await options.aiGateway
    .createService(sceneUri)
    .proposeSceneBeats(
      {
        sceneBody: renderSceneCardBody({ ...scene.card, beats: undefined }),
        ...(scene.summaryText === undefined ? {} : { summary: scene.summaryText }),
        grounding: scene.frontmatter.grounding,
        characterNames: characters.map((character) => character.name),
        beatCount,
      },
      {
        providerId: options.aiGateway.getTaskProvider('sceneBeats'),
        attribution: { primary: { kind: 'scene', id: scene.stem } },
      },
    );

  return proposals.map((proposal) => toSceneBeat(proposal, characters));
}

// 좌표가 하나라도 있으면 객체 비트, 없으면 종전대로 문자열 비트다. 출연은 카드의 id·이름·별칭과
// 맞으면 id 로 적고, 맞지 않는 이름은 그대로 둔다 — 생성과 doctor 가 «비트 출연» 경고로 알린다.
export function toSceneBeat(
  proposal: ExpandedSceneBeat,
  characters: readonly SceneBeatCastCard[],
): SceneBeat {
  const idByRef: Map<string, string> = new Map<string, string>();
  for (const character of characters) {
    idByRef.set(character.id, character.id);
    idByRef.set(character.name, character.id);
    for (const alias of character.aliases ?? []) {
      idByRef.set(alias, character.id);
    }
  }

  const cast: string[] = [...new Set(proposal.cast.map((name) => idByRef.get(name) ?? name))];
  if (cast.length === 0 && proposal.place === undefined && proposal.time === undefined) {
    return proposal.text;
  }

  return {
    text: proposal.text,
    ...(cast.length > 0 ? { cast } : {}),
    ...(proposal.place === undefined ? {} : { place: proposal.place }),
    ...(proposal.time === undefined ? {} : { time: proposal.time }),
  };
}

export function withSceneBeats(scene: SceneFile, beats: readonly SceneBeat[]): SceneFile {
  const card = { ...scene.card, beats: [...beats] };

  return { ...scene, card, body: renderSceneCardBody(card, scene.summaryText) };
}
