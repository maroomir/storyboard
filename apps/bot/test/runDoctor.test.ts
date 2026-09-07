import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runDoctor } from '../src/app/runDoctor';

describe('runDoctor', () => {
  let home: string;
  let written: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'storyboard-doctor-'));
    previousHome = process.env.STORYBOARD_HOME;
    process.env.STORYBOARD_HOME = home;
    written = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      written += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (previousHome === undefined) {
      delete process.env.STORYBOARD_HOME;
    } else {
      process.env.STORYBOARD_HOME = previousHome;
    }
    rmSync(home, { recursive: true, force: true });
  });

  it('reports a missing config and points at setup instead of throwing', async () => {
    const code = await runDoctor();

    expect(code).toBe(1);
    expect(written).toContain(join(home, 'bot.json'));
    expect(written).toContain('storyboard-bot setup');
  });

  it('still reports the shared config when the bot config is missing', async () => {
    const code = await runDoctor();

    expect(code).toBe(1);
    expect(written).toContain(join(home, 'config.json'));
  });

  it('fails when the config file exists but is not valid JSON', async () => {
    writeFileSync(join(home, 'bot.json'), '{ not json');

    const code = await runDoctor();

    expect(code).toBe(1);
    expect(written).toContain('invalid-json');
    expect(written).not.toContain('storyboard-bot setup');
  });
});
