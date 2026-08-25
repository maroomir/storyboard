import { z } from 'zod';

import {
  aiGenerateRequestPayloadSchema,
  aiGenerateResponsePayloadSchema,
  aiGenerateStreamRequestPayloadSchema,
  aiGenerateStreamResponsePayloadSchema,
  aiProvidersCheckConnectionRequestPayloadSchema,
  aiProvidersCheckConnectionResponsePayloadSchema,
  aiProvidersListRequestPayloadSchema,
  aiProvidersListResponsePayloadSchema,
} from './ai';
import {
  botConfigReadRequestPayloadSchema,
  botConfigReadResponsePayloadSchema,
  botConfigUpdateRequestPayloadSchema,
  botRestartRequestPayloadSchema,
  botRestartResponsePayloadSchema,
} from './bot';
import {
  cardsApplyCollectRequestPayloadSchema,
  cardsApplyCollectResponsePayloadSchema,
  cardsCollectRequestPayloadSchema,
  cardsCollectResponsePayloadSchema,
  cardsPreviewCollectRequestPayloadSchema,
  cardsPreviewCollectResponsePayloadSchema,
  cardsCreatePlaceholderRequestPayloadSchema,
  cardsCreatePlaceholderResponsePayloadSchema,
  cardsDeleteRequestPayloadSchema,
  cardsDeleteResponsePayloadSchema,
  cardsListRequestPayloadSchema,
  cardsListResponsePayloadSchema,
  cardsOpenRequestPayloadSchema,
  cardsOpenResponsePayloadSchema,
  cardsReadRequestPayloadSchema,
  cardsReadResponsePayloadSchema,
  cardsResolveImageUriRequestPayloadSchema,
  cardsResolveImageUriResponsePayloadSchema,
  cardsWriteRawRequestPayloadSchema,
  cardsWriteRawResponsePayloadSchema,
  cardsWriteRequestPayloadSchema,
  cardsWriteResponsePayloadSchema,
  cardsStructureSceneRequestPayloadSchema,
  cardsStructureSceneResponsePayloadSchema,
} from './cards';
import {
  projectReadContractRequestPayloadSchema,
  projectReadContractResponsePayloadSchema,
  projectUpdateContractRequestPayloadSchema,
  projectUpdateContractResponsePayloadSchema,
} from './project';
import { relationsListRequestPayloadSchema, relationsListResponsePayloadSchema } from './relations';
import {
  scenesGenerateDraftRequestPayloadSchema,
  scenesGenerateDraftResponsePayloadSchema,
  scenesListRequestPayloadSchema,
  scenesListResponsePayloadSchema,
  scenesOpenDraftRequestPayloadSchema,
  scenesOpenDraftResponsePayloadSchema,
  scenesOpenSceneRequestPayloadSchema,
  scenesOpenSceneResponsePayloadSchema,
} from './scenes';
import {
  secretsDeleteApiKeyRequestPayloadSchema,
  secretsDeleteApiKeyResponsePayloadSchema,
  secretsWriteApiKeyRequestPayloadSchema,
  secretsWriteApiKeyResponsePayloadSchema,
} from './secrets';
import {
  settingsMutationOkResponsePayloadSchema,
  settingsReadRequestPayloadSchema,
  settingsReadResponsePayloadSchema,
  settingsUpdateDefaultProviderRequestPayloadSchema,
  settingsUpdateProviderBaseUrlRequestPayloadSchema,
  settingsUpdateProviderCommandRequestPayloadSchema,
  settingsUpdateProviderModelRequestPayloadSchema,
  settingsUpdateTaskAiConfigRequestPayloadSchema,
} from './settings';
import {
  studioRunActionRequestPayloadSchema,
  studioRunActionResponsePayloadSchema,
  studioSessionListRequestPayloadSchema,
  studioSessionListResponsePayloadSchema,
  studioSessionLoadRequestPayloadSchema,
  studioSessionLoadResponsePayloadSchema,
  studioSessionSaveRequestPayloadSchema,
  studioSessionSaveResponsePayloadSchema,
  studioStageRequestPayloadSchema,
  studioStageResponsePayloadSchema,
} from './studio';
import { usageReadRequestPayloadSchema, usageReadResponsePayloadSchema } from './usage';

