import type { AiGenerateRequest, AiGenerateResponse, AiProvider } from '#ai/contracts/aiTypes';
import type { AiProviderId } from '#ai/contracts/ai';

// A subscription CLI answers "usage limit" rather than a retryable error, so a long unattended run
// dies partway with half a manuscript written. These are the phrasings the CLI providers use.
const usageLimitPattern = /usage limit|upgrade to pro|rate limit|quota|too many requests/i;

export function isUsageLimitError(error: unknown): boolean {
  return usageLimitPattern.test(error instanceof Error ? error.message : String(error));
}

/**
 * Runs `primary` until it reports a usage limit, then every remaining call goes to `fallback`.
 *
 * The switch is one-way on purpose: probing the exhausted provider again would spend a call to
 * learn what it already said. The run finishes with mixed-model output, which is the trade an
 * unattended run wants — a finished draft beats an aborted one.
 */
export class FallbackProvider implements AiProvider {
  public readonly id: AiProviderId;
  public readonly displayName: string;
  private exhausted = false;

  public constructor(
    private readonly primary: AiProvider,
    private readonly fallback: AiProvider,
    private readonly onFallback?: (message: string) => void,
  ) {
    this.id = primary.id;
    this.displayName = `${primary.displayName} → ${fallback.displayName}`;
  }

  public checkConnection(): Promise<boolean> {
    return this.primary.checkConnection();
  }

  public async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    if (this.exhausted) {
      return this.fallback.generate(request);
    }

    try {
      return await this.primary.generate(request);
    } catch (error) {
      if (!isUsageLimitError(error)) {
        throw error;
      }

      this.exhausted = true;
      this.onFallback?.(
        `${this.primary.displayName} 사용 한도에 걸려 남은 호출을 ${this.fallback.displayName} 로 넘깁니다.`,
      );
      return this.fallback.generate(request);
    }
  }
}
