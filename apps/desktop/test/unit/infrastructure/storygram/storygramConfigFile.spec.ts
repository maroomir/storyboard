import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_DASHBOARD_PORT,
  expandHome,
  readStorygramDashboardTarget,
  resolveStorygramPaths,
} from '../../../../src/infrastructure/storygram/storygramConfigFile';

describe('resolveStorygramPaths', () => {
  it('defaults to ~/.storygram', () => {
    const paths = resolveStorygramPaths({});

    expect(paths.home).toBe(join(homedir(), '.storygram'));
    expect(paths.configFile).toBe(join(homedir(), '.storygram', 'config.json'));
  });

  it('honors STORYGRAM_HOME with ~ expansion', () => {
    const paths = resolveStorygramPaths({ STORYGRAM_HOME: '~/alt-storygram' });

    expect(paths.home).toBe(join(homedir(), 'alt-storygram'));
  });
});

describe('expandHome', () => {
  it('expands ~ and ~/ but leaves other paths untouched', () => {
    expect(expandHome('~')).toBe(homedir());
    expect(expandHome('~/novel')).toBe(join(homedir(), 'novel'));
    expect(expandHome('/absolute/path')).toBe('/absolute/path');
  });
});

describe('readStorygramDashboardTarget', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'storygram-config-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('returns undefined when the config file is missing', async () => {
    const target = await readStorygramDashboardTarget(join(home, 'config.json'));

    expect(target).toBeUndefined();
  });

  it('reads dashboard enabled and port from the config', async () => {
    const configFile = join(home, 'config.json');
    writeFileSync(configFile, JSON.stringify({ dashboard: { enabled: false, port: 9000 } }));

    const target = await readStorygramDashboardTarget(configFile);

    expect(target).toEqual({ enabled: false, port: 9000 });
  });

  it('falls back to defaults when the dashboard section is absent', async () => {
    const configFile = join(home, 'config.json');
    writeFileSync(configFile, JSON.stringify({ telegram: { botToken: 'x' } }));

    const target = await readStorygramDashboardTarget(configFile);

    expect(target).toEqual({ enabled: true, port: DEFAULT_DASHBOARD_PORT });
  });

  it('treats an unparseable config as the default target', async () => {
    const configFile = join(home, 'config.json');
    writeFileSync(configFile, '{ broken json');

    const target = await readStorygramDashboardTarget(configFile);

    expect(target).toEqual({ enabled: true, port: DEFAULT_DASHBOARD_PORT });
  });
});
