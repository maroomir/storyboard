import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { OAuthRegistration, SecretStore } from '#ai/ports/SecretStore';
import type { OAuthConnection } from '#ai/ports/SecretStore';
import type { AiProviderId } from '@storyboard/story-model';
import {
  ChatGptOAuthClient,
  ChatGptOAuthError,
  chatGptCallbackPath,
  chatGptPreferredCallbackPort,
  createAuthorizationAttempt,
  createHostId,
  hasPlanUsageScope,
  loopbackRedirectUri,
  readAuthorizationCallback,
  tokensFromResponse,
  validateIdToken,
  type AuthorizationAttempt,
  type AuthorizedCallback,
  type DiscoveryDocument,
  type FetchLike,
  type IdTokenIdentity,
  type TokenResponse,
} from './chatGptOAuth';

const providerId: AiProviderId = 'chatgpt';
const defaultTimeoutMs: number = 5 * 60 * 1000;

const callbackPage = (title: string, body: string): string =>
  `<!doctype html><html lang="ko"><meta charset="utf-8"><title>Storyboard</title><body style="font-family:sans-serif;margin:3rem"><h1>${title}</h1><p>${body}</p></body></html>`;

export interface ChatGptLoginFlowDependencies {
  readonly secretStore: SecretStore;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
  readonly preferredPort?: number;
  readonly now?: () => Date;
}

export interface BrowserPrompt {
  readonly openBrowser: (url: string) => Promise<boolean>;
  readonly onAuthorizationUrl: (url: string, wasOpened: boolean) => void;
}

export interface ChatGptLoginResult {
  readonly accountLabel: string | undefined;
  readonly isNewRegistration: boolean;
}

export interface ChatGptLogoutResult {
  readonly wasConnected: boolean;
  readonly isRevoked: boolean;
}

interface CallbackListener {
  readonly server: Server;
  readonly port: number;
  readonly query: Promise<URLSearchParams>;
}

async function listenForCallback(preferredPort: number): Promise<CallbackListener> {
  const server: Server = createServer();
  let settle: ((query: URLSearchParams) => void) | undefined;
  const query: Promise<URLSearchParams> = new Promise<URLSearchParams>((resolve) => {
    settle = resolve;
  });

  server.on('request', (request, response) => {
    const url: URL = new URL(request.url ?? '/', 'http://127.0.0.1');

    if (url.pathname !== chatGptCallbackPath) {
      response.writeHead(404).end();
      return;
    }

    const isDenied: boolean = url.searchParams.has('error');
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(
      isDenied
        ? callbackPage('로그인이 끝나지 않았습니다', '터미널로 돌아가 안내를 확인하세요.')
        : callbackPage('로그인이 끝났습니다', '이 창을 닫고 터미널로 돌아가세요.'),
    );
    settle?.(url.searchParams);
  });

  const port: number = await new Promise<number>((resolve, reject) => {
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
    const timer: NodeJS.Timeout = setTimeout(
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

export class ChatGptLoginFlow {
  private readonly oauth: ChatGptOAuthClient;
  private readonly now: () => Date;

  public constructor(private readonly deps: ChatGptLoginFlowDependencies) {
    this.oauth = new ChatGptOAuthClient(deps.fetch ?? globalThis.fetch);
    this.now = deps.now ?? ((): Date => new Date());
  }

  public async login(browser: BrowserPrompt): Promise<ChatGptLoginResult> {
    const existing: OAuthConnection | undefined =
      await this.deps.secretStore.getOAuthConnection(providerId);
    const hostId: string = existing?.hostId ?? createHostId();
    const registration: OAuthRegistration | undefined = existing?.registration;

    const listener: CallbackListener = await listenForCallback(
      this.deps.preferredPort ?? chatGptPreferredCallbackPort,
    );

    try {
      const attempt: AuthorizationAttempt = createAuthorizationAttempt({
        hostId,
        redirectUri: loopbackRedirectUri(listener.port),
        ...(registration === undefined ? {} : { clientId: registration.clientId }),
        ...(existing?.tokens?.idToken === undefined
          ? {}
          : { idTokenHint: existing.tokens.idToken }),
        ...(registration?.email === undefined ? {} : { loginHint: registration.email }),
      });

      const wasOpened: boolean = await browser.openBrowser(attempt.url).catch(() => false);
      browser.onAuthorizationUrl(attempt.url, wasOpened);

      const query: URLSearchParams = await withTimeout(
        listener.query,
        this.deps.timeoutMs ?? defaultTimeoutMs,
        '제한 시간 안에 브라우저 로그인이 끝나지 않았습니다. 다시 실행하세요.',
      );
      const callback: AuthorizedCallback = readAuthorizationCallback(query, attempt);

      const tokenResponse: TokenResponse = await this.oauth.exchangeAuthorizationCode({
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

      const discovery: DiscoveryDocument = await this.oauth.fetchDiscoveryDocument();
      const identity: IdTokenIdentity = validateIdToken(tokenResponse.idToken, {
        clientId: callback.clientId,
        nonce: attempt.nonce,
        keys: await this.oauth.fetchJsonWebKeys(discovery.jwksUri),
        now: this.now(),
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
        tokens: tokensFromResponse(tokenResponse, this.now()),
      };
      await this.deps.secretStore.setOAuthConnection(providerId, connection);

      return { accountLabel: identity.email, isNewRegistration: registration === undefined };
    } finally {
      listener.server.close();
    }
  }

  public async logout(): Promise<ChatGptLogoutResult> {
    const existing: OAuthConnection | undefined =
      await this.deps.secretStore.getOAuthConnection(providerId);

    if (existing?.tokens === undefined || existing.registration === undefined) {
      return { wasConnected: false, isRevoked: false };
    }

    let isRevoked: boolean = false;
    try {
      const discovery: DiscoveryDocument = await this.oauth.fetchDiscoveryDocument();
      if (discovery.revocationEndpoint !== undefined) {
        await this.oauth.revokeRefreshToken({
          revocationEndpoint: discovery.revocationEndpoint,
          clientId: existing.registration.clientId,
          refreshToken: existing.tokens.refreshToken,
        });
        isRevoked = true;
      }
    } catch {
      isRevoked = false;
    }

    await this.deps.secretStore.setOAuthConnection(providerId, {
      hostId: existing.hostId,
      registration: existing.registration,
    });

    return { wasConnected: true, isRevoked };
  }
}
