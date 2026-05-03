import { z } from "zod"

import { cardSchema, cardTypes } from "./card"

export const storyboardMessageProtocolVersion = "1.0.0"

const requestIdSchema = z.string().trim().min(1)
const methodSchema = z.string().trim().min(1)
const uriStringSchema = z.string().trim().min(1)

export const cardsListRequestPayloadSchema = z.object({
  type: z.enum(cardTypes).optional()
})

export const cardsReadRequestPayloadSchema = z.object({
  uri: uriStringSchema
})

export const cardsWriteRequestPayloadSchema = z.object({
  uri: uriStringSchema,
  card: cardSchema
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

export const cardSummarySchema = z.object({
  type: z.enum(cardTypes),
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  uri: uriStringSchema
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

export const storyboardRequestPayloadSchemas = {
  "cards.list": cardsListRequestPayloadSchema,
  "cards.read": cardsReadRequestPayloadSchema,
  "cards.write": cardsWriteRequestPayloadSchema,
  "cards.createPlaceholder": cardsCreatePlaceholderRequestPayloadSchema,
  "cards.resolveImageUri": cardsResolveImageUriRequestPayloadSchema
} as const

export const storyboardResponsePayloadSchemas = {
  "cards.list": cardsListResponsePayloadSchema,
  "cards.read": cardsReadResponsePayloadSchema,
  "cards.write": cardsWriteResponsePayloadSchema,
  "cards.createPlaceholder": cardsCreatePlaceholderResponsePayloadSchema,
  "cards.resolveImageUri": cardsResolveImageUriResponsePayloadSchema
} as const

export type StoryboardRequestMethod = keyof typeof storyboardRequestPayloadSchemas
export type StoryboardResponseMethod = keyof typeof storyboardResponsePayloadSchemas

export type StoryboardRequestPayload<M extends StoryboardRequestMethod> = z.infer<
  (typeof storyboardRequestPayloadSchemas)[M]
>

export type StoryboardResponsePayload<M extends StoryboardResponseMethod> = z.infer<
  (typeof storyboardResponsePayloadSchemas)[M]
>

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
