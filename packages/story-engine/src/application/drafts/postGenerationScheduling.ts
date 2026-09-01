import { backgroundCardPath, characterCardPath } from '#engine/paths/projectPaths';
import {
  bibleCandidateFilePath,
  ensureBibleCacheDirectory,
} from '#engine/persistence/bibleCacheWorkspace';
import {
  cardCandidateFilePath,
  ensureCardCacheDirectory,
} from '#engine/persistence/cardCacheWorkspace';
import type { StoryboardAiService } from '@storyboard/story-ai';
import { SceneGenerationPipeline } from '@storyboard/story-pipeline';
import type { GenerateDraftWorkflowOptions } from './generateDraftTypes';
import type { SceneGenerationInputs } from './sceneGenerationInputs';

export function schedulePostGenerationUpdates(
  inputs: SceneGenerationInputs,
  options: GenerateDraftWorkflowOptions,
  aiService: StoryboardAiService,
  result: Awaited<ReturnType<SceneGenerationPipeline['run']>>,
): void {
  const { workspaceFolder, paths, scene, context } = inputs;
  const updates = options.postGenerationUpdates;

  if (!updates) {
    return;
  }

  const detectedCharacterCards = context.characters.filter((card) =>
    result.detectedCharacters.includes(card.name),
  );

  updates.scheduleCharacterTraits({
    queueKey: workspaceFolder.uri.toString(),
    sceneStem: scene.stem,
    draftBody: result.draftBody,
    detectedCharacterCards,
    aiService,
    fileSystem: options.fileSystem,
    resolveCharacterCardUri: (card) => characterCardPath(workspaceFolder.uri, card.id),
    logger: options.logger,
    onComplete: options.onTraitsUpdateComplete,
  });

  updates.scheduleBibleCandidates({
    queueKey: `${workspaceFolder.uri.toString()}#bible`,
    sceneStem: scene.stem,
    draftBody: result.draftBody,
    detectedCharacterCards,
    aiService,
    fileSystem: options.fileSystem,
    ensureDirectory: () => ensureBibleCacheDirectory(options.fileSystem, paths),
    resolveCandidateUri: (stem) => bibleCandidateFilePath(paths, stem),
    logger: options.logger,
  });

  updates.scheduleCardCandidates({
    queueKey: `${workspaceFolder.uri.toString()}#cards`,
    sceneStem: scene.stem,
    draftBody: result.draftBody,
    detectedCharacterCards,
    characterRoster: context.characters.map((card) => ({ id: card.id, name: card.name })),
    aiService,
    verify: options.configBridge.isVerifyCardCandidatesEnabled(),
    fileSystem: options.fileSystem,
    ensureDirectory: () => ensureCardCacheDirectory(options.fileSystem, paths),
    resolveCandidateUri: (stem) => cardCandidateFilePath(paths, stem),
    logger: options.logger,
  });

  if (context.background) {
    updates.scheduleBackgroundCharacters({
      queueKey: `${workspaceFolder.uri.toString()}#background`,
      backgroundId: context.background.id,
      detectedCharacterCards,
      fileSystem: options.fileSystem,
      resolveBackgroundCardUri: (backgroundId) =>
        backgroundCardPath(workspaceFolder.uri, backgroundId),
      logger: options.logger,
    });
  }
}
