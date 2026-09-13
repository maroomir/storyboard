import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  computeCompletions,
  formatCompletions,
  renderCompletionScript,
} from '../src/commands/completion';
import { dispatch } from '../src/commands/dispatch';

let cwd: string;

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  show: () => undefined,
};

function texts(words: string[]): string[] {
  return computeCompletions(words, { cwd }).map((item) => item.text);
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'storyboard-complete-'));
  mkdirSync(join(cwd, '.storyboard'));
  writeFileSync(join(cwd, '.storyboard', 'project.json'), '{}');
  mkdirSync(join(cwd, 'scene'));
  writeFileSync(join(cwd, 'scene', '01-intro.card'), '');
  writeFileSync(join(cwd, 'scene', '02-storm.card'), '');
  mkdirSync(join(cwd, 'character'));
  writeFileSync(join(cwd, 'character', 'seorin.card'), '');
  writeFileSync(join(cwd, 'character', '.sample.card'), '');
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('computeCompletions', () => {
  it('offers first words, then the second word of a verb, with descriptions', () => {
    expect(texts([''])).toEqual(expect.arrayContaining(['scene', 'init', 'doctor']));
    expect(texts([''])).not.toContain('tui');
    expect(texts(['sc'])).toEqual(['scene']);
    expect(texts(['scene', 'g'])).toEqual(['scene', 'generate'].slice(1));

    const generate = computeCompletions(['scene', 'gen'], { cwd })[0];
    expect(generate?.description).toContain('씬 초안');
  });

  it('completes scene stems and card ids from the workspace, skipping the sample card', () => {
    expect(texts(['scene', 'generate', ''])).toEqual(['01-intro', '02-storm']);
    expect(texts(['check', 'grammar', '02'])).toEqual(['02-storm']);
    expect(texts(['card', 'rename', 'character', ''])).toEqual(['seorin']);
  });

  it('completes flags for the verb plus the common ones, and values after a flag', () => {
    expect(texts(['scene', 'generate', '--'])).toEqual(
      expect.arrayContaining(['--all', '--force', '--json']),
    );
    expect(texts(['scene', 'generate', '--a'])).toEqual(['--all']);
    expect(texts(['setup', '--provider', 'c'])).toEqual(['claude']);
    expect(texts(['setup', '--provider', 'openai', '--model', ''])).toContain('gpt-5.6-terra');
    expect(texts(['config', 'set', 'draft.'])).toEqual(
      expect.arrayContaining(['draft.keepHistory']),
    );
    expect(texts(['completion', ''])).toEqual(['zsh', 'bash', 'fish']);
  });

  it('honours --workspace when looking up stems', () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'storyboard-elsewhere-'));

    expect(texts(['--workspace', elsewhere, 'scene', 'generate', ''])).toEqual([]);
    expect(texts(['scene', 'generate', '--workspace', cwd, ''])).toEqual(['01-intro', '02-storm']);

    rmSync(elsewhere, { recursive: true, force: true });
  });

  it('prints tab-separated text and description per line', () => {
    expect(
      formatCompletions([
        { text: 'a', description: 'A' },
        { text: 'b', description: '' },
      ]),
    ).toBe('a\tA\nb');
  });
});

describe('completion scripts', () => {
  it('registers a completer for each shell that calls __complete', () => {
    expect(renderCompletionScript('zsh')).toContain('compdef _storyboard storyboard');
    expect(renderCompletionScript('bash')).toContain('complete -F _storyboard storyboard');
    expect(renderCompletionScript('fish')).toContain(
      "complete -c storyboard -f -a '(__storyboard_complete)'",
    );
    for (const shell of ['zsh', 'bash', 'fish']) {
      expect(renderCompletionScript(shell)).toContain('storyboard __complete');
    }
    expect(renderCompletionScript('powershell')).toBeUndefined();
  });

  it('answers __complete through dispatch without parsing the partial line', async () => {
    const result = await dispatch(['__complete', 'scene', 'generate', '--fo'], {
      version: '0.0.0',
      cwd,
      isInteractive: false,
      createLogger: () => silentLogger,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--force\t');
  });

  it('emits the script through the completion verb and rejects unknown shells', async () => {
    const deps = { version: '0.0.0', cwd, isInteractive: false, createLogger: () => silentLogger };

    expect((await dispatch(['completion', 'zsh'], deps)).stdout).toContain('#compdef storyboard');
    expect((await dispatch(['completion', 'tcsh'], deps)).exitCode).toBe(1);
  });
});
