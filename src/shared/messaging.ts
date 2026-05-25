import { z } from "zod"

import { cardSchema, cardTypes, characterRoles } from "./card"
import { storyboardModelCatalog } from "./models"
import {
  aiProviderIds,
  aiTaskNames,
  type UsageSummaryByEntity
} from "../services/ai/types"

export type { UsageSummaryByEntity }

export const storyboardMessageProtocolVersion = "1.0.0"

const requestIdSchema = z.string().trim().min(1)
const methodSchema = z.string().trim().min(1)
const uriStringSchema = z.string().trim().min(1)
const providerIdSchema = z.enum(aiProviderIds)
const aiTaskNameSchema = z.enum(aiTaskNames)
const aiMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1)
})

export const cardsListRequestPayloadSchema = z.object({
  type: z.enum(cardTypes).optional()
})

export const cardsReadRequestPayloadSchema = z.object({
  uri: uriStringSchema
})

export const cardsWriteRequestPayloadSchema = z.object({
  uri: uriStringSchema,
  card: cardSchema,
  rawText: z.string().optional()
})

export const cardsCreatePlaceholderRequestPayloadSchema = z.object({
  type: z.enum(cardTypes),
  id: z.string().trim().min(1),
  name: z.string().trim().min(1)
})

export const cardsResolveImageUriRequestPayloadSchema = z.object({
  cardUri: uriStringSchema,
  relativePath: z.string().trim().min(1)
})

export const cardsOpenRequestPayloadSchema = z.object({
  uri: uriStringSchema
})

export const cardsDeleteRequestPayloadSchema = z.object({
  uri: uriStringSchema
})

export const cardSummarySchema = z.object({
  type: z.enum(cardTypes),
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  uri: uriStringSchema
})

export const sidebarCardSummarySchema = z.object({
  type: z.enum(cardTypes),
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  uri: uriStringSchema,
  description: z.string().optional(),
  error: z.string().optional(),
  role: z.enum(characterRoles).optional()
})

export type SidebarCardSummary = z.infer<typeof sidebarCardSummarySchema>

export const sidebarCardsInitialDataSchema = z.object({
  type: z.enum(["character", "background"] as const),
  title: z.string().trim().min(1),
  cards: z.array(sidebarCardSummarySchema),
  isStoryboardProject: z.boolean(),
  usage: z.unknown()
})

export const cardsListResponsePayloadSchema = z.object({
  cards: z.array(cardSummarySchema)
})

export const cardsReadResponsePayloadSchema = z.object({
  card: cardSchema
})

export const cardsWriteResponsePayloadSchema = z.object({
  card: cardSchema
})

export const cardsCreatePlaceholderResponsePayloadSchema = z.object({
  card: cardSchema,
  uri: uriStringSchema
})

export const cardsResolveImageUriResponsePayloadSchema = z.object({
  uri: uriStringSchema
})

export const cardsOpenResponsePayloadSchema = z.object({})
export const cardsDeleteResponsePayloadSchema = z.object({})

export const scenesListRequestPayloadSchema = z.object({})

export const sceneListItemSchema = z.object({
  stem: z.string().trim().min(1),
  order: z.number().int(),
  slug: z.string().trim().min(1),
  title: z.string().trim().min(1).optional(),
  sceneUri: uriStringSchema,
  draftUri: uriStringSchema.optional(),
  status: z.enum(["ready", "stale", "missing"]),
  sceneMtime: z.number(),
  draftMtime: z.number().optional()
})

export const scenesListResponsePayloadSchema = z.object({
  scenes: z.array(sceneListItemSchema)
})

export const scenesOpenSceneRequestPayloadSchema = z.object({
  uri: uriStringSchema
})

export const scenesOpenDraftRequestPayloadSchema = z.object({
  uri: uriStringSchema
})

export const scenesGenerateDraftRequestPayloadSchema = z.object({
  uri: uriStringSchema
})

export const scenesOpenSceneResponsePayloadSchema = z.object({})
export const scenesOpenDraftResponsePayloadSchema = z.object({})
export const scenesGenerateDraftResponsePayloadSchema = z.object({})

export const relationsListRequestPayloadSchema = z.object({})

export const relationListItemRelationSchema = z.object({
  target: z.string().trim().min(1),
  type: z.string().trim().min(1)
})

export const relationListCharacterSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  role: z.string().trim().min(1).optional(),
  uri: uriStringSchema,
  relations: z.array(relationListItemRelationSchema)
})

export const relationsListResponsePayloadSchema = z.object({
  characters: z.array(relationListCharacterSchema)
})

export type RelationListCharacter = z.infer<typeof relationListCharacterSchema>

