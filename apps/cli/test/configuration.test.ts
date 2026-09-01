import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFileConfiguration } from '../src/adapters/fileConfiguration';

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

    const configuration = createFileConfiguration(user, workspace);

    expect(configuration.get('providers.ollama.baseUrl', undefined)).toBe('http://x');
    expect(configuration.get('providers.mock.model', undefined)).toBe('mock-default');
  });

  it('lets the workspace file win key by key', () => {
    const user = write('user.json', { defaultProvider: 'codex', draft: { keepHistory: true } });
    const workspace = write('workspace.json', { defaultProvider: 'mock' });

    const configuration = createFileConfiguration(user, workspace);

    expect(configuration.get('defaultProvider', undefined)).toBe('mock');
    expect(configuration.get('draft.keepHistory', undefined)).toBe(true);
  });

  // Naming a provider on the command line means "this run, everything" — otherwise task-level
  // routing in the file silently wins and the flag looks broken.
  it('replaces a section outright when a flag overrides it', () => {
    const user = write('user.json', { tasks: { sceneDraft: { provider: 'codex' } } });
    const workspace = write('workspace.json', {});

    const configuration = createFileConfiguration(user, workspace, {
      defaultProvider: 'mock',
      tasks: {},
    });

    expect(configuration.get('tasks', { sceneDraft: {} })).toEqual({});
    expect(configuration.get('defaultProvider', undefined)).toBe('mock');
  });
});
