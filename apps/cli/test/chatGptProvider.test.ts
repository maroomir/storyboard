import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AiProviderError,
  aiProviderIds,
  acceptsMaxTokens,
  acceptsTemperature,
  listAvailableProviderIds,
  requiresSubscriptionRiskNotice,
  type AiStreamChunk,
} from '@storyboard/story-model';
import {
  ChatGptOAuthError,
  ChatGptProvider,
  ConfigBridge,
  SecretStore,
  chatGptTokenUrl,
  computeCostUsd,
  createAiProviderRegistry,
  createAuthorizationAttempt,
  exchangeAuthorizationCode,
  loginChatGpt,
  logoutChatGpt,
  readAuthorizationCallback,
  refreshAccessToken,
  shouldRefreshTokens,
  toResponsesInput,
  tokensFromResponse,
  validateIdToken,
  type FetchLike,
  type OAuthConnection,
} from '@storyboard/story-ai';
import { createFileConfiguration } from '@storyboard/story-config';

import { commandCatalog } from '@/commands/catalog';

import {
  createAuthorizationServer,
  fakeFetch,
  jsonResponse,
  jwks,
  memorySecretStorage,
  mintIdToken,
  privateKey,
  signingKeyId,
  sseResponse,
} from './fixtures/chatGptAuthServer';

// The signing key the fake authorization server uses; the ID tokens the tests mint are signed with
// it and verified against its public JWK, exactly as the real flow verifies against OpenAI's JWKS.
const connectedAt = new Date('2026-10-24T09:00:00Z');

function connection(overrides: Partial<OAuthConnection> = {}): OAuthConnection {
  return {
    hostId: 'urn:uuid:host-1',
    registration: { clientId: 'oaiapp_1', subject: 'user-1', email: 'writer@example.com' },
    tokens: {
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: new Date(connectedAt.getTime() + 60 * 60 * 1000).toISOString(),
      scopes: ['openid', 'chatgpt.tokens.use.direct'],
    },
    ...overrides,
  };
}

const userRequest = {
  taskName: 'sceneDraft',
  messages: [
    { role: 'system', content: '너는 소설가다.' },
    { role: 'user', content: '비 오는 골목을 묘사해.' },
  ],
} as const;

function completedEvents(text: string): unknown[] {
  return [
    { type: 'response.created', response: { id: 'resp_1' } },
    ...[...text].map((delta) => ({ type: 'response.output_text.delta', delta })),
    {
      type: 'response.completed',
      response: {
        id: 'resp_1',
        usage: {
          input_tokens: 120,
          output_tokens: 30,
          input_tokens_details: { cached_tokens: 100 },
        },
      },
    },
  ];
}

function createProvider(
  fetchImpl: FetchLike,
  options: { readonly connection?: OAuthConnection; readonly now?: () => Date } = {},
): { readonly provider: ChatGptProvider; readonly saved: OAuthConnection[] } {
  const saved: OAuthConnection[] = [];
  const provider = new ChatGptProvider({
    model: 'gpt-6-sol',
    connection: options.connection ?? connection(),
    saveConnection: async (next) => {
      saved.push(next);
    },
    fetch: fetchImpl,
    now: options.now ?? ((): Date => connectedAt),
  });

  return { provider, saved };
}

async function expectProviderError(
  promise: Promise<unknown>,
  code: string,
): Promise<AiProviderError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );

  expect(error).toBeInstanceOf(AiProviderError);
  expect((error as AiProviderError).code).toBe(code);
  return error as AiProviderError;
}

function expectOAuthError(action: () => unknown, code: string): ChatGptOAuthError {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(ChatGptOAuthError);
  expect((caught as ChatGptOAuthError).code).toBe(code);
  return caught as ChatGptOAuthError;
}

