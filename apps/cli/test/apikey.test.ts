import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ParsedArguments } from '../src/cliArguments';
import { commands } from '../src/commands/index';
import { createCliContainer } from '../src/container';

// 키는 값이 아니라 «있음/없음» 만 보여야 한다. 어디에도 값이 찍히면 안 된다.

const silentLogger = { info: (): void => {}, warn: (): void => {}, error: (): void => {} };

function args(path: string[], positionals: string[] = []): ParsedArguments {
  return { path, flags: {}, positionals };
}

describe('apikey show', () => {
  let home: string;
  let workspace: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'apikey-home-'));
    workspace = mkdtempSync(join(tmpdir(), 'apikey-ws-'));
    process.env.STORYBOARD_HOME = home;
  });

  afterEach(() => {
    delete process.env.STORYBOARD_HOME;
    rmSync(home, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  });

  it('lists providers by stored-or-not and never prints the key', async () => {
    const container = createCliContainer({
      workspacePath: workspace,
      logger: silentLogger,
      canPrompt: false,
      version: '9.9.9',
    });
    await container.secretStore.setApiKey('claude', 'sk-secret-value');

    const outcome = await commands['apikey show']?.({ container, args: args(['apikey', 'show']) });

    expect(outcome?.ok).toBe(true);
    expect(outcome?.message).toContain('claude  저장됨');
    expect(outcome?.message).toContain('openai  없음');
    expect(outcome?.message).not.toContain('sk-secret-value');
    expect(outcome?.message).not.toContain('ollama');
  });

  it('refuses an unknown provider by name', async () => {
    const container = createCliContainer({
      workspacePath: workspace,
      logger: silentLogger,
      canPrompt: false,
      version: '9.9.9',
    });

    const outcome = await commands['apikey set']?.({ container, args: args(['apikey', 'set'], ['nope']) });

    expect(outcome?.ok).toBe(false);
    expect(outcome?.message).toContain('모르는 프로바이더');
  });
});
