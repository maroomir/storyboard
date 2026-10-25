import type { IStoryboardLogger } from '#engine/ports/logger';
import { extractErrorMessage } from '@storyboard/story-model';

export interface IUseCase<TRequest, TResult> {
  execute(request: TRequest): Promise<TResult>;
}

export interface UseCaseFailure {
  readonly kind: 'failed';
  readonly ok: false;
  readonly message: string;
}

export function failureMessage(error: unknown): string {
  return extractErrorMessage(error);
}

export function failedResult(error: unknown): UseCaseFailure {
  return { kind: 'failed', ok: false, message: failureMessage(error) };
}

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
