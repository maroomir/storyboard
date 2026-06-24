import { z } from "zod"

import {
  aiGenerateRequestPayloadSchema,
  aiGenerateResponsePayloadSchema,
  aiGenerateStreamRequestPayloadSchema,
  aiGenerateStreamResponsePayloadSchema,
  aiProvidersCheckConnectionRequestPayloadSchema,
  aiProvidersCheckConnectionResponsePayloadSchema,
  aiProvidersListRequestPayloadSchema,
  aiProvidersListResponsePayloadSchema
} from "./ai"
import {
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
  cardsWriteResponsePayloadSchema
} from "./cards"
import {
  projectReadContractRequestPayloadSchema,
  projectReadContractResponsePayloadSchema,
  projectUpdateContractRequestPayloadSchema,
  projectUpdateContractResponsePayloadSchema
} from "./project"
import {
  scenesGenerateDraftRequestPayloadSchema,
  scenesGenerateDraftResponsePayloadSchema,
  scenesListRequestPayloadSchema,
  scenesListResponsePayloadSchema,
  scenesOpenDraftRequestPayloadSchema,
  scenesOpenDraftResponsePayloadSchema,
  scenesOpenSceneRequestPayloadSchema,
  scenesOpenSceneResponsePayloadSchema
} from "./scenes"
import {
  secretsDeleteApiKeyRequestPayloadSchema,
  secretsDeleteApiKeyResponsePayloadSchema,
  secretsWriteApiKeyRequestPayloadSchema,
  secretsWriteApiKeyResponsePayloadSchema
} from "./secrets"
import {
  settingsMutationOkResponsePayloadSchema,
  settingsReadRequestPayloadSchema,
  settingsReadResponsePayloadSchema,
  settingsUpdateDefaultProviderRequestPayloadSchema,
  settingsUpdateProviderBaseUrlRequestPayloadSchema,
  settingsUpdateProviderCommandRequestPayloadSchema,
  settingsUpdateProviderModelRequestPayloadSchema,
  settingsUpdateTaskAiConfigRequestPayloadSchema
} from "./settings"
import {
  usageReadRequestPayloadSchema,
  usageReadResponsePayloadSchema
} from "./usage"

export const storyboardRequestPayloadSchemas = {
  "cards.list": cardsListRequestPayloadSchema,
  "cards.read": cardsReadRequestPayloadSchema,
  "cards.write": cardsWriteRequestPayloadSchema,
  "cards.writeRaw": cardsWriteRawRequestPayloadSchema,
  "cards.createPlaceholder": cardsCreatePlaceholderRequestPayloadSchema,
  "cards.resolveImageUri": cardsResolveImageUriRequestPayloadSchema,
  "cards.open": cardsOpenRequestPayloadSchema,
  "cards.delete": cardsDeleteRequestPayloadSchema,
  "scenes.list": scenesListRequestPayloadSchema,
  "scenes.openScene": scenesOpenSceneRequestPayloadSchema,
  "scenes.openDraft": scenesOpenDraftRequestPayloadSchema,
  "scenes.generateDraft": scenesGenerateDraftRequestPayloadSchema,
  "ai.providers.list": aiProvidersListRequestPayloadSchema,
  "ai.providers.checkConnection": aiProvidersCheckConnectionRequestPayloadSchema,
  "ai.generate": aiGenerateRequestPayloadSchema,
  "ai.generateStream": aiGenerateStreamRequestPayloadSchema,
  "settings.read": settingsReadRequestPayloadSchema,
  "settings.updateDefaultProvider": settingsUpdateDefaultProviderRequestPayloadSchema,
  "settings.updateProviderModel": settingsUpdateProviderModelRequestPayloadSchema,
  "settings.updateProviderBaseUrl": settingsUpdateProviderBaseUrlRequestPayloadSchema,
  "settings.updateProviderCommand": settingsUpdateProviderCommandRequestPayloadSchema,
  "settings.updateTaskAiConfig": settingsUpdateTaskAiConfigRequestPayloadSchema,
  "secrets.writeApiKey": secretsWriteApiKeyRequestPayloadSchema,
  "secrets.deleteApiKey": secretsDeleteApiKeyRequestPayloadSchema,
  "project.readContract": projectReadContractRequestPayloadSchema,
  "project.updateContract": projectUpdateContractRequestPayloadSchema,
  "usage.read": usageReadRequestPayloadSchema
} as const

export const storyboardResponsePayloadSchemas = {
  "cards.list": cardsListResponsePayloadSchema,
  "cards.read": cardsReadResponsePayloadSchema,
  "cards.write": cardsWriteResponsePayloadSchema,
  "cards.writeRaw": cardsWriteRawResponsePayloadSchema,
  "cards.createPlaceholder": cardsCreatePlaceholderResponsePayloadSchema,
  "cards.resolveImageUri": cardsResolveImageUriResponsePayloadSchema,
  "cards.open": cardsOpenResponsePayloadSchema,
  "cards.delete": cardsDeleteResponsePayloadSchema,
  "scenes.list": scenesListResponsePayloadSchema,
  "scenes.openScene": scenesOpenSceneResponsePayloadSchema,
  "scenes.openDraft": scenesOpenDraftResponsePayloadSchema,
  "scenes.generateDraft": scenesGenerateDraftResponsePayloadSchema,
  "ai.providers.list": aiProvidersListResponsePayloadSchema,
  "ai.providers.checkConnection": aiProvidersCheckConnectionResponsePayloadSchema,
  "ai.generate": aiGenerateResponsePayloadSchema,
  "ai.generateStream": aiGenerateStreamResponsePayloadSchema,
  "settings.read": settingsReadResponsePayloadSchema,
  "settings.updateDefaultProvider": settingsMutationOkResponsePayloadSchema,
  "settings.updateProviderModel": settingsMutationOkResponsePayloadSchema,
  "settings.updateProviderBaseUrl": settingsMutationOkResponsePayloadSchema,
  "settings.updateProviderCommand": settingsMutationOkResponsePayloadSchema,
  "settings.updateTaskAiConfig": settingsMutationOkResponsePayloadSchema,
  "secrets.writeApiKey": secretsWriteApiKeyResponsePayloadSchema,
  "secrets.deleteApiKey": secretsDeleteApiKeyResponsePayloadSchema,
  "project.readContract": projectReadContractResponsePayloadSchema,
  "project.updateContract": projectUpdateContractResponsePayloadSchema,
  "usage.read": usageReadResponsePayloadSchema
} as const

export type StoryboardRequestMethod = keyof typeof storyboardRequestPayloadSchemas
export type StoryboardResponseMethod = keyof typeof storyboardResponsePayloadSchemas

export type StoryboardRequestPayload<M extends StoryboardRequestMethod> = z.infer<
  (typeof storyboardRequestPayloadSchemas)[M]
>

export type StoryboardResponsePayload<M extends StoryboardResponseMethod> = z.infer<
  (typeof storyboardResponsePayloadSchemas)[M]
>
