import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandDispatcher, type DispatchDependencies } from '@/commands/commandDispatcher';

let home: string;
let cwd: string;

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  show: () => undefined,
};

function deps(overrides: Partial<DispatchDependencies> = {}): DispatchDependencies {
  return {
    version: '1.2.3',
    cwd,
    isInteractive: false,
    createLogger: () => silentLogger,
    ...overrides,
  };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'storyboard-cli-home-'));
  cwd = mkdtempSync(join(tmpdir(), 'storyboard-cli-cwd-'));
  vi.stubEnv('STORYBOARD_HOME', home);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe('dispatch', () => {
  it('prints grouped usage on stdout with exit 0 for a bare invocation', async () => {
    const result = await new CommandDispatcher(deps()).dispatch([]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('처음이라면');
    expect(result.stderr).toBe('');
    expect(result.launchTui).toBeUndefined();
  });

  it('launches the TUI for a bare invocation at a terminal, and for the tui verb anywhere', async () => {
    expect((await new CommandDispatcher(deps({ isInteractive: true })).dispatch([])).launchTui).toBe(true);
    expect((await new CommandDispatcher(deps()).dispatch(['tui'])).launchTui).toBe(true);
    expect((await new CommandDispatcher(deps({ isInteractive: true })).dispatch(['--help'])).launchTui).toBeUndefined();
  });

  it('answers -v and per-verb -h', async () => {
    expect((await new CommandDispatcher(deps()).dispatch(['-v'])).stdout).toBe('1.2.3\n');
    const help = await new CommandDispatcher(deps()).dispatch(['draft', 'generate', '-h']);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain('storyboard draft generate <stem> | --all');
  });

  it('opens help at the group list, one group, or every command', async () => {
    const short = await new CommandDispatcher(deps()).dispatch(['--help']);
    const all = await new CommandDispatcher(deps()).dispatch(['help', '--all']);
    const group = await new CommandDispatcher(deps()).dispatch(['help', 'draft']);

    expect(short.stdout).toContain('명령 묶음');
    expect(short.stdout).not.toContain('draft condense');
    expect(all.stdout).toContain('draft condense');
    expect(group.exitCode).toBe(0);
    expect(group.stdout).toContain('draft condense');
    expect((await new CommandDispatcher(deps()).dispatch(['help', 'nothing'])).exitCode).toBe(1);
  });

  it('names the flag that was meant when one is misspelled', async () => {
    const result = await new CommandDispatcher(deps()).dispatch(['init', '--titel', '작품']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('알 수 없는 옵션: --titel');
    expect(result.stderr).toContain('혹시 →  --title');
  });

  it('accepts --no-color anywhere and keeps a run without real streams free of color codes', async () => {
    const result = await new CommandDispatcher(deps()).dispatch(['--no-color', '-v']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('1.2.3\n');
    expect((await new CommandDispatcher(deps()).dispatch(['--help'])).stdout).not.toContain('\u001b[');
  });

  it('keeps every failure inside the JSON envelope when --json is set', async () => {
    const unknown = await new CommandDispatcher(deps()).dispatch(['scene', 'generat', '--json']);
    expect(unknown.exitCode).toBe(1);
    expect(JSON.parse(unknown.stdout)).toMatchObject({ ok: false });
    expect(unknown.stderr).toBe('');

    const noWorkspace = await new CommandDispatcher(deps()).dispatch(['draft', 'generate', '01', '--json']);
    expect(JSON.parse(noWorkspace.stdout).message).toContain('storyboard init --title');
  });

  it('leads every renamed command to its new name first, keeping arguments and flags in order', async () => {
    const renamed: ReadonlyArray<readonly [string, string]> = [
      ['scene generate', 'draft generate'],
      ['scene revise', 'draft revise'],
      ['scene draft', 'draft show'],
      ['check grammar', 'draft check grammar'],
      ['check continuity', 'draft check continuity'],
      ['check slop', 'draft check slop'],
      ['scene seeds', 'scene seed'],
      ['scene beats', 'scene plot'],
      ['cards build', 'card build'],
      ['bible promote', 'canon promote'],
      ['narrator add', 'narrator create'],
      ['manuscript summaries', 'manuscript summarize'],
    ];
    const tails = ['01', '--all', '01 --provider openai --all'];

    for (const [oldName, newName] of renamed) {
      for (const tail of tails) {
        const oldCommand = `${oldName} ${tail}`;
        const result = await new CommandDispatcher(deps()).dispatch(oldCommand.split(' '));

        expect(result.exitCode, oldCommand).not.toBe(0);
        expect(result.stderr.split('\n')[1], oldCommand).toMatch(
          new RegExp(`storyboard ${newName} ${tail}$`),
        );
      }
    }
  });

  it('names the fix on stderr for a missing workspace without --json', async () => {
    const result = await new CommandDispatcher(deps()).dispatch(['draft', 'generate', '01']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('storyboard init --title');
    expect(result.stdout).toBe('');
  });

  it('runs a config-writing verb outside a workspace only when --global says where', async () => {
    const ambiguous = await new CommandDispatcher(deps()).dispatch(['setup', '--provider', 'mock']);

    expect(ambiguous.exitCode).toBe(1);
    expect(ambiguous.stderr).toContain('--global');

    const result = await new CommandDispatcher(deps()).dispatch(['setup', '--provider', 'mock', '--global']);

    expect(result.exitCode).toBe(0);
    expect(result.outcome?.ok).toBe(true);
    expect(result.stdout).toContain('mock');
    expect(result.outcome?.data).toMatchObject({ file: join(home, 'config.json') });
  });

  it('writes settings to the workspace it is run in, and to the home file with --global', async () => {
    mkdirSync(join(cwd, '.storyboard'), { recursive: true });
    writeFileSync(join(cwd, '.storyboard', 'project.json'), '{"id":"w","name":"작품"}');

    const local = await new CommandDispatcher(deps()).dispatch(['config', 'set', 'generation.beats.charsPerBeat', '300']);

    expect(local.exitCode).toBe(0);
    expect(local.outcome?.data).toMatchObject({
      file: join(cwd, '.storyboard', 'config.json'),
      origin: 'workspace',
    });

    const global = await new CommandDispatcher(deps()).dispatch(['config', 'set', 'generation.beats.charsPerBeat', '900', '--global']);

    expect(global.outcome?.data).toMatchObject({ file: join(home, 'config.json') });
    expect(readFileSync(join(cwd, '.storyboard', 'config.json'), 'utf8')).toContain('300');
  });

  it('takes --model on config set without a --provider', async () => {
    const result = await new CommandDispatcher(deps()).dispatch([
        'config',
        'set',
        'tasks.noteExtraction.provider',
        'claude',
        '--model',
        'claude-opus-5-5',
        '--global',
      ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'))).toEqual({
      tasks: { noteExtraction: { provider: 'claude', model: 'claude-opus-5-5' } },
    });
  });

  it('refuses the run flag --provider on config set and unset', async () => {
    const stored = {
      tasks: { sceneDraft: { provider: 'openai', model: 'gpt-5.5' } },
    };
    writeFileSync(join(home, 'config.json'), JSON.stringify(stored));

    const set = await new CommandDispatcher(deps()).dispatch(['config', 'set', 'tasks.sceneDraft.provider', 'openai', '--provider', 'claude', '--global']);
    const unset = await new CommandDispatcher(deps()).dispatch(['config', 'unset', 'tasks.sceneDraft.model', '--provider', 'claude', '--global']);

    expect(set.exitCode).toBe(1);
    expect(set.stderr).toContain('--provider');
    expect(unset.exitCode).toBe(1);
    expect(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'))).toEqual(stored);
  });

  it('refuses config unset outside a workspace unless --global says where', async () => {
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({ revise: { loop: { maxIterations: 3 } } }),
    );

    const ambiguous = await new CommandDispatcher(deps()).dispatch(['config', 'unset', 'revise.loop.maxIterations']);
    expect(ambiguous.exitCode).toBe(1);
    expect(ambiguous.stderr).toContain('--global');

    const result = await new CommandDispatcher(deps()).dispatch(['config', 'unset', 'revise.loop.maxIterations', '--global']);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'))).toEqual({});
  });

  it('names the allowed range when a value is outside it', async () => {
    const result = await new CommandDispatcher(deps()).dispatch(['config', 'set', 'revise.loop.maxIterations', '9', '--global']);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('1 이상 5 이하여야 합니다: 9');
  });
});
