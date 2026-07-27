import { AsyncLocalStorage } from 'node:async_hooks';

export interface JobRunContext {
  readonly jobId: number;
  readonly signal: AbortSignal;
}

// CLI providers cache their runner once at registry construction, so per-job cancellation cannot be
// injected through the provider factory. The executor instead publishes the running job's context
// here, and the shared runner (and the usage recorder) pick it up at call time — safe under
// concurrent jobs because the context follows the async call chain.
const activeJobContext = new AsyncLocalStorage<JobRunContext>();

export function runWithJobContext<T>(context: JobRunContext, run: () => Promise<T>): Promise<T> {
  return activeJobContext.run(context, run);
}

export function getActiveJobSignal(): AbortSignal | undefined {
  return activeJobContext.getStore()?.signal;
}

export function getActiveJobId(): number | undefined {
  return activeJobContext.getStore()?.jobId;
}
