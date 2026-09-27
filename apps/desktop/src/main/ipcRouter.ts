import { z } from 'zod';

import type { IStoryboardLogger } from '@storyboard/story-engine';

import {
  invokeRequestSchemas,
  type InvokeChannel,
  type InvokeRequest,
  type InvokeResponses,
  type InvokeResult,
} from '@/shared/ipcContract';

import { fail, type ServiceResult } from './serviceResult';

export type InvokeHandlers = {
  readonly [C in InvokeChannel]: (request: InvokeRequest<C>) => Promise<ServiceResult<InvokeResponses[C]>>;
};

const envelopeSchema = z.object({ channel: z.string(), request: z.unknown() });

function isInvokeChannel(channel: string): channel is InvokeChannel {
  return Object.prototype.hasOwnProperty.call(invokeRequestSchemas, channel);
}

// SECURITY: every message from the renderer is parsed against the channel's schema before a
// handler sees it, and nothing the renderer sends reaches a handler unvalidated.
// This is also the outermost ring on the main side: an unexpected throw becomes an `internal`
// error for the renderer and a log line, never a crashed main process.
export function createIpcRouter(
  handlers: InvokeHandlers,
  logger: IStoryboardLogger,
  describe: { readonly invalidRequest: () => string; readonly internal: (message: string) => string },
): (message: unknown) => Promise<InvokeResult<InvokeChannel>> {
  return async (message) => {
    const envelope = envelopeSchema.safeParse(message);

    if (!envelope.success || !isInvokeChannel(envelope.data.channel)) {
      return fail('invalid-request', describe.invalidRequest());
    }

    const channel = envelope.data.channel;
    const request = invokeRequestSchemas[channel].safeParse(envelope.data.request);

    if (!request.success) {
      logger.warn(`Rejected ${channel}: ${request.error.issues.map((issue) => issue.message).join('; ')}`);
      return fail('invalid-request', describe.invalidRequest());
    }

    try {
      const handler = handlers[channel] as (request: unknown) => Promise<InvokeResult<InvokeChannel>>;
      return await handler(request.data);
    } catch (error) {
      logger.error(`${channel} failed`, error);
      return fail('internal', describe.internal(error instanceof Error ? error.message : String(error)));
    }
  };
}
