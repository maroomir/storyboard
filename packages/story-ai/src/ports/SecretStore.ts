import { type AiProviderId, type DisposableHandle } from '@storyboard/story-model';
import { z } from 'zod';

export interface OAuthRegistration {
  readonly clientId: string;
  readonly subject: string;
  readonly email?: string;
}

export interface OAuthTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly idToken?: string;
  readonly expiresAt: string;
  readonly scopes: string[];
}

export interface OAuthConnection {
  readonly hostId: string;
  readonly registration?: OAuthRegistration;
  readonly tokens?: OAuthTokens;
}

const oauthRegistrationSchema: z.ZodType<OAuthRegistration> = z.object({
  clientId: z.string().min(1),
  subject: z.string().min(1),
  email: z.string().min(1).optional(),
});

const oauthTokensSchema: z.ZodType<OAuthTokens> = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  idToken: z.string().min(1).optional(),
  expiresAt: z.string().min(1),
  scopes: z.array(z.string()),
});

const oauthConnectionSchema: z.ZodType<OAuthConnection> = z.object({
  hostId: z.string().min(1),
  registration: oauthRegistrationSchema.optional(),
  tokens: oauthTokensSchema.optional(),
});

export interface StoryboardSecretStorageChangeEvent {
  readonly key: string;
}

export interface StoryboardSecretStorageLike {
  readonly get: (key: string) => PromiseLike<string | undefined>;
  readonly store: (key: string, value: string) => PromiseLike<void>;
  readonly delete: (key: string) => PromiseLike<void>;
  readonly onDidChange?: (
    listener: (event: StoryboardSecretStorageChangeEvent) => void,
  ) => DisposableHandle;
}

export class SecretStore {
  public constructor(private readonly secretStorage: StoryboardSecretStorageLike) {}

  public async setApiKey(providerId: AiProviderId, apiKey: string): Promise<void> {
    const normalizedApiKey: string = apiKey.trim();

    if (normalizedApiKey.length === 0) {
      await this.deleteApiKey(providerId);
      return;
    }

    await this.secretStorage.store(createApiKeySecretKey(providerId), normalizedApiKey);
  }

  public async getApiKey(providerId: AiProviderId): Promise<string | undefined> {
    return this.secretStorage.get(createApiKeySecretKey(providerId));
  }

  public async deleteApiKey(providerId: AiProviderId): Promise<void> {
    await this.secretStorage.delete(createApiKeySecretKey(providerId));
  }

  public async hasApiKey(providerId: AiProviderId): Promise<boolean> {
    return (await this.getApiKey(providerId)) !== undefined;
  }

  public async getOAuthConnection(providerId: AiProviderId): Promise<OAuthConnection | undefined> {
    const raw: string | undefined = await this.secretStorage.get(createOAuthSecretKey(providerId));

    if (raw === undefined) {
      return undefined;
    }

    try {
      return oauthConnectionSchema.parse(JSON.parse(raw));
    } catch {
      return undefined;
    }
  }

  public async setOAuthConnection(
    providerId: AiProviderId,
    connection: OAuthConnection,
  ): Promise<void> {
    await this.secretStorage.store(createOAuthSecretKey(providerId), JSON.stringify(connection));
  }

  public async deleteOAuthConnection(providerId: AiProviderId): Promise<void> {
    await this.secretStorage.delete(createOAuthSecretKey(providerId));
  }

  public async setNotionToken(token: string): Promise<void> {
    const normalizedToken: string = token.trim();

    if (normalizedToken.length === 0) {
      await this.secretStorage.delete(notionTokenSecretKey);
      return;
    }

    await this.secretStorage.store(notionTokenSecretKey, normalizedToken);
  }

  public async getNotionToken(): Promise<string | undefined> {
    return this.secretStorage.get(notionTokenSecretKey);
  }

  public onDidChangeApiKey(providerId: AiProviderId, listener: () => void): DisposableHandle {
    if (!this.secretStorage.onDidChange) {
      return { dispose: (): void => undefined };
    }

    const secretKey: string = createApiKeySecretKey(providerId);

    return this.secretStorage.onDidChange((event) => {
      if (event.key === secretKey) {
        listener();
      }
    });
  }
}

export const notionTokenSecretKey: string = 'storyboard.integration.notion';

export function createApiKeySecretKey(providerId: AiProviderId): string {
  return `storyboard.apiKey.${providerId}`;
}

export function createOAuthSecretKey(providerId: AiProviderId): string {
  return `storyboard.oauth.${providerId}`;
}
