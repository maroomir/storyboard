import type { AiGenerateRequest, AiGenerateResponse, AiProvider } from '#ai/contracts/aiTypes';
import type { AiProviderId } from '#ai/contracts/ai';

// A subscription CLI answers "usage limit" rather than a retryable error, so a long unattended run
// dies partway with half a manuscript written. These are the phrasings the CLI providers use when
// the *period* allowance is gone: claude-code's "usage limit", codex's "quota", and gemini-cli's
// "Usage limit reached" / "exhausted your daily quota" / RESOURCE_EXHAUSTED.
//
// NOTE: A per-minute throttle ("rate limit", "too many requests") is deliberately NOT here. It
// clears in seconds, and because the latch below is one-way, treating it as exhaustion would move
// the whole rest of a manuscript onto the other model over a momentary hiccup.
const usageLimitPattern = /usage limit|upgrade to pro|quota|exhausted|resource_exhausted/i;

export function isUsageLimitError(error: unknown): boolean {
  return usageLimitPattern.test(error instanceof Error ? error.message : String(error));
}

/**
 * Remembers that a provider ran out of allowance, across every provider instance built for it.
 *
 * The registry builds a fresh provider per call, so a latch owned by one `FallbackProvider` would
 * forget between calls and every later task would re-spawn the exhausted CLI just to be told no
 * again. One latch per provider id, held by the registry, is what makes the switch stick.
 */
export class UsageLimitLatch {
  private exhausted = false;

  public get isExhausted(): boolean {
    return this.exhausted;
  }

  public trip(): void {
    this.exhausted = true;
  }
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
  private readonly latch: UsageLimitLatch;

  public constructor(
    private readonly primary: AiProvider,
    private readonly fallback: AiProvider,
    private readonly onFallback?: (message: string) => void,
    latch?: UsageLimitLatch,
  ) {
    this.id = primary.id;
    this.displayName = `${primary.displayName} → ${fallback.displayName}`;
    this.latch = latch ?? new UsageLimitLatch();
  }

  public checkConnection(): Promise<boolean> {
    return this.primary.checkConnection();
  }

  public async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    if (this.latch.isExhausted) {
      return this.fallback.generate(request);
    }

    try {
      return await this.primary.generate(request);
    } catch (error) {
      if (!isUsageLimitError(error)) {
        throw error;
      }

      this.latch.trip();
      this.onFallback?.(
        `${this.primary.displayName} 사용 한도에 걸려 남은 호출을 ${this.fallback.displayName} 로 넘깁니다.`,
      );
      return this.fallback.generate(request);
    }
  }
}
