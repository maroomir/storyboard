import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';

import type { OAuthTokens } from '#ai/ports/SecretStore';
import { isJsonRecord, type JsonRecord } from '@storyboard/story-model';

export const chatGptAuthorizeUrl: string = 'https://auth.openai.com/api/accounts/authorize';
export const chatGptTokenUrl: string = 'https://auth.openai.com/api/accounts/oauth/token';
export const chatGptDiscoveryUrl: string =
  'https://auth.openai.com/.well-known/openid-configuration';
export const chatGptIssuer: string = 'https://auth.openai.com';
export const chatGptResource: string = 'https://api.openai.com/v1';
export const chatGptCallbackPath: string = '/auth/callback';
export const chatGptPreferredCallbackPort: number = 1455;

const dynamicRegistrationClientId: string = 'dynamic_agent_client';
const agentNameHint: string = 'Storyboard';
const planUsageScope: string = 'chatgpt.tokens.use.direct';
const requestedScopes: string[] = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'resource.invoke',
  planUsageScope,
];

export type ChatGptOAuthErrorCode =
  | 'access-denied'
  | 'state-mismatch'
  | 'registration-incomplete'
  | 'client-mismatch'
  | 'exchange-failed'
  | 'invalid-id-token'
  | 'plan-usage-not-granted'
  | 'refresh-rejected'
  | 'revocation-failed'
  | 'discovery-failed';

export class ChatGptOAuthError extends Error {
  public constructor(
    public readonly code: ChatGptOAuthErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ChatGptOAuthError';
  }
}

export type FetchLike = typeof globalThis.fetch;

function base64Url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

function decodeBase64UrlJson(segment: string): JsonRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    return isJsonRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function createHostId(): string {
  return `urn:uuid:${randomUUID()}`;
}

export function loopbackRedirectUri(port: number): string {
  return `http://127.0.0.1:${port}${chatGptCallbackPath}`;
}

export interface AuthorizationAttemptInput {
  readonly hostId: string;
  readonly redirectUri: string;
  readonly clientId?: string;
  readonly idTokenHint?: string;
  readonly loginHint?: string;
}

export interface AuthorizationAttempt {
  readonly url: string;
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
  readonly clientId: string | undefined;
}

export function createAuthorizationAttempt(input: AuthorizationAttemptInput): AuthorizationAttempt {
  const state: string = base64Url(randomBytes(24));
  const nonce: string = base64Url(randomBytes(24));
  const codeVerifier: string = base64Url(randomBytes(32));
  const codeChallenge: string = base64Url(createHash('sha256').update(codeVerifier).digest());
  const isRegistration: boolean = input.clientId === undefined;

  const url: URL = new URL(chatGptAuthorizeUrl);
  url.searchParams.set('client_id', input.clientId ?? dynamicRegistrationClientId);
  if (isRegistration) {
    url.searchParams.set('agent_name_hint', agentNameHint);
  }
  url.searchParams.set('ext_agent_host_id', input.hostId);
  if (input.idTokenHint !== undefined) {
    url.searchParams.set('id_token_hint', input.idTokenHint);
  }
  if (input.loginHint !== undefined) {
    url.searchParams.set('login_hint', input.loginHint);
  }
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', requestedScopes.join(' '));
  url.searchParams.set('resource', chatGptResource);
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', codeChallenge);

  return {
    url: url.toString(),
    state,
    nonce,
    codeVerifier,
    redirectUri: input.redirectUri,
    clientId: input.clientId,
  };
}

export interface AuthorizedCallback {
  readonly code: string;
  readonly clientId: string;
}

export function readAuthorizationCallback(
  query: URLSearchParams,
  attempt: AuthorizationAttempt,
): AuthorizedCallback {
  if (query.get('state') !== attempt.state) {
    throw new ChatGptOAuthError(
      'state-mismatch',
      '브라우저가 돌려준 로그인 응답이 이번 시도의 것이 아닙니다. 다시 로그인하세요.',
    );
  }

  const error: string | null = query.get('error');
  if (error !== null) {
    throw new ChatGptOAuthError(
      'access-denied',
      error === 'access_denied'
        ? '로그인을 취소했거나 ChatGPT 구독 사용을 허용하지 않았습니다.'
        : `로그인이 거부됐습니다: ${error}`,
    );
  }

  const code: string | null = query.get('code');
  if (code === null || code.length === 0) {
    throw new ChatGptOAuthError('exchange-failed', '브라우저가 인가 코드를 돌려주지 않았습니다.');
  }

  const callbackClientId: string | undefined = query.get('client_id') ?? undefined;

  if (attempt.clientId === undefined) {
    if (callbackClientId === undefined || callbackClientId === dynamicRegistrationClientId) {
      throw new ChatGptOAuthError(
        'registration-incomplete',
        '등록이 끝나지 않았습니다(발급된 client id 가 없음). 다시 로그인하세요.',
      );
    }
    return { code, clientId: callbackClientId };
  }

  if (callbackClientId !== undefined && callbackClientId !== attempt.clientId) {
    throw new ChatGptOAuthError(
      'client-mismatch',
      '브라우저가 돌려준 client id 가 저장된 등록과 다릅니다. 저장된 등록은 바꾸지 않았습니다.',
    );
  }

  return { code, clientId: attempt.clientId };
}

