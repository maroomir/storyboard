import type {
  DesktopError,
  InvokeChannel,
  InvokeRequest,
  InvokeResponses,
InvokeResult,
} from '@/shared/ipcContract';

import { desktopBridge } from './bridge';

export class BridgeError extends Error {
  public constructor(public readonly failure: DesktopError) {
    super(failure.message);
    this.name = 'BridgeError';
  }
}

export async function call<C extends InvokeChannel>(
  channel: C,
  request: InvokeRequest<C>,
): Promise<InvokeResponses[C]> {
  const invocation: InvokeResult<C> = await desktopBridge().invoke(channel, request);

  if (!invocation.ok) {
    throw new BridgeError(invocation.error);
  }

  return invocation.data;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
