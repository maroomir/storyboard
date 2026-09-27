import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveStoryboardHomePaths } from '@storyboard/story-config';
import { describe, expect, it } from 'vitest';

import { DesktopApp } from '@/main/desktopApp';
import { createInvokeHandlers } from '@/main/invokeHandlers';
import { createIpcRouter } from '@/main/ipcRouter';
import { desktopEventNames } from '@/shared/ipcChannelNames';
import { invokeChannels, type DesktopEvents } from '@/shared/ipcContract';

const home = mkdtempSync(join(tmpdir(), 'storyboard-contract-home-'));
const app = new DesktopApp({
  homePaths: resolveStoryboardHomePaths({ STORYBOARD_HOME: home }),
  logFile: join(home, 'desktop.log'),
  version: '0.0.0-test',
  systemLocale: 'en-US',
  documentsDirectory: home,
  chooseDirectory: async () => undefined,
  emit: () => undefined,
  notify: () => undefined,
  installUpdate: () => undefined,
});
const router = createIpcRouter(createInvokeHandlers(app), app.logger, {
  invalidRequest: () => 'invalid',
  internal: (message) => message,
});


describe('IPC contract', () => {
  it('has a handler for every channel and no handler without a channel', () => {
    expect(Object.keys(createInvokeHandlers(app)).sort()).toEqual([...invokeChannels].sort());
  });

  // The preload forwards only the events on its list; one missing from it would never arrive.
  it('lets the preload forward every event main sends', () => {
    const events: Record<keyof DesktopEvents, true> = {
      'run.changed': true,
      'workspace.changed': true,
      'app.updateReady': true,
    };

    expect([...desktopEventNames].sort()).toEqual(Object.keys(events).sort());
  });

  it('rejects an unknown channel, a malformed envelope and an extra field', async () => {
    for (const message of [
      { channel: 'fs.readFile', request: { path: '/etc/passwd' } },
      'not an envelope',
      { channel: 'app.bootstrap', request: { sneaky: true } },
      { channel: 'settings.setValue', request: { key: 'x' } },
    ]) {
      const result = await router(message);
      expect(result.ok ? undefined : result.error.code).toBe('invalid-request');
    }
  });

  it('answers a workspace channel with no work open by saying so', async () => {
    const result = await router({ channel: 'workspace.overview', request: {} });

    expect(result.ok ? undefined : result.error.code).toBe('no-workspace');
    rmSync(home, { recursive: true, force: true });
  });
});