describe('the ChatGPT plan provider: the catalog row', () => {
  it('is hidden, unpriced and takes no risk notice', () => {
    expect(aiProviderIds).toContain('chatgpt');
    expect(listAvailableProviderIds()).not.toContain('chatgpt');
    expect(listAvailableProviderIds(['chatgpt'])).toContain('chatgpt');
    expect(requiresSubscriptionRiskNotice('chatgpt')).toBe(false);
    expect(requiresSubscriptionRiskNotice('claude-code')).toBe(true);
    expect(
      computeCostUsd({
        providerId: 'chatgpt',
        model: 'gpt-6-sol',
        usage: { inputTokens: 1000, outputTokens: 1000 },
      }),
    ).toBeUndefined();
  });

  it('declines the sampling knobs the preview rejects', () => {
    expect(acceptsTemperature('chatgpt', 'gpt-6-sol')).toBe(false);
    expect(acceptsMaxTokens('chatgpt', 'gpt-6-sol')).toBe(false);
    expect(acceptsMaxTokens('openai', 'gpt-6-sol')).toBe(true);
    expect(acceptsMaxTokens('ollama', 'anything')).toBe(true);
  });

  it('never appears in help or the catalog of flags', () => {
    expect(JSON.stringify(commandCatalog)).not.toMatch(/chatgpt|구독/);
  });
});

describe('the ChatGPT plan provider: the authorization request', () => {
  it('registers a new client with the host id and PKCE on the first login', () => {
    const attempt = createAuthorizationAttempt({
      hostId: 'urn:uuid:host-1',
      redirectUri: 'http://127.0.0.1:1455/auth/callback',
    });
    const url = new URL(attempt.url);

    expect(url.origin + url.pathname).toBe('https://auth.openai.com/api/accounts/authorize');
    expect(url.searchParams.get('client_id')).toBe('dynamic_agent_client');
    expect(url.searchParams.get('agent_name_hint')).toBe('Storyboard');
    expect(url.searchParams.get('ext_agent_host_id')).toBe('urn:uuid:host-1');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:1455/auth/callback');
    expect(url.searchParams.get('scope')).toBe(
      'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
    );
    expect(url.searchParams.get('resource')).toBe('https://api.openai.com/v1');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe(attempt.state);
    expect(url.searchParams.get('nonce')).toBe(attempt.nonce);
    expect(attempt.codeVerifier.length).toBeGreaterThan(40);
    expect(attempt.clientId).toBeUndefined();
  });

  it('reauthorizes a saved client without the name hint and with the account hints', () => {
    const attempt = createAuthorizationAttempt({
      hostId: 'urn:uuid:host-1',
      redirectUri: 'http://127.0.0.1:54321/auth/callback',
      clientId: 'oaiapp_1',
      idTokenHint: 'old-id-token',
      loginHint: 'writer@example.com',
    });
    const url = new URL(attempt.url);

    expect(url.searchParams.get('client_id')).toBe('oaiapp_1');
    expect(url.searchParams.has('agent_name_hint')).toBe(false);
    expect(url.searchParams.get('id_token_hint')).toBe('old-id-token');
    expect(url.searchParams.get('login_hint')).toBe('writer@example.com');
  });

  it('reads the callback: state first, then the error, then the issued client id', () => {
    const registration = createAuthorizationAttempt({
      hostId: 'h',
      redirectUri: 'http://127.0.0.1:1/auth/callback',
    });
    const reauthorization = { ...registration, clientId: 'oaiapp_1' };
    const query = (fields: Record<string, string>): URLSearchParams =>
      new URLSearchParams({ state: registration.state, ...fields });

    expectOAuthError(
      () =>
        readAuthorizationCallback(new URLSearchParams({ state: 'other', code: 'c' }), registration),
      'state-mismatch',
    );
    expectOAuthError(
      () => readAuthorizationCallback(query({ error: 'access_denied' }), registration),
      'access-denied',
    );
    expectOAuthError(
      () => readAuthorizationCallback(query({ code: 'c' }), registration),
      'registration-incomplete',
    );
    expectOAuthError(
      () =>
        readAuthorizationCallback(
          query({ code: 'c', client_id: 'dynamic_agent_client' }),
          registration,
        ),
      'registration-incomplete',
    );
    expect(
      readAuthorizationCallback(query({ code: 'c', client_id: 'oaiapp_9' }), registration),
    ).toEqual({
      code: 'c',
      clientId: 'oaiapp_9',
    });

    expect(readAuthorizationCallback(query({ code: 'c' }), reauthorization)).toEqual({
      code: 'c',
      clientId: 'oaiapp_1',
    });
    expectOAuthError(
      () => readAuthorizationCallback(query({ code: 'c', client_id: 'oaiapp_2' }), reauthorization),
      'client-mismatch',
    );
  });

  it('exchanges the code as a form post with the same redirect uri and no secret', async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse({
        access_token: 'a',
        refresh_token: 'r',
        id_token: 'i',
        expires_in: 3600,
        scope: 'openid chatgpt.tokens.use.direct',
      }),
    );

    const response = await exchangeAuthorizationCode(fetchImpl, {
      clientId: 'oaiapp_1',
      code: 'code-1',
      codeVerifier: 'verifier',
      redirectUri: 'http://127.0.0.1:1455/auth/callback',
    });
    const [request] = fetchImpl.requests;

    expect(request?.url).toBe(chatGptTokenUrl);
    expect(request?.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(request?.body))).toEqual({
      grant_type: 'authorization_code',
      client_id: 'oaiapp_1',
      code: 'code-1',
      code_verifier: 'verifier',
      redirect_uri: 'http://127.0.0.1:1455/auth/callback',
      resource: 'https://api.openai.com/v1',
    });
    expect(response).toEqual({
      accessToken: 'a',
      refreshToken: 'r',
      idToken: 'i',
      expiresInSeconds: 3600,
      scopes: ['openid', 'chatgpt.tokens.use.direct'],
    });
  });

  it('says a spent refresh token is spent', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ error: 'refresh_token_reused' }, 400));

    const error = await refreshAccessToken(fetchImpl, { clientId: 'c', refreshToken: 'r' }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ChatGptOAuthError);
    expect((error as ChatGptOAuthError).code).toBe('refresh-rejected');
    expect(Object.fromEntries(new URLSearchParams(fetchImpl.requests[0]?.body))).toMatchObject({
      grant_type: 'refresh_token',
      client_id: 'c',
      refresh_token: 'r',
    });
  });

  it('turns a token response into a dated token set and refreshes five minutes early', () => {
    const tokens = tokensFromResponse(
      {
        accessToken: 'a',
        refreshToken: 'r',
        idToken: undefined,
        expiresInSeconds: 3600,
        scopes: [],
      },
      connectedAt,
    );

    expect(tokens.expiresAt).toBe('2026-10-24T10:00:00.000Z');
    expect(shouldRefreshTokens(tokens, connectedAt)).toBe(false);
    expect(shouldRefreshTokens(tokens, new Date('2026-10-24T09:56:00Z'))).toBe(true);
  });
});

