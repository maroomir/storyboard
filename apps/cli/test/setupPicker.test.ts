import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCliContainer } from '../src/container';
import { runSetup } from '../src/commands/setup';

const prompt = vi.hoisted(() => ({ answer: '' }));

vi.mock('../src/commands/prompt', () => ({
  askLine: async () => prompt.answer,
  askSecret: async () => '',
}));

let home: string;
let workspace: string;
let pickerOutput: string;

function interactiveContainer(): ReturnType<typeof createCliContainer> {
  return createCliContainer({
    workspacePath: workspace,
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      show: () => undefined,
    },
    canPrompt: true,
    version: '0.0.0',
  });
}

async function runPicker(answer: string): Promise<Awaited<ReturnType<typeof runSetup>>> {
  prompt.answer = answer;
  return runSetup({
    container: interactiveContainer(),
    args: { path: [], flags: {}, positionals: [] },
  });
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'storyboard-cli-home-'));
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-cli-ws-'));
  vi.stubEnv('STORYBOARD_HOME', home);
  pickerOutput = '';
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    pickerOutput += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe('storyboard setup picker', () => {
  it('leaves the mock provider out of the list a writer picks from', async () => {
    const outcome = await runPicker('mock');

    expect(pickerOutput).not.toContain('mock');
    expect(outcome.ok).toBe(false);
  });

  it('keeps mock listed while it is the current provider', async () => {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ 'ai.provider.default': 'mock' }));

    await runPicker('');

    expect(pickerOutput).toContain('mock');
    expect(pickerOutput).toContain('(현재)');
  });
});
