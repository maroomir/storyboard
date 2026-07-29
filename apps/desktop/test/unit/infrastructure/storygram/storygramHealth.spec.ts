import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkStorygramHealth } from '../../../../src/infrastructure/storygram/storygramHealth';

describe('checkStorygramHealth', () => {
  let home: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'storygram-health-'));
    env = { STORYGRAM_HOME: home };
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const writeConfig = (config: unknown): void => {
    writeFileSync(join(home, 'config.json'), JSON.stringify(config));
  };

  it('reports unconfigured when no config file exists', async () => {
    const health = await checkStorygramHealth({ env });

    expect(health).toEqual({ status: 'unconfigured' });
  });

  it('reports dashboard-disabled without touching the network', async () => {
    writeConfig({ dashboard: { enabled: false, port: 9000 } });
    const fetchFn = vi.fn();

    const health = await checkStorygramHealth({ env, fetchFn });

    expect(health).toEqual({ status: 'dashboard-disabled' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('reports offline when the dashboard does not respond', async () => {
    writeConfig({ dashboard: { enabled: true, port: 9000 } });
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const health = await checkStorygramHealth({ env, fetchFn: fetchFn as unknown as typeof fetch });

    expect(health).toEqual({ status: 'offline', port: 9000 });
    expect(fetchFn).toHaveBeenCalledWith('http://127.0.0.1:9000/api/workspace', expect.anything());
  });

  it('reports offline on a non-ok response', async () => {
    writeConfig({ dashboard: { enabled: true, port: 9000 } });
    const fetchFn = vi.fn().mockResolvedValue({ ok: false });

    const health = await checkStorygramHealth({ env, fetchFn: fetchFn as unknown as typeof fetch });

    expect(health).toEqual({ status: 'offline', port: 9000 });
  });

  it('reports online with project name and sync state', async () => {
    writeConfig({ dashboard: { enabled: true, port: 9000 } });
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async (): Promise<unknown> => ({ name: 'my-novel', syncState: 'idle' }),
    });

    const health = await checkStorygramHealth({ env, fetchFn: fetchFn as unknown as typeof fetch });

    expect(health).toEqual({
      status: 'online',
      port: 9000,
      projectName: 'my-novel',
      syncState: 'idle',
    });
  });
});