describe('the ChatGPT plan provider: the ID token', () => {
  const expectation = { clientId: 'oaiapp_1', nonce: 'nonce-1', keys: jwks };

  it('accepts a token signed by a published key for this client and attempt', () => {
    expect(
      validateIdToken(mintIdToken({ aud: 'oaiapp_1', nonce: 'nonce-1' }), expectation),
    ).toEqual({ subject: 'user-1', email: 'writer@example.com' });
  });

  it.each([
    ['another audience', { aud: 'oaiapp_2', nonce: 'nonce-1' }],
    ['another nonce', { aud: 'oaiapp_1', nonce: 'nonce-2' }],
    ['an expired token', { aud: 'oaiapp_1', nonce: 'nonce-1', exp: 1 }],
    ['another issuer', { aud: 'oaiapp_1', nonce: 'nonce-1', iss: 'https://evil.example' }],
  ])('rejects %s', (_label, claims) => {
    expectOAuthError(() => validateIdToken(mintIdToken(claims), expectation), 'invalid-id-token');
  });

  it('rejects a token signed by another key or naming an unknown key', () => {
    const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;

    expectOAuthError(
      () =>
        validateIdToken(mintIdToken({ aud: 'oaiapp_1', nonce: 'nonce-1' }, otherKey), expectation),
      'invalid-id-token',
    );
    expectOAuthError(
      () =>
        validateIdToken(
          mintIdToken({ aud: 'oaiapp_1', nonce: 'nonce-1' }, privateKey, {
            alg: 'RS256',
            kid: 'nope',
          }),
          expectation,
        ),
      'invalid-id-token',
    );
    expectOAuthError(
      () =>
        validateIdToken(
          mintIdToken({ aud: 'oaiapp_1', nonce: 'nonce-1' }, privateKey, {
            alg: 'none',
            kid: signingKeyId,
          }),
          expectation,
        ),
      'invalid-id-token',
    );
  });
});

