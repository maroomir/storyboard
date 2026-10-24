import { type AiProviderId } from '@storyboard/story-model';
import { z } from 'zod';

// What a browser login leaves behind. The registration (the issued client id and the account it is
// bound to) and this machine's host id outlive a sign-out, so a later login is a reauthorization of
// the same client; only the tokens are cleared.
const oauthRegistrationSchema = z.object({
  clientId: z.string().min(1),
  subject: z.string().min(1),
  email: z.string().min(1).optional(),
});

const oauthTokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  idToken: z.string().min(1).optional(),
  // ISO 8601, the instant the access token stops working.
  expiresAt: z.string().min(1),
  scopes: z.array(z.string()),
});

const oauthConnectionSchema = z.object({
  hostId: z.string().min(1),
  registration: oauthRegistrationSchema.optional(),
  tokens: oauthTokensSchema.optional(),
});

export type OAuthRegistration = z.infer<typeof oauthRegistrationSchema>;
export type OAuthTokens = z.infer<typeof oauthTokensSchema>;
export type OAuthConnection = z.infer<typeof oauthConnectionSchema>;

export interface StoryboardSecretStorageChangeEvent {
  readonly key: string;
}

export interface StoryboardSecretStorageLike {
  readonly get: (key: string) => PromiseLike<string | undefined>;
  readonly store: (key: string, value: string) => PromiseLike<void>;
  readonly delete: (key: string) => PromiseLike<void>;
  readonly onDidChange?: (listener: (event: StoryboardSecretStorageChangeEvent) => void) => {
    readonly dispose: () => void;
  };
}

export class SecretStore {
  public constructor(private readonly secretStorage: StoryboardSecretStorageLike) {}

  public async setApiKey(providerId: AiProviderId, apiKey: string): Promise<void> {
    const normalizedApiKey = apiKey.trim();

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

  // SECURITY: the whole connection — tokens included — lives in the same 0600 file as the API keys.
  // A record that no longer parses reads as «not connected»; the next login rewrites it.
  public async getOAuthConnection(providerId: AiProviderId): Promise<OAuthConnection | undefined> {
    const raw = await this.secretStorage.get(createOAuthSecretKey(providerId));

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
    const normalizedToken = token.trim();

    if (normalizedToken.length === 0) {
      await this.secretStorage.delete(notionTokenSecretKey);
      return;
    }

    await this.secretStorage.store(notionTokenSecretKey, normalizedToken);
  }

  public async getNotionToken(): Promise<string | undefined> {
    return this.secretStorage.get(notionTokenSecretKey);
  }

  public onDidChangeApiKey(
    providerId: AiProviderId,
    listener: () => void,
  ): { readonly dispose: () => void } {
    if (!this.secretStorage.onDidChange) {
      return { dispose: (): void => undefined };
    }

    const secretKey = createApiKeySecretKey(providerId);

    return this.secretStorage.onDidChange((event) => {
      if (event.key === secretKey) {
        listener();
      }
    });
  }
}

// The Notion integration token the note import reads pages with. It sits beside the API keys so a
// host has one secret file to protect.
export const notionTokenSecretKey = 'storyboard.integration.notion';

export function createApiKeySecretKey(providerId: AiProviderId): string {
  return `storyboard.apiKey.${providerId}`;
}

export function createOAuthSecretKey(providerId: AiProviderId): string {
  return `storyboard.oauth.${providerId}`;
}
