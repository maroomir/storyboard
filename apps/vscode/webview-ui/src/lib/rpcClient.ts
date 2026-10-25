import { createRequestId } from '@webview/lib/messaging';
import type { VscodeApi } from '@webview/lib/vscodeApi';

interface RpcResponse<T> {
  readonly type: 'response';
  readonly id: string;
  readonly ok: boolean;
  readonly payload?: T;
  readonly error?: { readonly message: string };
}

export interface CallRpcOptions {
  readonly fallbackErrorMessage?: string;
}

const defaultFallbackErrorMessage: string = '요청을 처리하지 못했습니다.';

export function callRpc<T>(
  vscodeApi: VscodeApi,
  method: string,
  payload: Record<string, unknown>,
  options: CallRpcOptions = {},
): Promise<T> {
  const id: string = createRequestId();

  return new Promise((resolve, reject) => {
    const handler = (event: MessageEvent): void => {
      const response: RpcResponse<T> | undefined = event.data as RpcResponse<T> | undefined;
      if (!response || response.type !== 'response' || response.id !== id) {
        return;
      }

      window.removeEventListener('message', handler);

      if (response.ok && response.payload !== undefined) {
        resolve(response.payload);
        return;
      }

      reject(
        new Error(
          response.error?.message ?? options.fallbackErrorMessage ?? defaultFallbackErrorMessage,
        ),
      );
    };

    window.addEventListener('message', handler);
    vscodeApi.postMessage({ protocolVersion: '1.0.0', type: 'request', id, method, payload });
  });
}