export interface TokenResponse {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly idToken: string | undefined;
  readonly expiresInSeconds: number;
  readonly scopes: readonly string[];
}

function readTokenResponse(body: unknown, failureCode: ChatGptOAuthErrorCode): TokenResponse {
  if (
    !isJsonRecord(body) ||
    typeof body.access_token !== 'string' ||
    typeof body.refresh_token !== 'string'
  ) {
    throw new ChatGptOAuthError(failureCode, '토큰 응답에 access_token·refresh_token 이 없습니다.');
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    idToken: typeof body.id_token === 'string' ? body.id_token : undefined,
    expiresInSeconds: typeof body.expires_in === 'number' ? body.expires_in : 3600,
    scopes: typeof body.scope === 'string' ? body.scope.split(' ').filter(Boolean) : [],
  };
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text: string = await response.text();

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function describeTokenFailure(status: number, body: unknown): string {
  const code: string | undefined =
    isJsonRecord(body) && typeof body.error === 'string' ? body.error : undefined;
  const description: string =
    isJsonRecord(body) && typeof body.error_description === 'string' ? body.error_description : '';

  return [`HTTP ${status}`, code, description].filter(Boolean).join(' · ');
}

async function postForm(
  fetchImpl: FetchLike,
  url: string,
  form: Readonly<Record<string, string>>,
): Promise<Response> {
  return await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
}

export async function exchangeAuthorizationCode(
  fetchImpl: FetchLike,
  input: {
    readonly clientId: string;
    readonly code: string;
    readonly codeVerifier: string;
    readonly redirectUri: string;
  },
): Promise<TokenResponse> {
  const response: Response = await postForm(fetchImpl, chatGptTokenUrl, {
    grant_type: 'authorization_code',
    client_id: input.clientId,
    code: input.code,
    code_verifier: input.codeVerifier,
    redirect_uri: input.redirectUri,
    resource: chatGptResource,
  });
  const body: unknown = await readJsonBody(response);

  if (!response.ok) {
    throw new ChatGptOAuthError(
      'exchange-failed',
      `인가 코드를 토큰으로 바꾸지 못했습니다 (${describeTokenFailure(response.status, body)}).`,
    );
  }

  return readTokenResponse(body, 'exchange-failed');
}

const unusableRefreshTokenCodes: Set<string> = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
]);

export async function refreshAccessToken(
  fetchImpl: FetchLike,
  input: { readonly clientId: string; readonly refreshToken: string },
): Promise<TokenResponse> {
  const response: Response = await postForm(fetchImpl, chatGptTokenUrl, {
    grant_type: 'refresh_token',
    client_id: input.clientId,
    refresh_token: input.refreshToken,
    resource: chatGptResource,
  });
  const body: unknown = await readJsonBody(response);

  if (!response.ok) {
    const code: string = isJsonRecord(body) && typeof body.error === 'string' ? body.error : '';
    const isUnusable: boolean = unusableRefreshTokenCodes.has(code) || response.status === 400;

    throw new ChatGptOAuthError(
      isUnusable ? 'refresh-rejected' : 'exchange-failed',
      `로그인 세션을 갱신하지 못했습니다 (${describeTokenFailure(response.status, body)}).`,
    );
  }

  return readTokenResponse(body, 'refresh-rejected');
}

export interface DiscoveryDocument {
  readonly jwksUri: string;
  readonly revocationEndpoint: string | undefined;
}

export async function fetchDiscoveryDocument(fetchImpl: FetchLike): Promise<DiscoveryDocument> {
  const response: Response = await fetchImpl(chatGptDiscoveryUrl);
  const body: unknown = await readJsonBody(response);

  if (!response.ok || !isJsonRecord(body) || typeof body.jwks_uri !== 'string') {
    throw new ChatGptOAuthError(
      'discovery-failed',
      `OpenAI 인증 서버의 설정 문서를 읽지 못했습니다 (HTTP ${response.status}).`,
    );
  }

  return {
    jwksUri: body.jwks_uri,
    revocationEndpoint:
      typeof body.revocation_endpoint === 'string' ? body.revocation_endpoint : undefined,
  };
}

export interface SigningKey {
  readonly kid?: string;
  readonly kty: string;
  readonly alg?: string;
  readonly [field: string]: unknown;
}

export async function fetchJsonWebKeys(
  fetchImpl: FetchLike,
  jwksUri: string,
): Promise<readonly SigningKey[]> {
  const response: Response = await fetchImpl(jwksUri);
  const body: unknown = await readJsonBody(response);

  if (!response.ok || !isJsonRecord(body) || !Array.isArray(body.keys)) {
    throw new ChatGptOAuthError(
      'discovery-failed',
      `OpenAI 의 서명 키 목록을 읽지 못했습니다 (HTTP ${response.status}).`,
    );
  }

  return body.keys.filter(isJsonRecord) as unknown as SigningKey[];
}

