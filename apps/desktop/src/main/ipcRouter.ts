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
import { extractErrorMessage } from '@storyboard/story-model';

export type InvokeHandlers = {
  readonly [C in InvokeChannel]: (request: InvokeRequest<C>) => Promise<ServiceResult<InvokeResponses[C]>>;
};

interface InvokeEnvelope {
  readonly channel: string;
  readonly request?: unknown;
}

const envelopeSchema: z.ZodType<InvokeEnvelope> = z.object({ channel: z.string(), request: z.unknown() });

function isInvokeChannel(channel: string): channel is InvokeChannel {
  return Object.prototype.hasOwnProperty.call(invokeRequestSchemas, channel);
}

export interface IpcRouterMessages {
  readonly invalidRequest: () => string;
  readonly internal: (message: string) => string;
}

export class IpcRouter {
  public constructor(
    private readonly handlers: InvokeHandlers,
    private readonly logger: IStoryboardLogger,
    private readonly describe: IpcRouterMessages,
  ) {}

  public readonly route = async (message: unknown): Promise<InvokeResult<InvokeChannel>> => {
    const envelope: z.ZodSafeParseResult<InvokeEnvelope> = envelopeSchema.safeParse(message);

    if (!envelope.success || !isInvokeChannel(envelope.data.channel)) {
      return fail('invalid-request', this.describe.invalidRequest());
    }

    const channel: InvokeChannel = envelope.data.channel;
    const request: z.ZodSafeParseResult<InvokeRequest<InvokeChannel>> = invokeRequestSchemas[channel].safeParse(envelope.data.request);

    if (!request.success) {
      this.logger.warn(`Rejected ${channel}: ${request.error.issues.map((issue) => issue.message).join('; ')}`);
      return fail('invalid-request', this.describe.invalidRequest());
    }

    try {
      const handler: (request: unknown) => Promise<InvokeResult<InvokeChannel>> = this.handlers[channel] as (request: unknown) => Promise<InvokeResult<InvokeChannel>>;
      return await handler(request.data);
    } catch (error) {
      this.logger.error(`${channel} failed`, error);
      return fail('internal', this.describe.internal(extractErrorMessage(error)));
    }
  };
}