export const aiProvidersListRequestPayloadSchema = z.object({})

export const aiProvidersCheckConnectionRequestPayloadSchema = z.object({
  providerId: providerIdSchema
})

export const aiGenerateRequestPayloadSchema = z.object({
  providerId: providerIdSchema,
  taskName: aiTaskNameSchema,
  messages: z.array(aiMessageSchema).min(1),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional()
})
export const aiGenerateStreamRequestPayloadSchema = aiGenerateRequestPayloadSchema

export const aiProviderStatusSchema = z.object({
  providerId: providerIdSchema,
  displayName: z.string().min(1),
  model: z.string().optional(),
  hasApiKey: z.boolean(),
  isAvailable: z.boolean()
})

export const aiProvidersListResponsePayloadSchema = z.object({
  providers: z.array(aiProviderStatusSchema)
})

export const aiProvidersCheckConnectionResponsePayloadSchema = z.object({
  ok: z.boolean()
})

const aiUsageSchema = z.object({
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  cacheReadInputTokens: z.number().nonnegative().optional(),
  cacheCreationInputTokens: z.number().nonnegative().optional()
})

export const aiGenerateResponsePayloadSchema = z.object({
  text: z.string(),
  providerId: providerIdSchema,
  model: z.string().optional(),
  usage: aiUsageSchema.optional(),
  costUsd: z.number().optional()
})
export const aiGenerateStreamResponsePayloadSchema = aiGenerateResponsePayloadSchema
export const aiGenerateStreamChunkEventPayloadSchema = z.object({
  requestId: requestIdSchema,
  delta: z.string()
})

const providerModelOptionSchema = z.object({
  id: z.string().trim().min(1),
  displayName: z.string().trim().min(1)
})

const storyboardModelCatalogPayloadSchema = z.record(
  providerIdSchema,
  z.array(providerModelOptionSchema).min(1)
)

const providerRuntimeConfigSchema = z.object({
  model: z.string().trim().min(1),
  baseUrl: z.string().trim().min(1).optional()
})

const providerConfigsPayloadSchema = z.record(providerIdSchema, providerRuntimeConfigSchema)

const taskAssignmentReadSchema = z
  .object({
    providerId: providerIdSchema.nullable(),
    model: z.string().nullable()
  })
  .superRefine((data, ctx) => {
    if (data.providerId === null && data.model !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "taskAssignments: model must be null when providerId is null."
      })
    }
  })

const taskAssignmentsPayloadSchema = z.record(aiTaskNameSchema, taskAssignmentReadSchema)
const aiTaskStatusSchema = z.enum(["wired", "planned"])
const taskCatalogEntrySchema = z.object({
  name: aiTaskNameSchema,
  label: z.string().trim().min(1),
  status: aiTaskStatusSchema
})

export const settingsReadResponsePayloadSchema = z.object({
  defaultProvider: providerIdSchema,
  providers: z.array(aiProviderStatusSchema),
  providerConfigs: providerConfigsPayloadSchema,
  taskAssignments: taskAssignmentsPayloadSchema,
  modelCatalog: storyboardModelCatalogPayloadSchema,
  taskCatalog: z.array(taskCatalogEntrySchema).min(1)
})

export const settingsChangedEventPayloadSchema = settingsReadResponsePayloadSchema

export const settingsReadRequestPayloadSchema = z.object({})

export const settingsUpdateDefaultProviderRequestPayloadSchema = z.object({
  providerId: providerIdSchema
})

export const settingsUpdateProviderModelRequestPayloadSchema = z
  .object({
    providerId: providerIdSchema,
    model: z.string().trim().min(1)
  })
  .superRefine((data, ctx) => {
    const allowedIds = storyboardModelCatalog[data.providerId].map((entry) => entry.id)
    if (!allowedIds.some((id) => id === data.model)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Model must be a catalog option for ${data.providerId}.`
      })
    }
  })

export const settingsUpdateProviderBaseUrlRequestPayloadSchema = z.object({
  providerId: z.literal("ollama"),
  baseUrl: z.string().trim().min(1)
})

export const settingsUpdateTaskAiConfigRequestPayloadSchema = z
  .object({
    taskName: aiTaskNameSchema,
    providerId: providerIdSchema.nullable(),
    model: z.string().trim().min(1).nullable()
  })
  .superRefine((data, ctx) => {
    if (data.providerId === null) {
      if (data.model !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "model must be null when providerId is null."
        })
      }
      return
    }

    if (data.model === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "model is required when providerId is set."
      })
      return
    }

    const allowedIds = storyboardModelCatalog[data.providerId].map((entry) => entry.id)
    if (!allowedIds.some((id) => id === data.model)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Model must be a catalog option for ${data.providerId}.`
      })
    }
  })