export async function revokeRefreshToken(
  fetchImpl: FetchLike,
  input: {
    readonly revocationEndpoint: string;
    readonly clientId: string;
    readonly refreshToken: string;
  },
): Promise<void> {
  const response: Response = await postForm(fetchImpl, input.revocationEndpoint, {
    token: input.refreshToken,
    token_type_hint: 'refresh_token',
    client_id: input.clientId,
  });

  if (!response.ok) {
    throw new ChatGptOAuthError(
      'revocation-failed',
      `로그인 세션을 서버에서 끝내지 못했습니다 (HTTP ${response.status}).`,
    );
  }
}

export interface IdTokenIdentity {
  readonly subject: string;
  readonly email: string | undefined;
}

interface SignatureAlgorithm {
  readonly hash: string;
  readonly dsaEncoding?: 'ieee-p1363';
}

const signatureAlgorithms: Readonly<Record<string, SignatureAlgorithm>> = {
  RS256: { hash: 'sha256' },
  RS384: { hash: 'sha384' },
  RS512: { hash: 'sha512' },
  ES256: { hash: 'sha256', dsaEncoding: 'ieee-p1363' },
  ES384: { hash: 'sha384', dsaEncoding: 'ieee-p1363' },
};

function invalidIdToken(reason: string): ChatGptOAuthError {
  return new ChatGptOAuthError('invalid-id-token', `ID 토큰을 검증하지 못했습니다: ${reason}`);
}

export function validateIdToken(
  idToken: string,
  expectation: {
    readonly clientId: string;
    readonly nonce: string;
    readonly keys: readonly SigningKey[];
    readonly now?: Date;
  },
): IdTokenIdentity {
  const [headerSegment, payloadSegment, signatureSegment, ...rest] = idToken.split('.');

  if (
    headerSegment === undefined ||
    payloadSegment === undefined ||
    signatureSegment === undefined ||
    rest.length > 0
  ) {
    throw invalidIdToken('형식이 JWS 가 아닙니다');
  }

  const header: JsonRecord | undefined = decodeBase64UrlJson(headerSegment);
  const payload: JsonRecord | undefined = decodeBase64UrlJson(payloadSegment);

  if (header === undefined || payload === undefined) {
    throw invalidIdToken('머리말이나 본문을 읽을 수 없습니다');
  }

  const algorithm: SignatureAlgorithm | undefined =
    typeof header.alg === 'string' ? signatureAlgorithms[header.alg] : undefined;
  if (algorithm === undefined) {
    throw invalidIdToken(`지원하지 않는 서명 알고리즘 ${String(header.alg)}`);
  }

  const key: SigningKey | undefined = expectation.keys.find(
    (candidate) => candidate.kid === header.kid,
  );
  if (key === undefined) {
    throw invalidIdToken(`서명 키 ${String(header.kid)} 를 찾을 수 없습니다`);
  }

  let isSignatureValid: boolean;
  try {
    isSignatureValid = verify(
      algorithm.hash,
      Buffer.from(`${headerSegment}.${payloadSegment}`),
      {
        key: createPublicKey({
          key: key as unknown as import('node:crypto').JsonWebKey,
          format: 'jwk',
        }),
        ...(algorithm.dsaEncoding === undefined ? {} : { dsaEncoding: algorithm.dsaEncoding }),
      },
      Buffer.from(signatureSegment, 'base64url'),
    );
  } catch (error) {
    throw new ChatGptOAuthError(
      'invalid-id-token',
      'ID 토큰을 검증하지 못했습니다: 서명 키를 쓸 수 없습니다',
      error,
    );
  }

  if (!isSignatureValid) {
    throw invalidIdToken('서명이 맞지 않습니다');
  }

  if (payload.iss !== chatGptIssuer) {
    throw invalidIdToken(`발급자가 ${String(payload.iss)} 입니다`);
  }

  const audiences: unknown[] = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(expectation.clientId)) {
    throw invalidIdToken('대상(aud)이 이 등록의 client id 가 아닙니다');
  }

  const nowSeconds: number = Math.floor((expectation.now ?? new Date()).getTime() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) {
    throw invalidIdToken('만료됐습니다');
  }

  if (payload.nonce !== expectation.nonce) {
    throw invalidIdToken('nonce 가 이번 시도의 것이 아닙니다');
  }

  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw invalidIdToken('계정 식별자(sub)가 없습니다');
  }

  return {
    subject: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
  };
}

export function hasPlanUsageScope(scopes: readonly string[]): boolean {
  return scopes.includes(planUsageScope);
}

export function tokensFromResponse(response: TokenResponse, now: Date = new Date()): OAuthTokens {
  return {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    ...(response.idToken === undefined ? {} : { idToken: response.idToken }),
    expiresAt: new Date(now.getTime() + response.expiresInSeconds * 1000).toISOString(),
    scopes: [...response.scopes],
  };
}

const refreshLeadMilliseconds: number = 5 * 60 * 1000;

export function shouldRefreshTokens(tokens: OAuthTokens, now: Date = new Date()): boolean {
  return new Date(tokens.expiresAt).getTime() - now.getTime() <= refreshLeadMilliseconds;
}
