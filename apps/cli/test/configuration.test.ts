import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';

import {
  ConfigFileError,
  configurationTargets,
  createFileConfiguration,
} from '@storyboard/story-config';

let home: string;

function write(file: string, value: unknown): string {
  const target = join(home, file);
  writeFileSync(target, JSON.stringify(value));
  return target;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'storyboard-cli-config-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('CLI configuration precedence', () => {
  // A shallow merge would let a workspace file that names one provider hide every provider the
  // user file configured — the settings would silently fall back to defaults.
  it('keeps user sections the workspace file does not name', () => {
    const user = write('user.json', { providers: { ollama: { baseUrl: 'http://x' } } });
    const workspace = write('workspace.json', { providers: { mock: { model: 'mock-default' } } });

    const configuration = createFileConfiguration({
      userConfigFile: user,
      workspaceConfigFile: workspace,
    });

    expect(configuration.get('providers.ollama.baseUrl', undefined)).toBe('http://x');
    expect(configuration.get('providers.mock.model', undefined)).toBe('mock-default');
  });

  it('lets the workspace file win key by key', () => {
    const user = write('user.json', { defaultProvider: 'codex', draft: { keepHistory: true } });
    const workspace = write('workspace.json', { defaultProvider: 'mock' });

    const configuration = createFileConfiguration({
      userConfigFile: user,
      workspaceConfigFile: workspace,
    });

    expect(configuration.get('defaultProvider', undefined)).toBe('mock');
    expect(configuration.get('draft.keepHistory', undefined)).toBe(true);
  });

  // Naming a provider on the command line means "this run, everything" — otherwise task-level
  // routing in the file silently wins and the flag looks broken.
  it('replaces a section outright when a flag overrides it', () => {
    const user = write('user.json', { tasks: { sceneDraft: { provider: 'codex' } } });
    const workspace = write('workspace.json', {});

    const configuration = createFileConfiguration({
      userConfigFile: user,
      workspaceConfigFile: workspace,
      overrides: { defaultProvider: 'mock', tasks: {} },
    });

    expect(configuration.get('tasks', { sceneDraft: {} })).toEqual({});
    expect(configuration.get('defaultProvider', undefined)).toBe('mock');
  });

  it('reports which layer a value came from', () => {
    const user = write('user.json', { defaultProvider: 'codex' });
    const workspace = write('workspace.json', { providers: { codex: { model: 'gpt-5.5' } } });

    const configuration = createFileConfiguration({
      userConfigFile: user,
      workspaceConfigFile: workspace,
    });

    expect(configuration.inspect('defaultProvider')).toEqual({
      globalValue: 'codex',
      workspaceValue: undefined,
    });
    expect(configuration.inspect('providers.codex.model')).toEqual({
      globalValue: undefined,
      workspaceValue: 'gpt-5.5',
    });
  });

  // A typo in a hand-edited file must not silently become "all defaults": the CLI exits loudly, the
  // editor gets to report it and carry on.
  it('refuses an unparsable file unless a reporter takes it', () => {
    const user = join(home, 'user.json');
    writeFileSync(user, '{ "defaultProvider": ');

    expect(() =>
      createFileConfiguration({ userConfigFile: user }).get('defaultProvider', 'x'),
    ).toThrow(ConfigFileError);

    const reported: ConfigFileError[] = [];
    const tolerant = createFileConfiguration({
      userConfigFile: user,
      onInvalidFile: (error) => reported.push(error),
    });

    expect(tolerant.get('defaultProvider', 'x')).toBe('x');
    expect(reported.map((error) => error.code)).toEqual(['invalid-json']);
  });
});

describe('CLI configuration updates', () => {
  it('writes nested keys to the chosen layer and drops a flat spelling of the same key', async () => {
    const user = write('user.json', {
      'providers.openai.model': 'old',
      draft: { reviseMaxIterations: 3 },
    });
    const workspace = write('workspace.json', {});
    const configuration = createFileConfiguration({
      userConfigFile: user,
      workspaceConfigFile: workspace,
    });

    await configuration.update('providers.openai.model', 'gpt-5-mini');
    await configuration.update('defaultProvider', 'openai', configurationTargets.workspace);

    expect(JSON.parse(readFileSync(user, 'utf8'))).toEqual({
      providers: { openai: { model: 'gpt-5-mini' } },
      draft: { reviseMaxIterations: 3 },
    });
    expect(JSON.parse(readFileSync(workspace, 'utf8'))).toEqual({ defaultProvider: 'openai' });
    expect(configuration.get('providers.openai.model', undefined)).toBe('gpt-5-mini');
    expect(configuration.get('defaultProvider', undefined)).toBe('openai');
  });

  it('removes a key when the value is undefined and creates a missing file', async () => {
    const user = join(home, 'fresh', 'config.json');
    const configuration = createFileConfiguration({ userConfigFile: user });

    await configuration.update('defaultProvider', 'codex');
    await configuration.update('defaultProvider', undefined);

    expect(JSON.parse(readFileSync(user, 'utf8'))).toEqual({});
  });
});
