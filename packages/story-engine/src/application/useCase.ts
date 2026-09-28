import type { IStoryboardLogger } from '#engine/ports/logger';

// Every use case is one verb: a request object in, a result union out. Expected failures come back
// as `{ ok: false, kind, … }` so a caller branches on `ok`; only programmer errors escape as throws.
export interface IUseCase<TRequest, TResult> {
  execute(request: TRequest): Promise<TResult>;
}

export interface UseCaseFailure {
  readonly kind: 'failed';
  readonly ok: false;
  readonly message: string;
}

export function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function failedResult(error: unknown): UseCaseFailure {
  return { kind: 'failed', ok: false, message: failureMessage(error) };
}

// The one place a use case's unexpected throw becomes a `failed` result: logged under the use
// case's own label, then returned so the caller never has to catch.
export async function runUseCase<TResult>(
  logger: IStoryboardLogger,
  label: string,
  run: () => Promise<TResult>,
): Promise<TResult | UseCaseFailure> {
  try {
    return await run();
  } catch (error) {
    logger.error(label, error);
    return failedResult(error);
  }
}
