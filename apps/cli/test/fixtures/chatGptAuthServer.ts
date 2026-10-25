import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';

import { chatGptIssuer, chatGptTokenUrl, type FetchLike } from '@storyboard/story-ai';
import type { StoryboardSecretStorageLike } from '@storyboard/story-ai';

export const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const signingKeyId = 'test-key';
export const jwks = [{ ...publicKey.export({ format: 'jwk' }), kid: signingKeyId, alg: 'RS256' }];

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

export function mintIdToken(
  claims: Record<string, unknown>,
  key: KeyObject = privateKey,
  header: Record<string, unknown> = { alg: 'RS256', kid: signingKeyId },
): string {
  const payload = {
    iss: chatGptIssuer,
    sub: 'user-1',
    email: 'writer@example.com',
    exp: Math.floor(Date.now() / 1000) + 600,
    ...claims,
  };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = createSign('sha256').update(signingInput).sign(key);

  return `${signingInput}.${base64Url(signature)}`;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function sseResponse(events: readonly unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

export interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export function fakeFetch(
  answer: (request: RecordedRequest) => Response | Promise<Response>,
): FetchLike & { readonly requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const request: RecordedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === 'string' ? init.body : '',
    };
    requests.push(request);
    return await answer(request);
  }) as FetchLike;

  return Object.assign(fetchImpl, { requests });
}

export function memorySecretStorage(
  initial: Record<string, string> = {},
): StoryboardSecretStorageLike & {
  readonly values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));

  return {
    values,
    get: async (key) => values.get(key),
    store: async (key, value) => {
      values.set(key, value);
    },
    delete: async (key) => {
      values.delete(key);
    },
  };
}

export function createAuthorizationServer(
  options: { readonly scope?: string; readonly subject?: string } = {},
) {
  let issuedFor: { readonly clientId: string; readonly nonce: string } | undefined;
  const fetchImpl = fakeFetch((request) => {
    if (request.url.endsWith('/.well-known/openid-configuration')) {
      return jsonResponse({
        jwks_uri: 'https://auth.openai.com/jwks',
        revocation_endpoint: 'https://auth.openai.com/revoke',
      });
    }
    if (request.url.endsWith('/jwks')) {
      return jsonResponse({ keys: jwks });
    }
    if (request.url.endsWith('/revoke')) {
      return new Response('', { status: 200 });
    }
    if (request.url === chatGptTokenUrl) {
      const form = Object.fromEntries(new URLSearchParams(request.body));
      return jsonResponse({
        access_token: 'access-new',
        refresh_token: 'refresh-new',
        id_token: mintIdToken({
          aud: form.client_id,
          nonce: issuedFor?.nonce,
          sub: options.subject ?? 'user-1',
        }),
        expires_in: 3600,
        scope:
          options.scope ??
          'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
      });
    }
    return jsonResponse({ models: [] });
  });

  const browser = async (authorizationUrl: string, outcome: 'authorize' | 'deny' = 'authorize') => {
    const url = new URL(authorizationUrl);
    const clientId = url.searchParams.get('client_id') ?? '';
    const isRegistration = clientId === 'dynamic_agent_client';
    issuedFor = {
      clientId: isRegistration ? 'oaiapp_new' : clientId,
      nonce: url.searchParams.get('nonce') ?? '',
    };

    const callback = new URL(url.searchParams.get('redirect_uri') ?? '');
    callback.searchParams.set('state', url.searchParams.get('state') ?? '');
    if (outcome === 'deny') {
      callback.searchParams.set('error', 'access_denied');
    } else {
      callback.searchParams.set('code', 'code-1');
      if (isRegistration) {
        callback.searchParams.set('client_id', 'oaiapp_new');
      }
    }

    return (await globalThis.fetch(callback)).status;
  };

  return { fetchImpl, browser };
}
