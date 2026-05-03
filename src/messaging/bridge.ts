import { ZodError } from "zod"

import {
  createStoryboardErrorResponse,
  createStoryboardSuccessResponse,
  parseStoryboardRequestMessage,
  type StoryboardRequestMessage,
  type StoryboardRequestMethod,
  type StoryboardResponsePayload
} from "../shared/messaging"

export interface StoryboardWebviewLike {
  readonly postMessage: (message: unknown) => PromiseLike<boolean>
  readonly onDidReceiveMessage: (
    listener: (message: unknown) => void | PromiseLike<void>
  ) => { readonly dispose: () => void }
}

export type StoryboardRpcHandlers = {
  readonly [M in StoryboardRequestMethod]?: (
    payload: StoryboardRequestMessage<M>["payload"],
    request: StoryboardRequestMessage<M>
  ) => Promise<StoryboardResponsePayload<M>>
}

export interface StoryboardWebviewBridge {
  readonly dispose: () => void
}

export function createWebviewBridge(
  webview: StoryboardWebviewLike,
  handlers: StoryboardRpcHandlers
): StoryboardWebviewBridge {
  const disposable = webview.onDidReceiveMessage((message) => handleIncomingMessage(webview, handlers, message))

  return {
    dispose: () => disposable.dispose()
  }
}

async function handleIncomingMessage(
  webview: StoryboardWebviewLike,
  handlers: StoryboardRpcHandlers,
  message: unknown
): Promise<void> {
  let request: StoryboardRequestMessage

  try {
    request = parseStoryboardRequestMessage(message)
  } catch (error) {
    await webview.postMessage(createMalformedRequestResponse(error))
    return
  }

  const handler = handlers[request.method]

  if (!handler) {
    await webview.postMessage(
      createStoryboardErrorResponse(request, {
        code: "handler-not-found",
        message: `No Storyboard RPC handler registered for ${request.method}.`
      })
    )
    return
  }

  try {
    const payload = await invokeHandler(handler, request)
    await webview.postMessage(createStoryboardSuccessResponse(request, payload))
  } catch (error) {
    await webview.postMessage(createStoryboardErrorResponse(request, toMessageError(error)))
  }
}

async function invokeHandler<M extends StoryboardRequestMethod>(
  handler: NonNullable<StoryboardRpcHandlers[M]>,
  request: StoryboardRequestMessage<M>
): Promise<StoryboardResponsePayload<M>> {
  return handler(request.payload, request)
}

function createMalformedRequestResponse(error: unknown): unknown {
  return {
    protocolVersion: "1.0.0",
    type: "response",
    id: "unknown",
    method: "unknown",
    ok: false,
    error: toMessageError(error, "malformed-request")
  }
}

function toMessageError(error: unknown, fallbackCode = "handler-error"): { code: string; message: string } {
  if (error instanceof ZodError) {
    return {
      code: "validation-error",
      message: error.issues.map((issue) => issue.message).join("; ")
    }
  }

  if (error instanceof Error) {
    return {
      code: fallbackCode,
      message: error.message
    }
  }

  return {
    code: fallbackCode,
    message: "Unknown Storyboard RPC error."
  }
}