export const storyboardRequestPayloadSchemas = {
  'cards.list': cardsListRequestPayloadSchema,
  'cards.read': cardsReadRequestPayloadSchema,
  'cards.write': cardsWriteRequestPayloadSchema,
  'cards.writeRaw': cardsWriteRawRequestPayloadSchema,
  'cards.createPlaceholder': cardsCreatePlaceholderRequestPayloadSchema,
  'cards.resolveImageUri': cardsResolveImageUriRequestPayloadSchema,
  'cards.collect': cardsCollectRequestPayloadSchema,
  'cards.applyCollect': cardsApplyCollectRequestPayloadSchema,
  'cards.previewCollect': cardsPreviewCollectRequestPayloadSchema,
  'cards.open': cardsOpenRequestPayloadSchema,
  'cards.structureScene': cardsStructureSceneRequestPayloadSchema,
  'cards.delete': cardsDeleteRequestPayloadSchema,
  'scenes.list': scenesListRequestPayloadSchema,
  'scenes.openScene': scenesOpenSceneRequestPayloadSchema,
  'scenes.openDraft': scenesOpenDraftRequestPayloadSchema,
  'scenes.generateDraft': scenesGenerateDraftRequestPayloadSchema,
  'relations.list': relationsListRequestPayloadSchema,
  'ai.providers.list': aiProvidersListRequestPayloadSchema,
  'ai.providers.checkConnection': aiProvidersCheckConnectionRequestPayloadSchema,
  'ai.generate': aiGenerateRequestPayloadSchema,
  'ai.generateStream': aiGenerateStreamRequestPayloadSchema,
  'settings.read': settingsReadRequestPayloadSchema,
  'settings.updateDefaultProvider': settingsUpdateDefaultProviderRequestPayloadSchema,
  'settings.updateProviderModel': settingsUpdateProviderModelRequestPayloadSchema,
  'settings.updateProviderBaseUrl': settingsUpdateProviderBaseUrlRequestPayloadSchema,
  'settings.updateProviderCommand': settingsUpdateProviderCommandRequestPayloadSchema,
  'settings.updateTaskAiConfig': settingsUpdateTaskAiConfigRequestPayloadSchema,
  'secrets.writeApiKey': secretsWriteApiKeyRequestPayloadSchema,
  'secrets.deleteApiKey': secretsDeleteApiKeyRequestPayloadSchema,
  'project.readContract': projectReadContractRequestPayloadSchema,
  'project.updateContract': projectUpdateContractRequestPayloadSchema,
  'studio.runAction': studioRunActionRequestPayloadSchema,
  'studio.stage': studioStageRequestPayloadSchema,
  'studio.session.save': studioSessionSaveRequestPayloadSchema,
  'studio.session.list': studioSessionListRequestPayloadSchema,
  'studio.session.load': studioSessionLoadRequestPayloadSchema,
  'usage.read': usageReadRequestPayloadSchema,
  'bot.config.read': botConfigReadRequestPayloadSchema,
  'bot.config.update': botConfigUpdateRequestPayloadSchema,
  'bot.restart': botRestartRequestPayloadSchema,
} as const;

export const storyboardResponsePayloadSchemas = {
  'cards.list': cardsListResponsePayloadSchema,
  'cards.read': cardsReadResponsePayloadSchema,
  'cards.write': cardsWriteResponsePayloadSchema,
  'cards.writeRaw': cardsWriteRawResponsePayloadSchema,
  'cards.createPlaceholder': cardsCreatePlaceholderResponsePayloadSchema,
  'cards.resolveImageUri': cardsResolveImageUriResponsePayloadSchema,
  'cards.collect': cardsCollectResponsePayloadSchema,
  'cards.applyCollect': cardsApplyCollectResponsePayloadSchema,
  'cards.previewCollect': cardsPreviewCollectResponsePayloadSchema,
  'cards.open': cardsOpenResponsePayloadSchema,
  'cards.structureScene': cardsStructureSceneResponsePayloadSchema,
  'cards.delete': cardsDeleteResponsePayloadSchema,
  'scenes.list': scenesListResponsePayloadSchema,
  'scenes.openScene': scenesOpenSceneResponsePayloadSchema,
  'scenes.openDraft': scenesOpenDraftResponsePayloadSchema,
  'scenes.generateDraft': scenesGenerateDraftResponsePayloadSchema,
  'relations.list': relationsListResponsePayloadSchema,
  'ai.providers.list': aiProvidersListResponsePayloadSchema,
  'ai.providers.checkConnection': aiProvidersCheckConnectionResponsePayloadSchema,
  'ai.generate': aiGenerateResponsePayloadSchema,
  'ai.generateStream': aiGenerateStreamResponsePayloadSchema,
  'settings.read': settingsReadResponsePayloadSchema,
  'settings.updateDefaultProvider': settingsMutationOkResponsePayloadSchema,
  'settings.updateProviderModel': settingsMutationOkResponsePayloadSchema,
  'settings.updateProviderBaseUrl': settingsMutationOkResponsePayloadSchema,
  'settings.updateProviderCommand': settingsMutationOkResponsePayloadSchema,
  'settings.updateTaskAiConfig': settingsMutationOkResponsePayloadSchema,
  'secrets.writeApiKey': secretsWriteApiKeyResponsePayloadSchema,
  'secrets.deleteApiKey': secretsDeleteApiKeyResponsePayloadSchema,
  'project.readContract': projectReadContractResponsePayloadSchema,
  'project.updateContract': projectUpdateContractResponsePayloadSchema,
  'studio.runAction': studioRunActionResponsePayloadSchema,
  'studio.stage': studioStageResponsePayloadSchema,
  'studio.session.save': studioSessionSaveResponsePayloadSchema,
  'studio.session.list': studioSessionListResponsePayloadSchema,
  'studio.session.load': studioSessionLoadResponsePayloadSchema,
  'usage.read': usageReadResponsePayloadSchema,
  'bot.config.read': botConfigReadResponsePayloadSchema,
  'bot.config.update': botConfigReadResponsePayloadSchema,
  'bot.restart': botRestartResponsePayloadSchema,
} as const;

export type StoryboardRequestMethod = keyof typeof storyboardRequestPayloadSchemas;
export type StoryboardResponseMethod = keyof typeof storyboardResponsePayloadSchemas;

export type StoryboardRequestPayload<M extends StoryboardRequestMethod> = z.infer<
  (typeof storyboardRequestPayloadSchemas)[M]
>;

export type StoryboardResponsePayload<M extends StoryboardResponseMethod> = z.infer<
  (typeof storyboardResponsePayloadSchemas)[M]
>;
