import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigBridge } from '@storyboard/story-ai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from '../src/config/config';

function writeConfig(dir: string, body: unknown): string {
  const path = join(dir, 'config.json');
  writeFileSync(path, JSON.stringify(body), 'utf8');
  chmodSync(path, 0o600);
  return path;
}

const BASE = {
  telegram: { botToken: 't', allowedChatIds: [1] },
  workspace: { path: '/tmp/ws' },
};

// Blind-pass B5/M1/M2/M3: operator mistakes must fail loudly, never fall back to mock silently.
describe('strict bot provider config', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'storyboard-bot-cfg-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a provider id typo instead of silently using mock', () => {
    const path = writeConfig(dir, { ...BASE, providers: { default: 'Ollama' } });

    expect(() => loadConfig(path)).toThrow(ConfigError);
    expect(() => loadConfig(path)).toThrow(/CLI 전용/);
  });

  it('rejects API-key providers with a clear message', () => {
    const path = writeConfig(dir, { ...BASE, providers: { default: 'openai' } });

    expect(() => loadConfig(path)).toThrow(/openai.*지원하지 않습니다/);
  });

  it('rejects unsupported fields in a provider section instead of stripping them', () => {
    const path = writeConfig(dir, {
      ...BASE,
      providers: { default: 'mock', models: { mock: { baseUrl: 'http://gpu:11434' } } },
    });

    expect(() => loadConfig(path)).toThrow(ConfigError);
  });

  it('rejects a malformed task entry shape', () => {
    const path = writeConfig(dir, {
      ...BASE,
      providers: { default: 'mock', tasks: { sceneDraft: { model: 'x' } } },
    });

    expect(() => loadConfig(path)).toThrow(ConfigError);
  });

  it('accepts codex reasoningEffort and a free-form CLI model name', () => {
    const path = writeConfig(dir, {
      ...BASE,
      providers: {
        default: 'codex',
        models: { codex: { model: 'gpt-99-brand-new', reasoningEffort: 'high' } },
      },
    });

    const { config } = loadConfig(path);
    expect(config.providers?.models?.['codex']?.reasoningEffort).toBe('high');
  });

  it('defaults the revise gate on and clamps its iteration range', () => {
    const defaulted = loadConfig(writeConfig(dir, BASE));
    expect(defaulted.config.draft).toEqual({
      reviseAfterGenerate: true,
      reviseMaxIterations: 2,
      autoGrounding: true,
    });

    const explicit = loadConfig(
      writeConfig(dir, { ...BASE, draft: { reviseAfterGenerate: false, reviseMaxIterations: 5 } }),
    );
    expect(explicit.config.draft.reviseAfterGenerate).toBe(false);
    expect(explicit.config.draft.reviseMaxIterations).toBe(5);

    expect(() =>
      loadConfig(writeConfig(dir, { ...BASE, draft: { reviseMaxIterations: 9 } })),
    ).toThrow(ConfigError);
    expect(() => loadConfig(writeConfig(dir, { ...BASE, draft: { revise: true } }))).toThrow(
      ConfigError,
    );
  });

  it('warns on an unknown top-level section', () => {
    const path = writeConfig(dir, { ...BASE, dashbaord: { port: 1 } });

    const { warnings } = loadConfig(path);
    expect(warnings.some((w) => w.includes('dashbaord'))).toBe(true);
  });
});

// Decision #32: CLI providers pass the configured model through; API providers keep the gate.
describe('catalog gate exemption for CLI providers', () => {
  function bridge(settings: Record<string, unknown>): ConfigBridge {
    return new ConfigBridge({
      getConfiguration: () => ({
        get: <T>(section: string, defaultValue: T): T => (settings[section] as T) ?? defaultValue,
      }),
    });
  }

  it('passes a non-catalog model through for claude-code', () => {
    const configBridge = bridge({
      defaultProvider: 'claude-code',
      'providers.claude-code.model': 'sonnet-brand-new',
    });

    const resolved = configBridge.getTaskAiConfig('sceneDraft');
    expect(resolved.providerId).toBe('claude-code');
    expect(resolved.model).toBe('sonnet-brand-new');
  });

  it('still gates a non-catalog model for an API provider', () => {
    const configBridge = bridge({
      defaultProvider: 'openai',
      'providers.openai.model': 'gpt-not-in-catalog',
    });

    const resolved = configBridge.getTaskAiConfig('sceneDraft');
    expect(resolved.providerId).toBe('openai');
    expect(resolved.model).not.toBe('gpt-not-in-catalog');
  });
});
