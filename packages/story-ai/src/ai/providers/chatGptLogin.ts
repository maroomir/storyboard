import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { SecretStore } from '#ai/ports/SecretStore';
import type { OAuthConnection } from '#ai/ports/SecretStore';
import type { AiProviderId } from '@storyboard/story-model';
import {
  ChatGptOAuthError,
  chatGptCallbackPath,
  chatGptPreferredCallbackPort,
  createAuthorizationAttempt,
  createHostId,
  exchangeAuthorizationCode,
  fetchDiscoveryDocument,
  fetchJsonWebKeys,
  hasPlanUsageScope,
  loopbackRedirectUri,
  readAuthorizationCallback,
  revokeRefreshToken,
  tokensFromResponse,
  validateIdToken,
  type FetchLike,
} from './chatGptOAuth';

const providerId: AiProviderId = 'chatgpt';
const defaultTimeoutMs = 5 * 60 * 1000;

// What the browser shows once it has handed the code back; the person returns to the terminal.
const callbackPage = (title: string, body: string): string =>
  `<!doctype html><html lang="ko"><meta charset="utf-8"><title>Storyboard</title><body style="font-family:sans-serif;margin:3rem"><h1>${title}</h1><p>${body}</p></body></html>`;

export interface ChatGptLoginDependencies {
  readonly secretStore: SecretStore;
  // Opens the system browser; false when it could not. The URL is shown to the person either way.
  readonly openBrowser: (url: string) => Promise<boolean>;
  readonly onAuthorizationUrl: (url: string, wasOpened: boolean) => void;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
  readonly preferredPort?: number;
  readonly now?: () => Date;
}

export interface ChatGptLoginResult {
  readonly accountLabel: string | undefined;
  readonly isNewRegistration: boolean;
}

// Listens on the loopback address: the documented port when it is free, any free port otherwise
// (only the port may differ between logins). Resolves with the first request to the callback path.
async function listenForCallback(
  preferredPort: number,
): Promise<{
  readonly server: Server;
  readonly port: number;
  readonly query: Promise<URLSearchParams>;
}> {
  const server = createServer();
  let settle: ((query: URLSearchParams) => void) | undefined;
  const query = new Promise<URLSearchParams>((resolve) => {
    settle = resolve;
  });

  server.on('request', (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');

    if (url.pathname !== chatGptCallbackPath) {
      response.writeHead(404).end();
      return;
    }

    const isDenied = url.searchParams.has('error');
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(
      isDenied
        ? callbackPage('로그인이 끝나지 않았습니다', '터미널로 돌아가 안내를 확인하세요.')
        : callbackPage('로그인이 끝났습니다', '이 창을 닫고 터미널로 돌아가세요.'),
    );
    settle?.(url.searchParams);
  });

  const port = await new Promise<number>((resolve, reject) => {
    const tryListen = (candidate: number): void => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE' && candidate !== 0) {
          tryListen(0);
          return;
        }
        reject(error);
      });
      server.listen(candidate, '127.0.0.1', () => {
        server.removeAllListeners('error');
        resolve((server.address() as AddressInfo).port);
      });
    };

    tryListen(preferredPort);
  });

  return { server, port, query };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ChatGptOAuthError('access-denied', message)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// The whole sign-in: a fresh attempt, the browser, the callback, the code exchange, the ID token