describe('the ChatGPT plan provider: the call', () => {
  it('sends the context as instructions and input, no sampling knobs, and the bearer token', async () => {
    const fetchImpl = fakeFetch(() => sseResponse(completedEvents('빗물이 흘렀다.')));
    const { provider } = createProvider(fetchImpl);

    const response = await provider.generate({
      ...userRequest,
      temperature: 0.7,
      maxTokens: 4000,
      reasoningEffort: 'low',
    });
    const [request] = fetchImpl.requests;
    const body = JSON.parse(request?.body ?? '{}') as Record<string, unknown>;

    expect(request?.url).toBe('https://api.openai.com/v1/responses');
    expect(request?.method).toBe('POST');
    expect(request?.headers.authorization).toBe('Bearer access-1');
    expect(body).toEqual({
      model: 'gpt-6-sol',
      instructions: '너는 소설가다.',
      input: [{ role: 'user', content: '비 오는 골목을 묘사해.' }],
      store: false,
      stream: true,
      reasoning: { effort: 'low' },
    });
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('max_output_tokens');
    expect(response).toEqual({
      providerId: 'chatgpt',
      model: 'gpt-6-sol',
      text: '빗물이 흘렀다.',
      usage: { inputTokens: 120, outputTokens: 30, cacheReadInputTokens: 100 },
    });
  });

  it('writes a conversation as input items and joins several system messages', () => {
    expect(
      toResponsesInput([
        { role: 'system', content: '하나' },
        { role: 'user', content: '안녕' },
        { role: 'assistant', content: '네' },
        { role: 'system', content: '둘' },
      ]),
    ).toEqual({
      instructions: '하나\n\n둘',
      input: [
        { role: 'user', content: '안녕' },
        { role: 'assistant', content: '네' },
      ],
    });
  });

  it('streams the deltas as they arrive and ends with the full response', async () => {
    const fetchImpl = fakeFetch(() => sseResponse(completedEvents('빗물')));
    const { provider } = createProvider(fetchImpl);
    const chunks: AiStreamChunk[] = [];

    for await (const chunk of provider.generateStream(userRequest)) {
      chunks.push(chunk);
    }

    expect(chunks.map((chunk) => (chunk.type === 'text-delta' ? chunk.delta : 'done'))).toEqual([
      '빗',
      '물',
      'done',
    ]);
  });

  it('marks a response the server left incomplete as truncated', async () => {
    const fetchImpl = fakeFetch(() =>
      sseResponse([
        { type: 'response.output_text.delta', delta: '끊긴 글' },
        {
          type: 'response.incomplete',
          response: { incomplete_details: { reason: 'content_filter' } },
        },
      ]),
    );
    const { provider } = createProvider(fetchImpl);

    const response = await provider.generate(userRequest);

    expect(response.text).toBe('끊긴 글');
    expect(response.isTruncated).toBe(true);
  });

  it('says the plan limit was reached when the stream fails with the limit code', async () => {
    const fetchImpl = fakeFetch(() =>
      sseResponse([
        { type: 'response.output_text.delta', delta: '빗' },
        {
          type: 'response.failed',
          response: {
            error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'limit' },
          },
        },
      ]),
    );
    const { provider } = createProvider(fetchImpl);

    const error = await expectProviderError(provider.generate(userRequest), 'usage-limit');

    expect(error.message).toContain('https://chatgpt.com/settings/usage');
  });

  it('says the plan limit was reached on a 429 before the stream opens', async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse({ error: { code: 'subscription_sharing_usage_limit_exceeded' } }, 429),
    );
    const { provider } = createProvider(fetchImpl);

    await expectProviderError(provider.generate(userRequest), 'usage-limit');
  });

  it('asks for a new login on a 401', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ detail: 'not admitted' }, 401));
    const { provider } = createProvider(fetchImpl);

    const error = await expectProviderError(provider.generate(userRequest), 'login-required');

    expect(error.message).toContain('storyboard login chatgpt');
  });

  it('keeps the server’s own words for any other failure', async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse(
        {
          error: {
            code: 'subscription_sharing_unsupported_capability',
            message: 'tools',
            param: 'tools',
          },
        },
        400,
      ),
    );
    const { provider } = createProvider(fetchImpl);

    const error = await expectProviderError(provider.generate(userRequest), 'generation-failed');

    expect(error.message).toContain('HTTP 400');
    expect(error.message).toContain('subscription_sharing_unsupported_capability');
  });

  it('fails when the stream ends without response.completed', async () => {
    const fetchImpl = fakeFetch(() =>
      sseResponse([{ type: 'response.output_text.delta', delta: '빗' }]),
    );
    const { provider } = createProvider(fetchImpl);

    await expectProviderError(provider.generate(userRequest), 'generation-failed');
  });

  it('refuses to be built without a login and says how to get one', () => {
    let caught: unknown;
    try {
      new ChatGptProvider({
        model: 'gpt-6-sol',
        connection: { hostId: 'urn:uuid:host-1' },
        saveConnection: async () => undefined,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AiProviderError);
    expect((caught as AiProviderError).code).toBe('login-required');
    expect((caught as AiProviderError).message).toContain('storyboard login chatgpt');
  });

  it('refreshes a token about to expire, once for concurrent calls, and saves the rotation', async () => {
    const fetchImpl = fakeFetch((request) =>
      request.url === chatGptTokenUrl
        ? jsonResponse({
            access_token: 'access-2',
            refresh_token: 'refresh-2',
            expires_in: 3600,
            scope: 'openid',
          })
        : sseResponse(completedEvents('글')),
    );
    const nearExpiry = new Date('2026-10-24T09:57:00Z');
    const { provider, saved } = createProvider(fetchImpl, { now: () => nearExpiry });

    await Promise.all([provider.generate(userRequest), provider.generate(userRequest)]);

    const refreshes = fetchImpl.requests.filter((request) => request.url === chatGptTokenUrl);
    const calls = fetchImpl.requests.filter((request) => request.url.endsWith('/responses'));

    expect(refreshes).toHaveLength(1);
    expect(calls.map((request) => request.headers.authorization)).toEqual([
      'Bearer access-2',
      'Bearer access-2',
    ]);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.tokens).toMatchObject({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      expiresAt: '2026-10-24T10:57:00.000Z',
    });
  });

  it('clears a spent refresh token, keeps the registration and asks for a new login', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ error: 'invalid_grant' }, 400));
    const { provider, saved } = createProvider(fetchImpl, {
      now: () => new Date('2026-10-24T09:58:00Z'),
    });

    await expectProviderError(provider.generate(userRequest), 'login-required');

    expect(saved).toEqual([
      {
        hostId: 'urn:uuid:host-1',
        registration: { clientId: 'oaiapp_1', subject: 'user-1', email: 'writer@example.com' },
      },
    ]);
  });

  it('lists the models the account may call, keeping the server’s order', async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse({
        models: [
          { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol', visibility: 'list' },
          { slug: 'gpt-6-sol', display_name: 'GPT-6 Sol', visibility: 'list' },
          { slug: 'gpt-hidden', display_name: 'Hidden', visibility: 'hidden' },
        ],
      }),
    );
    const { provider } = createProvider(fetchImpl);

    expect(await provider.listModels()).toEqual([
      { slug: 'gpt-6.1-sol', displayName: 'GPT-6.1 Sol' },
      { slug: 'gpt-6-sol', displayName: 'GPT-6 Sol' },
    ]);
    expect(fetchImpl.requests[0]?.url).toBe('https://api.openai.com/v1/models');
    expect(await provider.checkConnection()).toBe(true);
  });
});

