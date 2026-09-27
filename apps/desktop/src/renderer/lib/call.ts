import type {
  DesktopError,
  InvokeChannel,
  InvokeRequest,
  InvokeResponses,
} from '@/shared/ipcContract';

import { desktopBridge } from './bridge';

export class BridgeError extends Error {
  public constructor(public readonly failure: DesktopError) {
    super(failure.message);
    this.name = 'BridgeError';
  }
}

// Screens await data and show a failure's message; main has already worded it for the author.
export async function call<C extends InvokeChannel>(
  channel: C,
  request: InvokeRequest<C>,
): Promise<InvokeResponses[C]> {
  const result = await desktopBridge().invoke(channel, request);

  if (!result.ok) {
    throw new BridgeError(result.error);
  }

  return result.data;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
