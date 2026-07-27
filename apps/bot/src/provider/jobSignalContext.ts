import { AsyncLocalStorage } from 'node:async_hooks';

// CLI providers cache their runner once at registry construction, so per-job cancellation cannot be
// injected through the provider factory. The executor instead publishes the running job's abort
// signal here, and the shared runner picks it up at call time — safe under concurrent jobs because
// the context follows the async call chain.
const activeJobSignal = new AsyncLocalStorage<AbortSignal>();

export function runWithJobSignal<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  return activeJobSignal.run(signal, run);
}

export function getActiveJobSignal(): AbortSignal | undefined {
  return activeJobSignal.getStore();
}
