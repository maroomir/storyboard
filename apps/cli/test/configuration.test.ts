import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';

import { ConfigBridge } from '@storyboard/story-ai';
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
    const user = write('user.json', { 'ai.provider.default': 'openai', editor: { draft: { keepHistory: true } } });
    const workspace = write('workspace.json', { 'ai.provider.default': 'mock' });

    const configuration = createFileConfiguration({
      userConfigFile: user,
      workspaceConfigFile: workspace,
    });

    expect(configuration.get('ai.provider.default', undefined)).toBe('mock');
    expect(configuration.get('editor.draft.keepHistory', undefined)).toBe(true);
  });

  // Naming a provider on the command line means "this run, everything" — otherwise task-level
  // routing in the file silently wins and the flag looks broken.
  it('replaces a section outright when a flag overrides it', () => {
    const user = write('user.json', { tasks: { sceneDraft: { provider: 'openai' } } });
    const workspace = write('workspace.json', {});

    const configuration = createFileConfiguration({
      userConfigFile: user,
      workspaceConfigFile: workspace,
      overrides: { 'ai.provider.default': 'mock', tasks: {} },
    });

    expect(configuration.get('tasks', { sceneDraft: {} })).toEqual({});
    expect(configuration.get('ai.provider.default', undefined)).toBe('mock');
  });

  it('reports which layer a value came from', () => {
    const user = write('user.json', { 'ai.provider.default': 'openai' });
    const workspace = write('workspace.json', { providers: { openai: { model: 'gpt-5.5' } } });

    const configuration = createFileConfiguration({
      userConfigFile: user,
      workspaceConfigFile: workspace,
    });

    expect(configuration.inspect('ai.provider.default')).toEqual({
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
    writeFileSync(user, '{ "ai.provider.default": ');

    expect(() =>
      createFileConfiguration({ userConfigFile: user }).get('ai.provider.default', 'x'),
    ).toThrow(ConfigFileError);

    const reported: ConfigFileError[] = [];
    const tolerant = createFileConfiguration({
      userConfigFile: user,
      onInvalidFile: (error) => reported.push(error),
    });

    expect(tolerant.get('ai.provider.default', 'x')).toBe('x');
    expect(reported.map((error) => error.code)).toEqual(['invalid-json']);
  });
});

describe('CLI configuration validation', () => {
  it('refuses a value the setting catalog rejects, naming the key', () => {
    const user = write('user.json', { revise: { loop: { maxIterations: 99 } } });

    let thrown: unknown;
    try {
      createFileConfiguration({ userConfigFile: user }).get('revise.loop.maxIterations', 1);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConfigFileError);
    expect((thrown as ConfigFileError).code).toBe('invalid-value');
    expect((thrown as ConfigFileError).message).toContain('revise.loop.maxIterations');
  });

  it('refuses an unknown provider or a flat key with the wrong type', () => {
    const user = write('user.json', { 'ai.provider.default': 'codex', 'generation.beats.minimum': 'three' });

    expect(() =>
      createFileConfiguration({ userConfigFile: user }).get('ai.provider.default', 'x'),
    ).toThrow(ConfigFileError);
  });

  it('reports an unknown key once per read but still returns it', () => {
    const user = write('user.json', {
      'ai.provider.default': 'claude',
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
    configuration.get('ai.provider.default', 'x');
    expect(unknown).toEqual(['providers.claude.color', 'experiment']);
  });

  it('lets a tolerant host fall back to defaults for a file with a bad value', () => {
    const user = write('user.json', { budget: { run: { limitUsd: -1 } } });
    const reported: ConfigFileError[] = [];
    const tolerant = createFileConfiguration({
      userConfigFile: user,
      onInvalidFile: (error) => reported.push(error),
    });

    expect(tolerant.get('budget.run.limitUsd', 0)).toBe(0);
    expect(reported.map((error) => error.code)).toEqual(['invalid-value']);
  });
});

describe('CLI configuration updates', () => {
  it('writes nested keys to the chosen layer and drops a flat spelling of the same key', async () => {
    const user = write('user.json', {
      'providers.openai.model': 'old',
      revise: { loop: { maxIterations: 3 } },
    });
    const workspace = write('workspace.json', {});
    const configuration = createFileConfiguration({
      userConfigFile: user,
      workspaceConfigFile: workspace,
    });

    await configuration.update('providers.openai.model', 'gpt-5-mini');
    await configuration.update('ai.provider.default', 'openai', configurationTargets.workspace);

    expect(JSON.parse(readFileSync(user, 'utf8'))).toEqual({
      providers: { openai: { model: 'gpt-5-mini' } },
      revise: { loop: { maxIterations: 3 } },
    });
    expect(JSON.parse(readFileSync(workspace, 'utf8'))).toEqual({ ai: { provider: { default: 'openai' } } });
    expect(configuration.get('providers.openai.model', undefined)).toBe('gpt-5-mini');
    expect(configuration.get('ai.provider.default', undefined)).toBe('openai');
  });

  it('removes a key when the value is undefined and creates a missing file', async () => {
    const user = join(home, 'fresh', 'config.json');
    const configuration = createFileConfiguration({ userConfigFile: user });

    await configuration.update('ai.provider.default', 'codex');
    await configuration.update('ai.provider.default', undefined);

    expect(JSON.parse(readFileSync(user, 'utf8'))).toEqual({});
  });
});

describe('task routing across the two config files', () => {
  function bridgeOver(
    userFile: string,
    workspaceFile: string,
    writeTarget?: number,
  ): ConfigBridge {
    const configuration = createFileConfiguration({
      userConfigFile: userFile,
      workspaceConfigFile: workspaceFile,
    });
    return new ConfigBridge({
      getConfiguration: () => configuration,
      ...(writeTarget === undefined ? {} : { writeTarget }),
    });
  }

  // Writing the merged map would copy every home route into the work's file, and a route removed
  // from the work would come back from the home file.
  it('writes one task into the chosen file without copying the other layer', async () => {
    const user = write('user.json', { tasks: { sceneDraft: { provider: 'openai', model: 'gpt-5.5' } } });
    const workspace = write('workspace.json', {});
    const configBridge = bridgeOver(user, workspace, configurationTargets.workspace);

    await configBridge.setTaskAiConfig('grammarCheck', {
      providerId: 'claude',
      model: 'claude-haiku-4-5',
    });

    expect(JSON.parse(readFileSync(workspace, 'utf8'))).toEqual({
      tasks: { grammarCheck: { provider: 'claude', model: 'claude-haiku-4-5' } },
    });
    expect(JSON.parse(readFileSync(user, 'utf8'))).toEqual({
      tasks: { sceneDraft: { provider: 'openai', model: 'gpt-5.5' } },
    });

    await configBridge.clearTaskAiConfig('grammarCheck');

    expect(JSON.parse(readFileSync(workspace, 'utf8'))).toEqual({});
    expect(configBridge.getTaskProviderOverride('sceneDraft')).toBe('openai');
  });

  it('clears a route from the layer it lives in when the host names no layer', async () => {
    const user = write('user.json', {
      tasks: { sceneDraft: { provider: 'openai' }, grammarCheck: { provider: 'claude' } },
    });
    const workspace = write('workspace.json', {});
    const configBridge = bridgeOver(user, workspace);

    await configBridge.clearTaskAiConfig('sceneDraft');

    expect(JSON.parse(readFileSync(user, 'utf8'))).toEqual({
      tasks: { grammarCheck: { provider: 'claude' } },
    });
    expect(JSON.parse(readFileSync(workspace, 'utf8'))).toEqual({});
  });
});
