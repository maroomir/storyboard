import type {
  AiServices,
  HostAdapters,
  WorkspaceRepositories,
} from '#engine/application/engineServices';
import type { SceneCard, StoryUri } from '@storyboard/story-model';
import {
  planSceneBeatCount,
  renderSceneCardBody,
  resolveSceneTargetLength,
  type SceneBeat,
  type ExpandedSceneBeat,
  type SceneFile,
} from '@storyboard/story-model';

export interface SceneBeatsResolverDependencies {
  readonly host: HostAdapters;
  readonly ai: AiServices;
  readonly repositories: WorkspaceRepositories;
}

export function hasSceneBeats(scene: SceneFile): boolean {
  return (scene.card.beats?.length ?? 0) > 0;
}

export interface SceneBeatCastCard {
  readonly id: string;
  readonly name: string;
  readonly aliases?: readonly string[];
}

export class SceneBeatsResolver {
  public constructor(private readonly dependencies: SceneBeatsResolverDependencies) {}

  public async resolve(
    sceneUri: StoryUri,
    scene: SceneFile,
    characters: readonly SceneBeatCastCard[],
  ): Promise<SceneFile> {
    const { host, repositories } = this.dependencies;

    if (!host.configBridge.isAutoBeatsEnabled() || hasSceneBeats(scene)) {
      return scene;
    }

    let beats: SceneBeat[];
    try {
      beats = await this.propose(sceneUri, scene, characters);
    } catch (error) {
      host.logger.warn(`씬 비트를 전개하지 못했습니다: ${String(error)}`);
      return scene;
    }

    if (beats.length === 0) {
      host.logger.warn('씬 비트 전개 응답이 비어 있어 카드의 재료로만 생성합니다.');
      return scene;
    }

    try {
      await repositories.scenes.writeBeats(sceneUri, beats);
    } catch (error) {
      host.logger.warn(`씬 비트를 저장하지 못했습니다: ${String(error)}`);
    }

    return withSceneBeats(scene, beats);
  }

  public async propose(
    sceneUri: StoryUri,
    scene: SceneFile,
    characters: readonly SceneBeatCastCard[],
  ): Promise<SceneBeat[]> {
    const { host, ai } = this.dependencies;
    const targetLength: number | undefined = resolveSceneTargetLength(
      scene.frontmatter.targetWordCount,
      scene.body,
    );
    const beatCount: number = planSceneBeatCount(
      targetLength,
      host.configBridge.getCharsPerBeat(),
      host.configBridge.getMinBeats(),
    );

    const proposals: ExpandedSceneBeat[] = await ai.gateway
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
          providerId: ai.gateway.getTaskProvider('sceneBeats'),
          attribution: { primary: { kind: 'scene', id: scene.stem } },
        },
      );

    return proposals.map((proposal) => toSceneBeat(proposal, characters));
  }
}

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
  const card: SceneCard = { ...scene.card, beats: [...beats] };

  return { ...scene, card, body: renderSceneCardBody(card, scene.summaryText) };
}
