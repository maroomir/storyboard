import { describe, expect, it, vi } from 'vitest';

import {
  restartStorygramAgent,
  STORYGRAM_LAUNCHD_LABEL,
} from '../../../../src/infrastructure/storygram/storygramAgent';

describe('restartStorygramAgent', () => {
  it('kickstarts the per-user launchd service', async () => {
    const execFileFn = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });

    const result = await restartStorygramAgent({
      platform: 'darwin',
      userId: 501,
      execFileFn,
    });

    expect(result).toEqual({ status: 'restarted' });
    expect(execFileFn).toHaveBeenCalledWith('launchctl', [
      'kickstart',
      '-k',
      `gui/501/${STORYGRAM_LAUNCHD_LABEL}`,
    ]);
  });

  it('does nothing outside macOS', async () => {
    const execFileFn = vi.fn();

    const result = await restartStorygramAgent({ platform: 'linux', execFileFn });

    expect(result).toEqual({ status: 'unsupported-platform' });
    expect(execFileFn).not.toHaveBeenCalled();
  });

  // Distinguishing "never installed" from "failed" matters: the fixes are different.
  it('reports an uninstalled agent instead of a generic failure', async () => {
    const execFileFn = vi
      .fn()
      .mockRejectedValue({ stderr: 'Could not find service "com.maroomir.storygram"' });

    const result = await restartStorygramAgent({ platform: 'darwin', userId: 501, execFileFn });

    expect(result).toEqual({ status: 'not-installed' });
  });

  it('surfaces the launchctl output on a genuine failure', async () => {
    const execFileFn = vi.fn().mockRejectedValue({ stderr: 'Operation not permitted' });

    const result = await restartStorygramAgent({ platform: 'darwin', userId: 501, execFileFn });

    expect(result).toMatchObject({ status: 'failed' });
    expect(result).toHaveProperty('detail', 'Operation not permitted');
  });
});
