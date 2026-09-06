import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigBridge } from '@storyboard/story-ai';

import {
  createBotConfiguration,
  flattenLegacyBlocks,
  listCliProvidersInUse,
  listProvidersInUse,
  writeSharedDefaultProvider,
} from '../src/config/sharedConfig';

let home: string;
let workspace: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'storyboard-bot-home-'));
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-bot-ws-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe('bot shared configuration', () => {
  it('reads the shared home file, lets the workspace file override it, and keeps legacy blocks on top', () => {
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({ defaultProvider: 'claude-code', draft: { reviseMaxIterations: 4 } }),
    );
    mkdirSync(join(workspace, '.storyboard'));
    writeFileSync(
      join(workspace, '.storyboard', 'config.json'),
      JSON.stringify({ draft: { reviseMaxIterations: 1 } }),
    );

    const configuration = createBotConfiguration({
      workspacePath: workspace,
      env: { STORYBOARD_HOME: home },
    });
    expect(configuration.get('defaultProvider', 'none')).toBe('claude-code');
    expect(configuration.get('draft.reviseMaxIterations', 0)).toBe(1);

    const legacy = createBotConfiguration({
      workspacePath: workspace,
      env: { STORYBOARD_HOME: home },
      providers: { default: 'codex' },
    });
    expect(legacy.get('defaultProvider', 'none')).toBe('codex');
  });

  // `bot.json` accepts a bare provider name for a task; the engine reads only the object form, so
  // the shorthand has to be expanded or the task silently falls back to the default provider.
  it('expands a bare provider name in a legacy task entry', () => {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ defaultProvider: 'mock' }));
    const configBridge = new ConfigBridge({
      getConfiguration: () =>
        createBotConfiguration({
          workspacePath: workspace,
          env: { STORYBOARD_HOME: home },
          providers: { default: 'mock', tasks: { sceneDraft: 'codex' } },
        }),
    });

    expect(configBridge.getTaskProviderOverride('sceneDraft')).toBe('codex');
  });

  it('flattens only the legacy values that were actually set', () => {
    expect(flattenLegacyBlocks(undefined, undefined)).toEqual({});
    expect(
      flattenLegacyBlocks(
        { default: 'codex', models: { codex: { reasoningEffort: 'high' } } },
        { reviseAfterGenerate: false, reviseMaxIterations: 3, autoGrounding: false },
      ),
    ).toEqual({
      defaultProvider: 'codex',
      'providers.codex.reasoningEffort': 'high',
      'draft.reviseAfterGenerate': false,
      'draft.reviseMaxIterations': 3,
      'grounding.autoApprove': false,
    });
  });

  it('writes the setup wizard choice into the shared home file', async () => {
    const file = await writeSharedDefaultProvider('codex', { STORYBOARD_HOME: home });

    expect(file).toBe(join(home, 'config.json'));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ defaultProvider: 'codex' });
  });

  it('lists every provider the shared config puts in use, API-key ones included', () => {
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        defaultProvider: 'openai',
        tasks: { grammarCheck: { provider: 'claude' }, sceneDraft: { provider: 'codex' } },
      }),
    );
    const configBridge = new ConfigBridge({
      getConfiguration: () =>
        createBotConfiguration({ workspacePath: workspace, env: { STORYBOARD_HOME: home } }),
    });

    expect(listProvidersInUse(configBridge)).toEqual(['openai', 'codex', 'claude']);
    expect(listCliProvidersInUse(configBridge)).toEqual([{ providerId: 'codex', command: 'codex' }]);
  });

  it('lists the CLI providers a generation would actually invoke with their commands', () => {
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        defaultProvider: 'claude-code',
        tasks: { grammarCheck: { provider: 'codex' } },
        providers: { codex: { command: '/opt/codex' } },
      }),
    );
    const configBridge = new ConfigBridge({
      getConfiguration: () =>
        createBotConfiguration({ workspacePath: workspace, env: { STORYBOARD_HOME: home } }),
    });

    expect(listCliProvidersInUse(configBridge)).toEqual([
      { providerId: 'claude-code', command: 'claude' },
      { providerId: 'codex', command: '/opt/codex' },
    ]);
  });
});