export const settingsMutationOkResponsePayloadSchema = z.object({})

export const secretsWriteApiKeyRequestPayloadSchema = z.object({
  providerId: providerIdSchema,
  apiKey: z.string().min(1)
})

export const secretsWriteApiKeyResponsePayloadSchema = z.object({
  hasApiKey: z.literal(true)
})

export const secretsDeleteApiKeyRequestPayloadSchema = z.object({
  providerId: providerIdSchema
})

export const secretsDeleteApiKeyResponsePayloadSchema = z.object({
  hasApiKey: z.literal(false)
})

const usageSummaryByEntitySchema = z.object({
  scenes: z.record(z.string(), z.number()),
  characters: z.record(z.string(), z.number()),
  backgrounds: z.record(z.string(), z.number()),
  totalUsd: z.number()
})

export const usageReadRequestPayloadSchema = z.object({})

export const usageReadResponsePayloadSchema = usageSummaryByEntitySchema

export const storyboardRequestPayloadSchemas = {
  "cards.list": cardsListRequestPayloadSchema,
  "cards.read": cardsReadRequestPayloadSchema,
  "cards.write": cardsWriteRequestPayloadSchema,
  "cards.createPlaceholder": cardsCreatePlaceholderRequestPayloadSchema,
  "cards.resolveImageUri": cardsResolveImageUriRequestPayloadSchema,
  "cards.open": cardsOpenRequestPayloadSchema,
  "cards.delete": cardsDeleteRequestPayloadSchema,
  "scenes.list": scenesListRequestPayloadSchema,
  "scenes.openScene": scenesOpenSceneRequestPayloadSchema,
  "scenes.openDraft": scenesOpenDraftRequestPayloadSchema,
  "scenes.generateDraft": scenesGenerateDraftRequestPayloadSchema,
  "relations.list": relationsListRequestPayloadSchema,
  "ai.providers.list": aiProvidersListRequestPayloadSchema,
  "ai.providers.checkConnection": aiProvidersCheckConnectionRequestPayloadSchema,
  "ai.generate": aiGenerateRequestPayloadSchema,
  "ai.generateStream": aiGenerateStreamRequestPayloadSchema,
  "settings.read": settingsReadRequestPayloadSchema,
  "settings.updateDefaultProvider": settingsUpdateDefaultProviderRequestPayloadSchema,
  "settings.updateProviderModel": settingsUpdateProviderModelRequestPayloadSchema,
  "settings.updateProviderBaseUrl": settingsUpdateProviderBaseUrlRequestPayloadSchema,
  "settings.updateTaskAiConfig": settingsUpdateTaskAiConfigRequestPayloadSchema,
  "secrets.writeApiKey": secretsWriteApiKeyRequestPayloadSchema,
  "secrets.deleteApiKey": secretsDeleteApiKeyRequestPayloadSchema,
  "usage.read": usageReadRequestPayloadSchema
} as const