describe('the ChatGPT plan provider: the registry gate', () => {
  function createRegistry(
    home: Record<string, unknown>,
    fetchImpl: FetchLike,
    warnings: string[] = [],
    secretStorage = memorySecretStorage({
      'storyboard.oauth.chatgpt': JSON.stringify(connection()),
    }),
  ) {
    const directory = mkdtempSync(join(tmpdir(), 'storyboard-chatgpt-'));
    const userConfigFile = join(directory, 'config.json');
    writeFileSync(userConfigFile, JSON.stringify(home));
    const configuration = createFileConfiguration({ userConfigFile });

    return createAiProviderRegistry({
      configBridge: new ConfigBridge({ getConfiguration: () => configuration }),
      secretStore: new SecretStore(secretStorage),
      createChatGptFetch: () => fetchImpl,
      onRiskWarning: (message) => warnings.push(message),
    });
  }

  it('refuses it as an unknown provider while the switch is off', async () => {
    const fetchImpl = fakeFetch(() => sseResponse(completedEvents('글')));
    const registry = createRegistry({}, fetchImpl);

    const error = await expectProviderError(
      registry.generateWithProvider('chatgpt', userRequest),
      'provider-not-enabled',
    );

    expect(error.message).toBe('알 수 없는 프로바이더: chatgpt');
    expect(fetchImpl.requests).toHaveLength(0);
  });

  it('runs once switched on, with no risk notice to accept, and warns of the preview once', async () => {
    const warnings: string[] = [];
    const fetchImpl = fakeFetch(() => sseResponse(completedEvents('글')));
    const registry = createRegistry({ 'providers.chatgpt.enabled': true }, fetchImpl, warnings);

    await registry.generateWithProvider('chatgpt', userRequest);
    const response = await registry.generateWithProvider('chatgpt', userRequest);

    expect(response.text).toBe('글');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('미리보기');
    expect(warnings[0]).toContain('실행 예산');
  });

  it('reports the login as the credential in the provider list', async () => {
    const fetchImpl = fakeFetch(() => sseResponse([]));
    const connected = createRegistry({ 'providers.chatgpt.enabled': true }, fetchImpl);
    const signedOut = createRegistry(
      { 'providers.chatgpt.enabled': true },
      fetchImpl,
      [],
      memorySecretStorage(),
    );

    const find = async (registry: typeof connected) =>
      (await registry.listProviders()).find((status) => status.providerId === 'chatgpt');

    expect((await find(connected))?.hasApiKey).toBe(true);
    expect((await find(signedOut))?.hasApiKey).toBe(false);
  });
});

