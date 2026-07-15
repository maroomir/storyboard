import { type AiProviderId } from '../../shared/aiTypes';

export interface StoryboardSecretStorageChangeEvent {
  readonly key: string;
}

export interface StoryboardSecretStorageLike {
  readonly get: (key: string) => Thenable<string | undefined>;
  readonly store: (key: string, value: string) => Thenable<void>;
  readonly delete: (key: string) => Thenable<void>;
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

export function createApiKeySecretKey(providerId: AiProviderId): string {
  return `storyboard.apiKey.${providerId}`;
}
