import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseSimConfig, readSimConfig, simConfigFileName } from '@storyboard/story-sim';

import type { ParsedArguments } from '../src/cliArguments';
import { commands, findCommand } from '../src/commands/index';
import { createCliContainer } from '../src/container';

let home: string;
let track: string;

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  show: () => undefined,
};

async function run(verb: string, flags: Record<string, string | boolean>) {
  const args: ParsedArguments = { path: verb.split(' '), flags, positionals: [] };
  return await findCommand(verb)?.execute({
    container: createCliContainer({ workspacePath: track, logger: silentLogger, canPrompt: false, version: '9.9.9' }),
    args,
  });
}

function writeProfile(profile: unknown): void {
  writeFileSync(join(track, simConfigFileName), JSON.stringify(profile));
}

const fourKnobs = 'generation.skeleton.lengthRatio,generation.section.retryLimit,generation.dialogue.preservedRatio,generation.padding.paragraphRatio';

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sim-cfg-home-'));
  process.env.STORYBOARD_HOME = home;
  writeFileSync(join(home, 'config.json'), JSON.stringify({ 'ai.provider.default': 'claude' }));
  track = mkdtempSync(join(tmpdir(), 'sim-cfg-track-'));
  const genre = join(track, 'track', 'chain', 'thriller');
  mkdirSync(join(genre, 'scene'), { recursive: true });
  mkdirSync(join(genre, 'floor'), { recursive: true });
  writeFileSync(
    join(genre, 'scene', '01-a.card'),
    'type: scene\nid: 01-a\ntitle: 첫 씬\ntargetWordCount: 3000\nsummary: 문을 연다.\n',
  );
  writeFileSync(join(genre, 'floor', '01-a.md'), '망가진 원고');
});

afterEach(() => {
  delete process.env.STORYBOARD_HOME;
  rmSync(home, { recursive: true, force: true });
  rmSync(track, { recursive: true, force: true });
});

describe('profile file', () => {
  it('reads as empty when the file is absent', async () => {
    expect(await readSimConfig(join(track, simConfigFileName))).toEqual({});
  });

  it('refuses a context window that is not a positive integer', () => {
    expect(() => parseSimConfig({ ollama: { contextTokens: -1 } })).toThrow();
  });

  it('accepts a local runtime profile in full', () => {
    expect(() =>
      parseSimConfig({
        generation: { provider: 'ollama', model: 'qwen3:14b' },
        judge: { provider: 'ollama', model: 'gemma3:12b' },
        ollama: { contextTokens: 32768 },
        repeats: 3,
      }),
    ).not.toThrow();
  });
});

describe('precedence', () => {
  it('takes the judge from the profile', async () => {
    writeProfile({
      generation: { provider: 'ollama', model: 'qwen3:14b' },
      judge: { provider: 'ollama', model: 'gemma3:12b' },
    });

    const outcome = await run('sim sweep', { track, genre: 'thriller', knobs: fourKnobs });

    expect(outcome?.ok).toBe(true);
    expect(outcome?.message).toContain('--yes');
  });

  it('refuses when the profile judges with the generation model', async () => {
    writeProfile({
      generation: { provider: 'ollama', model: 'qwen3:14b' },
      judge: { provider: 'ollama', model: 'qwen3:14b' },
    });

    const outcome = await run('sim sweep', { track, genre: 'thriller', knobs: fourKnobs });

    expect(outcome?.ok).toBe(false);
    expect(outcome?.message).toContain('같은 모델');
  });

  it('lets a flag override the profile judge model', async () => {
    writeProfile({
      generation: { provider: 'ollama', model: 'qwen3:14b' },
      judge: { provider: 'ollama', model: 'qwen3:14b' },
    });

    const outcome = await run('sim sweep', {
      track,
      genre: 'thriller',
      knobs: fourKnobs,
      'judge-model': 'gemma3:12b',
    });

    expect(outcome?.ok).toBe(true);
  });

  it('takes repeats from the profile unless a flag says otherwise', async () => {
    writeProfile({ generation: { provider: 'ollama', model: 'qwen3:8b' }, repeats: 2 });

    expect((await run('sim run', { track, genre: 'thriller' }))?.message).toContain('× 2회');
    expect((await run('sim run', { track, genre: 'thriller', repeats: '5' }))?.message).toContain('× 5회');
  });

  it('runs generation only with --judge none even when the profile names a judge', async () => {
    writeProfile({
      generation: { provider: 'ollama', model: 'qwen3:14b' },
      judge: { provider: 'ollama', model: 'gemma3:12b' },
    });

    const outcome = await run('sim run', { track, genre: 'thriller', judge: 'none' });

    expect(outcome?.ok).toBe(true);
    expect(outcome?.message).toContain('심판 호출 0');
  });

  it('never lets a sweep run without a judge', async () => {
    writeProfile({ generation: { provider: 'ollama', model: 'qwen3:14b' } });

    const outcome = await run('sim sweep', { track, genre: 'thriller', knobs: fourKnobs, judge: 'none' });

    expect(outcome?.ok).toBe(false);
    expect(outcome?.message).toContain('심판 없이');
  });

  it('refuses a profile provider the catalog does not know', async () => {
    writeProfile({ generation: { provider: 'nope', model: 'x' } });

    const outcome = await run('sim run', { track, genre: 'thriller' });

    expect(outcome?.ok).toBe(false);
    expect(outcome?.message).toContain('generation.provider');
  });

  it('reads a profile from --config when it is not at the track root', async () => {
    const elsewhere = join(home, 'desktop.json');
    writeFileSync(elsewhere, JSON.stringify({ generation: { provider: 'ollama', model: 'qwen3:8b' }, repeats: 4 }));

    const outcome = await run('sim run', { track, genre: 'thriller', config: elsewhere });

    expect(outcome?.message).toContain('× 4회');
  });
});
