import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  computeCompletions,
  formatCompletions,
  renderCompletionScript,
} from '../src/commands/completion';
import { dispatch } from '../src/commands/dispatch';

let cwd: string;
let home: string;

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
  // The provider list depends on the home config (a hidden provider enabled there is offered), so
  // the test owns an empty home rather than reading the machine's.
  home = mkdtempSync(join(tmpdir(), 'storyboard-complete-home-'));
  vi.stubEnv('STORYBOARD_HOME', home);
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
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe('computeCompletions', () => {
  it('offers first words, then the second word of a verb, with descriptions', () => {
    expect(texts([''])).toEqual(expect.arrayContaining(['scene', 'init', 'doctor']));
    expect(texts([''])).not.toContain('tui');
    expect(texts(['sc'])).toEqual(['scene']);
    expect(texts(['draft', 'g'])).toEqual(['generate']);

    const generate = computeCompletions(['draft', 'gen'], { cwd })[0];
    expect(generate?.description).toContain('씬 초안');
  });

  it('completes scene stems and card ids from the workspace, skipping the sample card', () => {
    expect(texts(['draft', 'generate', ''])).toEqual(['01-intro', '02-storm']);
    expect(texts(['draft', 'check', 'grammar', '02'])).toEqual(['02-storm']);
    expect(texts(['card', 'rename', 'character', ''])).toEqual(['seorin']);
    expect(texts(['card', 'rename', 'background', ''])).toEqual([]);
  });

  it('completes the kind a verb takes as its first argument', () => {
    expect(texts(['card', 'create', ''])).toEqual(['character', 'background']);
    expect(texts(['card', 'recommend', 'b'])).toEqual(['background']);
    expect(texts(['draft', 'check', ''])).toEqual(['grammar', 'continuity', 'slop']);
    expect(texts(['notes', 'connect', ''])).toEqual(['notion']);
    expect(texts(['card', 'list', 'c'])).toEqual(['character']);
    expect(texts(['card', 'show', ''])).toEqual(['seorin']);
  });

  it('completes flags for the verb plus the common ones, and values after a flag', () => {
    expect(texts(['draft', 'generate', '--'])).toEqual(
      expect.arrayContaining(['--all', '--force', '--json']),
    );
    expect(texts(['draft', 'generate', '--a'])).toEqual(['--all']);
    expect(texts(['setup', '--provider', 'c'])).toEqual(['claude']);
    expect(texts(['setup', '--provider', 'openai', '--model', ''])).toContain('gpt-5.6-terra');
    expect(texts(['config', 'set', 'editor.'])).toEqual(
      expect.arrayContaining(['editor.draft.keepHistory']),
    );
    expect(texts(['completion', ''])).toEqual(['zsh', 'bash', 'fish']);
  });

  it('completes task route keys and the model of the provider a config key names', () => {
    expect(texts(['config', 'set', 'tasks.noteExtraction.'])).toEqual([
      'tasks.noteExtraction.provider',
      'tasks.noteExtraction.model',
    ]);
    expect(texts(['config', 'unset', 'tasks.noteEx'])).toContain('tasks.noteExtraction.provider');
    expect(
      texts(['config', 'set', 'tasks.noteExtraction.provider', 'claude', '--model', 'claude-o']),
    ).toContain('claude-opus-5-5');
    expect(texts(['config', 'set', 'ai.provider.default', 'openai', '--model', ''])).toContain(
      'gpt-5.6-terra',
    );
  });

  it('honours --workspace when looking up stems', () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'storyboard-elsewhere-'));

    expect(texts(['--workspace', elsewhere, 'draft', 'generate', ''])).toEqual([]);
    expect(texts(['draft', 'generate', '--workspace', cwd, ''])).toEqual(['01-intro', '02-storm']);

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
    const result = await dispatch(['__complete', 'draft', 'generate', '--fo'], {
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
