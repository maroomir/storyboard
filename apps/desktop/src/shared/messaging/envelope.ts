import { z } from 'zod';

import { methodSchema, requestIdSchema, storyboardMessageProtocolVersion } from './atoms';
import {
  storyboardRequestPayloadSchemas,
  storyboardResponsePayloadSchemas,
  type StoryboardRequestMethod,
  type StoryboardRequestPayload,
  type StoryboardResponseMethod,
  type StoryboardResponsePayload,
} from './registry';

type StoryboardRequestMessageMap = {
  readonly [M in StoryboardRequestMethod]: {
    readonly protocolVersion: typeof storyboardMessageProtocolVersion;
    readonly type: 'request';
    readonly id: string;
    readonly method: M;
    readonly payload: StoryboardRequestPayload<M>;
  };
};

type StoryboardSuccessResponseMessageMap = {
  readonly [M in StoryboardResponseMethod]: {
    readonly protocolVersion: typeof storyboardMessageProtocolVersion;
    readonly type: 'response';
    readonly id: string;
    readonly method: M;
    readonly ok: true;
    readonly payload: StoryboardResponsePayload<M>;
  };
};

type StoryboardErrorResponseMessageMap = {
  readonly [M in StoryboardResponseMethod]: {
    readonly protocolVersion: typeof storyboardMessageProtocolVersion;
    readonly type: 'response';
    readonly id: string;
    readonly method: M;
    readonly ok: false;
    readonly error: StoryboardMessageError;
  };
};

export type StoryboardRequestMessage<M extends StoryboardRequestMethod = StoryboardRequestMethod> =
  StoryboardRequestMessageMap[M];

export type StoryboardSuccessResponseMessage<
  M extends StoryboardResponseMethod = StoryboardResponseMethod,
> = StoryboardSuccessResponseMessageMap[M];

export type StoryboardErrorResponseMessage<
  M extends StoryboardResponseMethod = StoryboardResponseMethod,
> = StoryboardErrorResponseMessageMap[M];

export interface StoryboardMessageError {
  readonly code: string;
  readonly message: string;
}

const requestEnvelopeSchema = z.object({
  protocolVersion: z.literal(storyboardMessageProtocolVersion),
  type: z.literal('request'),
  id: requestIdSchema,
  method: methodSchema,
  payload: z.unknown(),
});

export function parseStoryboardRequestMessage(message: unknown): StoryboardRequestMessage {
  const envelope = requestEnvelopeSchema.parse(message);

  if (!isStoryboardRequestMethod(envelope.method)) {
    throw new Error(`Unsupported Storyboard RPC method: ${envelope.method}`);
  }

  const payload = storyboardRequestPayloadSchemas[envelope.method].parse(envelope.payload);

  return {
    protocolVersion: envelope.protocolVersion,
    type: envelope.type,
    id: envelope.id,
    method: envelope.method,
    payload,
  } as StoryboardRequestMessage;
}

export function createStoryboardSuccessResponse<M extends StoryboardResponseMethod>(
  request: { readonly id: string; readonly method: M },
  payload: StoryboardResponsePayload<M>,
): StoryboardSuccessResponseMessage<M> {
  const parsedPayload = storyboardResponsePayloadSchemas[request.method].parse(
    payload,
  ) as StoryboardResponsePayload<M>;

  return {
    protocolVersion: storyboardMessageProtocolVersion,
    type: 'response',
    id: request.id,
    method: request.method,
    ok: true,
    payload: parsedPayload,
  } as StoryboardSuccessResponseMessage<M>;
}

export function createStoryboardErrorResponse<M extends StoryboardResponseMethod>(
  request: { readonly id: string; readonly method: M },
  error: StoryboardMessageError,
): StoryboardErrorResponseMessage<M> {
  return {
    protocolVersion: storyboardMessageProtocolVersion,
    type: 'response',
    id: request.id,
    method: request.method,
    ok: false,
    error,
  } as StoryboardErrorResponseMessage<M>;
}

export function isStoryboardRequestMethod(method: string): method is StoryboardRequestMethod {
  return Object.prototype.hasOwnProperty.call(storyboardRequestPayloadSchemas, method);
}
