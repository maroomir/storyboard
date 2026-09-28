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
    const user = write('user.json', { defaultProvider: 'openai', draft: { keepHistory: true } });
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
    const user = write('user.json', { tasks: { sceneDraft: { provider: 'openai' } } });
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
    const user = write('user.json', { defaultProvider: 'openai' });
    const workspace = write('workspace.json', { providers: { openai: { model: 'gpt-5.5' } } });

    const configuration = createFileConfiguration({
      userConfigFile: user,
      workspaceConfigFile: workspace,
    });

    expect(configuration.inspect('defaultProvider')).toEqual({
      globalValue: 'openai',
      workspaceValue: undefined,
    });
    expect(configuration.inspect('providers.openai.model')).toEqual({
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

describe('CLI configuration validation', () => {
  it('refuses a value the setting catalog rejects, naming the key', () => {
    const user = write('user.json', { draft: { reviseMaxIterations: 99 } });

    let thrown: unknown;
    try {
      createFileConfiguration({ userConfigFile: user }).get('draft.reviseMaxIterations', 1);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConfigFileError);
    expect((thrown as ConfigFileError).code).toBe('invalid-value');
    expect((thrown as ConfigFileError).message).toContain('draft.reviseMaxIterations');
  });

  it('refuses an unknown provider or a flat key with the wrong type', () => {
    const user = write('user.json', { defaultProvider: 'codex', 'draft.minBeats': 'three' });

    expect(() =>
      createFileConfiguration({ userConfigFile: user }).get('defaultProvider', 'x'),
    ).toThrow(ConfigFileError);
  });

  it('reports an unknown key once per read but still returns it', () => {
    const user = write('user.json', {
      defaultProvider: 'claude',
      providers: { claude: { model: 'claude-sonnet-5', color: 'blue' } },
      experiment: true,
    });
    const unknown: string[] = [];
    const configuration = createFileConfiguration({
      userConfigFile: user,
      onUnknownKey: (warning) => unknown.push(warning.key),
    });

    expect(configuration.get('experiment', false)).toBe(true);
    expect(configuration.get('providers.claude.model', '')).toBe('claude-sonnet-5');
    configuration.get('defaultProvider', 'x');
    expect(unknown).toEqual(['providers.claude.color', 'experiment']);
  });

  it('lets a tolerant host fall back to defaults for a file with a bad value', () => {
    const user = write('user.json', { budget: { runLimitUsd: -1 } });
    const reported: ConfigFileError[] = [];
    const tolerant = createFileConfiguration({
      userConfigFile: user,
      onInvalidFile: (error) => reported.push(error),
    });

    expect(tolerant.get('budget.runLimitUsd', 0)).toBe(0);
    expect(reported.map((error) => error.code)).toEqual(['invalid-value']);
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