describe('the ChatGPT plan provider: the login', () => {
  it('registers a client, validates the account and stores the connection on the first login', async () => {
    const { fetchImpl, browser } = createAuthorizationServer();
    const secretStorage = memorySecretStorage();
    const secretStore = new SecretStore(secretStorage);
    const shownUrls: { url: string; wasOpened: boolean }[] = [];

    const result = await loginChatGpt({
      secretStore,
      fetch: fetchImpl,
      preferredPort: 0,
      openBrowser: async (url) => {
        void browser(url);
        return true;
      },
      onAuthorizationUrl: (url, wasOpened) => shownUrls.push({ url, wasOpened }),
    });

    expect(result).toEqual({ accountLabel: 'writer@example.com', isNewRegistration: true });
    expect(shownUrls).toHaveLength(1);
    expect(shownUrls[0]?.wasOpened).toBe(true);
    expect(new URL(shownUrls[0]?.url ?? '').searchParams.get('redirect_uri')).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/,
    );

    const stored = await secretStore.getOAuthConnection('chatgpt');
    expect(stored?.hostId).toMatch(/^urn:uuid:/);
    expect(stored?.registration).toEqual({
      clientId: 'oaiapp_new',
      subject: 'user-1',
      email: 'writer@example.com',
    });
    expect(stored?.tokens).toMatchObject({
      accessToken: 'access-new',
      refreshToken: 'refresh-new',
    });
    const lifetimeMs = new Date(stored?.tokens?.expiresAt ?? 0).getTime() - Date.now();
    expect(lifetimeMs).toBeGreaterThan(59 * 60 * 1000);
    expect(lifetimeMs).toBeLessThanOrEqual(60 * 60 * 1000);
    expect(stored?.tokens?.scopes).toContain('chatgpt.tokens.use.direct');

    const exchange = fetchImpl.requests.find((request) => request.url === chatGptTokenUrl);
    expect(Object.fromEntries(new URLSearchParams(exchange?.body))).toMatchObject({
      grant_type: 'authorization_code',
      client_id: 'oaiapp_new',
      code: 'code-1',
    });
  });

  it('reauthorizes a saved registration with its client id and keeps the host id', async () => {
    const { fetchImpl, browser } = createAuthorizationServer();
    const secretStore = new SecretStore(
      memorySecretStorage({
        'storyboard.oauth.chatgpt': JSON.stringify({
          hostId: 'urn:uuid:host-1',
          registration: { clientId: 'oaiapp_1', subject: 'user-1', email: 'writer@example.com' },
        }),
      }),
    );
    let authorizationUrl = '';

    const result = await loginChatGpt({
      secretStore,
      fetch: fetchImpl,
      preferredPort: 0,
      openBrowser: async (url) => {
        authorizationUrl = url;
        void browser(url);
        return false;
      },
      onAuthorizationUrl: () => undefined,
    });

    expect(result.isNewRegistration).toBe(false);
    expect(new URL(authorizationUrl).searchParams.get('client_id')).toBe('oaiapp_1');
    expect(new URL(authorizationUrl).searchParams.get('login_hint')).toBe('writer@example.com');
    expect((await secretStore.getOAuthConnection('chatgpt'))?.hostId).toBe('urn:uuid:host-1');
  });

  it('stops without exchanging anything when the person declines', async () => {
    const { fetchImpl, browser } = createAuthorizationServer();
    const secretStore = new SecretStore(memorySecretStorage());

    const error = await loginChatGpt({
      secretStore,
      fetch: fetchImpl,
      preferredPort: 0,
      openBrowser: async (url) => {
        void browser(url, 'deny');
        return true;
      },
      onAuthorizationUrl: () => undefined,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ChatGptOAuthError);
    expect((error as ChatGptOAuthError).code).toBe('access-denied');
    expect(fetchImpl.requests.filter((request) => request.url === chatGptTokenUrl)).toHaveLength(0);
    expect(await secretStore.getOAuthConnection('chatgpt')).toBeUndefined();
  });

  it('refuses a login that did not grant plan usage and stores nothing', async () => {
    const { fetchImpl, browser } = createAuthorizationServer({ scope: 'openid profile email' });
    const secretStore = new SecretStore(memorySecretStorage());

    const error = await loginChatGpt({
      secretStore,
      fetch: fetchImpl,
      preferredPort: 0,
      openBrowser: async (url) => {
        void browser(url);
        return true;
      },
      onAuthorizationUrl: () => undefined,
    }).catch((caught: unknown) => caught);

    expect((error as ChatGptOAuthError).code).toBe('plan-usage-not-granted');
    expect(await secretStore.getOAuthConnection('chatgpt')).toBeUndefined();
  });

  it('refuses to rebind a saved registration to another account', async () => {
    const { fetchImpl, browser } = createAuthorizationServer({ subject: 'user-2' });
    const secretStore = new SecretStore(
      memorySecretStorage({
        'storyboard.oauth.chatgpt': JSON.stringify({
          hostId: 'urn:uuid:host-1',
          registration: { clientId: 'oaiapp_1', subject: 'user-1' },
        }),
      }),
    );

    const error = await loginChatGpt({
      secretStore,
      fetch: fetchImpl,
      preferredPort: 0,
      openBrowser: async (url) => {
        void browser(url);
        return true;
      },
      onAuthorizationUrl: () => undefined,
    }).catch((caught: unknown) => caught);

    expect((error as ChatGptOAuthError).code).toBe('client-mismatch');
  });

  it('gives up after the time limit when the browser never comes back', async () => {
    const { fetchImpl } = createAuthorizationServer();

    const error = await loginChatGpt({
      secretStore: new SecretStore(memorySecretStorage()),
      fetch: fetchImpl,
      preferredPort: 0,
      timeoutMs: 20,
      openBrowser: async () => false,
      onAuthorizationUrl: () => undefined,
    }).catch((caught: unknown) => caught);

    expect((error as ChatGptOAuthError).code).toBe('access-denied');
    expect((error as ChatGptOAuthError).message).toContain('제한 시간');
  });

  it('logs out by revoking the session and keeping the registration for the next login', async () => {
    const { fetchImpl } = createAuthorizationServer();
    const secretStore = new SecretStore(
      memorySecretStorage({ 'storyboard.oauth.chatgpt': JSON.stringify(connection()) }),
    );

    const result = await logoutChatGpt({ secretStore, fetch: fetchImpl });

    expect(result).toEqual({ wasConnected: true, isRevoked: true });
    const revocation = fetchImpl.requests.find((request) => request.url.endsWith('/revoke'));
    expect(Object.fromEntries(new URLSearchParams(revocation?.body))).toEqual({
      token: 'refresh-1',
      token_type_hint: 'refresh_token',
      client_id: 'oaiapp_1',
    });
    expect(await secretStore.getOAuthConnection('chatgpt')).toEqual({
      hostId: 'urn:uuid:host-1',
      registration: { clientId: 'oaiapp_1', subject: 'user-1', email: 'writer@example.com' },
    });
    expect(await logoutChatGpt({ secretStore, fetch: fetchImpl })).toEqual({
      wasConnected: false,
      isRevoked: false,
    });
  });
});