export const storyboardResponsePayloadSchemas = {
  "cards.list": cardsListResponsePayloadSchema,
  "cards.read": cardsReadResponsePayloadSchema,
  "cards.write": cardsWriteResponsePayloadSchema,
  "cards.createPlaceholder": cardsCreatePlaceholderResponsePayloadSchema,
  "cards.resolveImageUri": cardsResolveImageUriResponsePayloadSchema,
  "cards.open": cardsOpenResponsePayloadSchema,
  "cards.delete": cardsDeleteResponsePayloadSchema,
  "scenes.list": scenesListResponsePayloadSchema,
  "scenes.openScene": scenesOpenSceneResponsePayloadSchema,
  "scenes.openDraft": scenesOpenDraftResponsePayloadSchema,
  "scenes.generateDraft": scenesGenerateDraftResponsePayloadSchema,
  "relations.list": relationsListResponsePayloadSchema,
  "ai.providers.list": aiProvidersListResponsePayloadSchema,
  "ai.providers.checkConnection": aiProvidersCheckConnectionResponsePayloadSchema,
  "ai.generate": aiGenerateResponsePayloadSchema,
  "ai.generateStream": aiGenerateStreamResponsePayloadSchema,
  "settings.read": settingsReadResponsePayloadSchema,
  "settings.updateDefaultProvider": settingsMutationOkResponsePayloadSchema,
  "settings.updateProviderModel": settingsMutationOkResponsePayloadSchema,
  "settings.updateProviderBaseUrl": settingsMutationOkResponsePayloadSchema,
  "settings.updateTaskAiConfig": settingsMutationOkResponsePayloadSchema,
  "secrets.writeApiKey": secretsWriteApiKeyResponsePayloadSchema,
  "secrets.deleteApiKey": secretsDeleteApiKeyResponsePayloadSchema,
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

export type StoryboardSettingsChangedEventMessage = {
  readonly type: "event"
  readonly method: "settings.changed"
  readonly payload: StoryboardResponsePayload<"settings.read">
}

export type StoryboardUsageChangedEventMessage = {
  readonly type: "event"
  readonly method: "usage.changed"
  readonly payload: StoryboardResponsePayload<"usage.read">
}

export type StoryboardAiGenerateStreamChunkEventMessage = {
  readonly type: "event"
  readonly method: "ai.generateStream.chunk"
  readonly payload: z.infer<typeof aiGenerateStreamChunkEventPayloadSchema>
}

type StoryboardRequestMessageMap = {
  readonly [M in StoryboardRequestMethod]: {
    readonly protocolVersion: typeof storyboardMessageProtocolVersion
    readonly type: "request"
    readonly id: string
    readonly method: M
    readonly payload: StoryboardRequestPayload<M>
  }
}

type StoryboardSuccessResponseMessageMap = {
  readonly [M in StoryboardResponseMethod]: {
    readonly protocolVersion: typeof storyboardMessageProtocolVersion
    readonly type: "response"
    readonly id: string
    readonly method: M
    readonly ok: true
    readonly payload: StoryboardResponsePayload<M>
  }
}

type StoryboardErrorResponseMessageMap = {
  readonly [M in StoryboardResponseMethod]: {
    readonly protocolVersion: typeof storyboardMessageProtocolVersion
    readonly type: "response"
    readonly id: string
    readonly method: M
    readonly ok: false
    readonly error: StoryboardMessageError
  }
}

export type StoryboardRequestMessage<M extends StoryboardRequestMethod = StoryboardRequestMethod> =
  StoryboardRequestMessageMap[M]

export type StoryboardSuccessResponseMessage<
  M extends StoryboardResponseMethod = StoryboardResponseMethod
> = StoryboardSuccessResponseMessageMap[M]

export type StoryboardErrorResponseMessage<
  M extends StoryboardResponseMethod = StoryboardResponseMethod
> = StoryboardErrorResponseMessageMap[M]

export interface StoryboardMessageError {
  readonly code: string
  readonly message: string
}

export type StoryboardResponseMessage<M extends StoryboardResponseMethod = StoryboardResponseMethod> =
  | StoryboardSuccessResponseMessage<M>
  | StoryboardErrorResponseMessage<M>

export type StoryboardIncomingMessage = StoryboardRequestMessage
export type StoryboardOutgoingMessage = StoryboardResponseMessage

const requestEnvelopeSchema = z.object({
  protocolVersion: z.literal(storyboardMessageProtocolVersion),
  type: z.literal("request"),
  id: requestIdSchema,
  method: methodSchema,
  payload: z.unknown()
})

export function parseStoryboardRequestMessage(message: unknown): StoryboardRequestMessage {
  const envelope = requestEnvelopeSchema.parse(message)

  if (!isStoryboardRequestMethod(envelope.method)) {
    throw new Error(`Unsupported Storyboard RPC method: ${envelope.method}`)
  }

  const payload = storyboardRequestPayloadSchemas[envelope.method].parse(envelope.payload)

  return {
    protocolVersion: envelope.protocolVersion,
    type: envelope.type,
    id: envelope.id,
    method: envelope.method,
    payload
  } as StoryboardRequestMessage
}

export function createStoryboardSuccessResponse<M extends StoryboardResponseMethod>(
  request: { readonly id: string; readonly method: M },
  payload: StoryboardResponsePayload<M>
): StoryboardSuccessResponseMessage<M> {
  const parsedPayload = storyboardResponsePayloadSchemas[request.method].parse(payload) as StoryboardResponsePayload<M>

  return {
    protocolVersion: storyboardMessageProtocolVersion,
    type: "response",
    id: request.id,
    method: request.method,
    ok: true,
    payload: parsedPayload
  } as StoryboardSuccessResponseMessage<M>
}

export function createStoryboardErrorResponse<M extends StoryboardResponseMethod>(
  request: { readonly id: string; readonly method: M },
  error: StoryboardMessageError
): StoryboardErrorResponseMessage<M> {
  return {
    protocolVersion: storyboardMessageProtocolVersion,
    type: "response",
    id: request.id,
    method: request.method,
    ok: false,
    error
  } as StoryboardErrorResponseMessage<M>
}

export function isStoryboardRequestMethod(method: string): method is StoryboardRequestMethod {
  return Object.prototype.hasOwnProperty.call(storyboardRequestPayloadSchemas, method)
}
