import { backgroundCardPath, characterCardPath, type CharacterCard } from '@storyboard/story-model';
import {
  bibleCandidateFilePath,
  ensureBibleCacheDirectory,
} from '#engine/persistence/bibleCacheWorkspace';
import {
  cardCandidateFilePath,
  ensureCardCacheDirectory,
} from '#engine/persistence/cardCacheWorkspace';
import type { StoryboardAiService } from '@storyboard/story-ai';
import { SceneGenerationPipeline } from '#engine/pipeline/sceneGenerationPipeline';
import type { GenerateDraftWorkflowOptions } from './generateDraftTypes';
import type { SceneGenerationInputs } from './sceneGenerationInputs';
import type { PostGenerationUpdateManager } from '#engine/ai/PostGenerationUpdateManager';

export function schedulePostGenerationUpdates(
  inputs: SceneGenerationInputs,
  options: GenerateDraftWorkflowOptions,
  aiService: StoryboardAiService,
  pipelineResult: Awaited<ReturnType<SceneGenerationPipeline['run']>>,
): void {
  const { workspaceFolder, paths, scene, context } = inputs;
  const updates: PostGenerationUpdateManager | undefined = options.postGenerationUpdates;

  if (!updates) {
    return;
  }

  const detectedCharacterCards: CharacterCard[] = context.characters.filter((card) =>
    pipelineResult.detectedCharacters.includes(card.name),
  );

  updates.scheduleCharacterTraits({
    queueKey: workspaceFolder.uri.toString(),
    sceneStem: scene.stem,
    draftBody: pipelineResult.draftBody,
    detectedCharacterCards,
    aiService,
    fileSystem: options.host.fileSystem,
    resolveCharacterCardUri: (card) => characterCardPath(workspaceFolder.uri, card.id),
    logger: options.host.logger,
    onComplete: options.onTraitsUpdateComplete,
  });

  updates.scheduleBibleCandidates({
    queueKey: `${workspaceFolder.uri.toString()}#bible`,
    sceneStem: scene.stem,
    draftBody: pipelineResult.draftBody,
    detectedCharacterCards,
    aiService,
    fileSystem: options.host.fileSystem,
    ensureDirectory: () => ensureBibleCacheDirectory(options.host.fileSystem, paths),
    resolveCandidateUri: (stem) => bibleCandidateFilePath(paths, stem),
    logger: options.host.logger,
  });

  updates.scheduleCardCandidates({
    queueKey: `${workspaceFolder.uri.toString()}#cards`,
    sceneStem: scene.stem,
    draftBody: pipelineResult.draftBody,
    detectedCharacterCards,
    characterRoster: context.characters.map((card) => ({ id: card.id, name: card.name })),
    aiService,
    verify: options.host.configBridge.isVerifyCardCandidatesEnabled(),
    fileSystem: options.host.fileSystem,
    ensureDirectory: () => ensureCardCacheDirectory(options.host.fileSystem, paths),
    resolveCandidateUri: (stem) => cardCandidateFilePath(paths, stem),
    logger: options.host.logger,
  });

  if (context.background) {
    updates.scheduleBackgroundCharacters({
      queueKey: `${workspaceFolder.uri.toString()}#background`,
      backgroundId: context.background.id,
      detectedCharacterCards,
      fileSystem: options.host.fileSystem,
      resolveBackgroundCardUri: (backgroundId) =>
        backgroundCardPath(workspaceFolder.uri, backgroundId),
      logger: options.host.logger,
    });
  }
}
