import { describe, expect, it, vi } from 'vitest';

import { DisposableStore } from '@/bootstrap/lifecycle/disposableStore';

describe('DisposableStore', () => {
  it('disposes registered resources in reverse order and is idempotent', () => {
    const calls: string[] = [];
    const first = { dispose: vi.fn((): void => calls.push('first')) };
    const second = { dispose: vi.fn((): void => calls.push('second')) };
    const store = new DisposableStore();

    store.add(first, second);
    store.dispose();
    store.dispose();

    expect(calls).toEqual(['second', 'first']);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).toHaveBeenCalledTimes(1);
  });
});