// and the plan-usage scope, then the connection written to the secret store. A registration that
// exists is reauthorized with its issued client id; the host id never changes once chosen.
export async function loginChatGpt(deps: ChatGptLoginDependencies): Promise<ChatGptLoginResult> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? ((): Date => new Date());
  const existing = await deps.secretStore.getOAuthConnection(providerId);
  const hostId = existing?.hostId ?? createHostId();
  const registration = existing?.registration;

  const listener = await listenForCallback(deps.preferredPort ?? chatGptPreferredCallbackPort);

  try {
    const attempt = createAuthorizationAttempt({
      hostId,
      redirectUri: loopbackRedirectUri(listener.port),
      ...(registration === undefined ? {} : { clientId: registration.clientId }),
      ...(existing?.tokens?.idToken === undefined ? {} : { idTokenHint: existing.tokens.idToken }),
      ...(registration?.email === undefined ? {} : { loginHint: registration.email }),
    });

    const wasOpened = await deps.openBrowser(attempt.url).catch(() => false);
    deps.onAuthorizationUrl(attempt.url, wasOpened);

    const query = await withTimeout(
      listener.query,
      deps.timeoutMs ?? defaultTimeoutMs,
      '제한 시간 안에 브라우저 로그인이 끝나지 않았습니다. 다시 실행하세요.',
    );
    const callback = readAuthorizationCallback(query, attempt);

    const tokenResponse = await exchangeAuthorizationCode(fetchImpl, {
      clientId: callback.clientId,
      code: callback.code,
      codeVerifier: attempt.codeVerifier,
      redirectUri: attempt.redirectUri,
    });

    if (tokenResponse.idToken === undefined) {
      throw new ChatGptOAuthError(
        'invalid-id-token',
        'ID 토큰을 검증하지 못했습니다: 응답에 없습니다',
      );
    }

    const discovery = await fetchDiscoveryDocument(fetchImpl);
    const identity = validateIdToken(tokenResponse.idToken, {
      clientId: callback.clientId,
      nonce: attempt.nonce,
      keys: await fetchJsonWebKeys(fetchImpl, discovery.jwksUri),
      now: now(),
    });

    if (registration !== undefined && registration.subject !== identity.subject) {
      throw new ChatGptOAuthError(
        'client-mismatch',
        '로그인한 계정이 저장된 등록의 계정과 다릅니다. 먼저 `storyboard logout chatgpt` 로 등록을 지우고 다시 로그인하세요.',
      );
    }

    if (!hasPlanUsageScope(tokenResponse.scopes)) {
      throw new ChatGptOAuthError(
        'plan-usage-not-granted',
        '로그인은 됐지만 ChatGPT 구독 사용 권한을 받지 못했습니다. 다시 로그인하면서 권한 요청에 동의하세요.',
      );
    }

    const connection: OAuthConnection = {
      hostId,
      registration: {
        clientId: callback.clientId,
        subject: identity.subject,
        ...(identity.email === undefined ? {} : { email: identity.email }),
      },
      tokens: tokensFromResponse(tokenResponse, now()),
    };
    await deps.secretStore.setOAuthConnection(providerId, connection);

    return { accountLabel: identity.email, isNewRegistration: registration === undefined };
  } finally {
    listener.server.close();
  }
}

export interface ChatGptLogoutResult {
  readonly wasConnected: boolean;
  // False when the server did not confirm the revocation; the tokens are cleared locally anyway.
  readonly isRevoked: boolean;
}

// Ends the renewable session on the server when it can, then drops the tokens. The registration
// and the host id stay, so a later login is a reauthorization rather than a new client.
export async function logoutChatGpt(deps: {
  readonly secretStore: SecretStore;
  readonly fetch?: FetchLike;
}): Promise<ChatGptLogoutResult> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const existing = await deps.secretStore.getOAuthConnection(providerId);

  if (existing?.tokens === undefined || existing.registration === undefined) {
    return { wasConnected: false, isRevoked: false };
  }

  let isRevoked = false;
  try {
    const discovery = await fetchDiscoveryDocument(fetchImpl);
    if (discovery.revocationEndpoint !== undefined) {
      await revokeRefreshToken(fetchImpl, {
        revocationEndpoint: discovery.revocationEndpoint,
        clientId: existing.registration.clientId,
        refreshToken: existing.tokens.refreshToken,
      });
      isRevoked = true;
    }
  } catch {
    // The person is told the server did not confirm; the local tokens go regardless.
  }

  await deps.secretStore.setOAuthConnection(providerId, {
    hostId: existing.hostId,
    registration: existing.registration,
  });

  return { wasConnected: true, isRevoked };
}
