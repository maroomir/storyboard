import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ParsedArguments } from '@/cliArguments';
import { commands } from '@/commands';
import { collectHiddenProviderChecks } from '@/commands/hiddenProvider';
import { signIn, signOut } from '@/commands/login';
import { runConfigSet, runDoctor, runSetup } from '@/commands/setup';
import { createCliContainer } from '@/container';

import { createAuthorizationServer, jsonResponse } from './fixtures/chatGptAuthServer';

const enabledKey = 'providers.chatgpt.enabled';

let home: string;
let workspace: string;
let warnings: string[];

function args(
  positionals: string[] = [],
  flags: Record<string, string | boolean> = {},
): ParsedArguments {
  return { path: [], flags, positionals };
}

function container(canPrompt = false): ReturnType<typeof createCliContainer> {
  return createCliContainer({
    workspacePath: workspace,
    logger: {
      info: () => undefined,
      warn: (message: string) => warnings.push(message),
      error: () => undefined,
      show: () => undefined,
    },
    canPrompt,
    version: '0.0.0',
  });
}

function writeHome(settings: Record<string, unknown>): void {
  writeFileSync(join(home, 'config.json'), JSON.stringify(settings));
}

function readSecrets(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(join(home, 'secrets.json'), 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'storyboard-login-home-'));
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-login-ws-'));
  warnings = [];
  vi.stubEnv('STORYBOARD_HOME', home);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe('storyboard login', () => {
  it('does not know the provider while the switch is off', async () => {
    const outcome = await commands.login?.({ container: container(), args: args(['chatgpt']) });

    expect(outcome?.ok).toBe(false);
    expect(outcome?.message).toContain('모르는 프로바이더입니다: chatgpt');
    expect(readSecrets()).toEqual({});
  });

  it('says there is nothing to log into when no such provider is on', async () => {
    const outcome = await commands.login?.({ container: container(), args: args() });

    expect(outcome?.ok).toBe(false);
    expect(outcome?.message).toBe('로그인으로 연결하는 프로바이더가 없습니다.');
  });

  it('sends an API-key provider to apikey set', async () => {
    const outcome = await commands.login?.({ container: container(), args: args(['claude']) });

    expect(outcome?.ok).toBe(false);
    expect(outcome?.message).toContain('storyboard apikey set claude');
  });

  it('logs in through the browser, stores the session and confirms the connection', async () => {
    writeHome({ [enabledKey]: true });
    const server = createAuthorizationServer();
    const shown: string[] = [];
    const stderrWrite = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        shown.push(String(chunk));
        return true;
      });

    try {
      const outcome = await signIn(container(), 'chatgpt', {
        fetch: server.fetchImpl,
        preferredPort: 0,
        openBrowser: async (url) => {
          void server.browser(url);
          return false;
        },
      });

      expect(outcome.ok).toBe(true);
      expect(outcome.message).toContain('chatgpt 에 로그인했습니다 (writer@example.com)');
      expect(outcome.message).toContain(join(home, 'secrets.json'));
      expect(outcome.data).toMatchObject({ providerId: 'chatgpt', verified: true });
    } finally {
      stderrWrite.mockRestore();
    }

    expect(shown.join('')).toContain('브라우저를 열 수 없습니다');
    expect(shown.join('')).toMatch(/https:\/\/auth\.openai\.com\/api\/accounts\/authorize\?/);

    const stored = JSON.parse(readSecrets()['storyboard.oauth.chatgpt'] ?? '{}') as {
      registration?: { clientId?: string };
      tokens?: { accessToken?: string };
    };
    expect(stored.registration?.clientId).toBe('oaiapp_new');
    expect(stored.tokens?.accessToken).toBe('access-new');
  });

  it('reports a declined login as a failure and stores nothing', async () => {
    writeHome({ [enabledKey]: true });
    const server = createAuthorizationServer();
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      const outcome = await signIn(container(), 'chatgpt', {
        fetch: server.fetchImpl,
        preferredPort: 0,
        openBrowser: async (url) => {
          void server.browser(url, 'deny');
          return true;
        },
      });

      expect(outcome.ok).toBe(false);
      expect(outcome.message).toContain('허용하지 않았습니다');
    } finally {
      stderrWrite.mockRestore();
    }

    expect(readSecrets()).toEqual({});
  });
});

describe('storyboard logout', () => {
  it('ends the session and keeps the registration for the next login', async () => {
    writeHome({ [enabledKey]: true });
    const server = createAuthorizationServer();
    const current = container();
    await current.secretStore.setOAuthConnection('chatgpt', {
      hostId: 'urn:uuid:host-1',
      registration: { clientId: 'oaiapp_1', subject: 'user-1' },
      tokens: {
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: '2026-10-24T10:00:00.000Z',
        scopes: [],
      },
    });

    const outcome = await signOut(current, 'chatgpt', { fetch: server.fetchImpl });

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toBe('chatgpt 에서 로그아웃했습니다.');
    expect(await current.secretStore.getOAuthConnection('chatgpt')).toEqual({
      hostId: 'urn:uuid:host-1',
      registration: { clientId: 'oaiapp_1', subject: 'user-1' },
    });

    const again = await commands.logout?.({ container: current, args: args(['chatgpt']) });
    expect(again?.ok).toBe(true);
    expect(again?.message).toContain('로그인돼 있지 않았습니다');
  });
});

describe('apikey show with a login provider', () => {
  it('lists the login beside the keys, never the token', async () => {
    writeHome({ [enabledKey]: true });
    const current = container();
    await current.secretStore.setOAuthConnection('chatgpt', {
      hostId: 'urn:uuid:host-1',
      registration: { clientId: 'oaiapp_1', subject: 'user-1', email: 'writer@example.com' },
      tokens: {
        accessToken: 'secret-access-token',
        refreshToken: 'secret-refresh-token',
        expiresAt: '2026-10-24T10:00:00.000Z',
        scopes: [],
      },
    });

    const outcome = await commands['apikey show']?.({ container: current, args: args() });

    expect(outcome?.ok).toBe(true);
    expect(outcome?.message).toContain('chatgpt  로그인됨 (writer@example.com)');
    expect(outcome?.message).not.toContain('secret-');
    expect(outcome?.message).not.toContain('oaiapp_1');

    await signOut(current, 'chatgpt', { fetch: createAuthorizationServer().fetchImpl });
    const after = await commands['apikey show']?.({ container: current, args: args() });
    expect(after?.message).toContain('chatgpt  로그인 안 됨');
  });

  it('shows no login section while the switch is off', async () => {
    const outcome = await commands['apikey show']?.({ container: container(), args: args() });

    expect(outcome?.message).not.toContain('로그인');
  });
});

describe('switching the login provider on', () => {
  it('needs no risk notice: the switch turns on at once and the next step is the login', async () => {
    const outcome = await runConfigSet({
      container: container(),
      args: args([enabledKey, 'true']),
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain('다음: storyboard login chatgpt');
    expect(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'))).toEqual({
      providers: { chatgpt: { enabled: true } },
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('미리보기');
  });

  it('refuses the executable keys for it', async () => {
    writeHome({ [enabledKey]: true });

    const outcome = await runConfigSet({
      container: container(),
      args: args(['providers.chatgpt.command', '/opt/x']),
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('알 수 없는 설정 키');
  });
});

describe('setup and doctor with the login provider', () => {
  it('saves the default and names the login command when nobody can log in now', async () => {
    writeHome({ [enabledKey]: true });

    const outcome = await runSetup({
      container: container(),
      args: args([], { provider: 'chatgpt', global: true }),
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain('기본 프로바이더를 chatgpt 로 저장했습니다');
    expect(outcome.message).toContain('storyboard login chatgpt');
  });

  it('fails doctor with the login fix and the preview note while signed out', async () => {
    writeHome({ [enabledKey]: true, 'ai.provider.default': 'chatgpt' });

    const outcome = await runDoctor({ container: container(), args: args() });

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('미리보기');
    expect(outcome.message).toContain('실행 예산');
    expect(outcome.message).toContain('로그인돼 있지 않습니다');
    expect(outcome.message).toContain('storyboard login chatgpt');
  });

  it('passes doctor when signed in and warns when the model is not in the account list', async () => {
    writeHome({
      [enabledKey]: true,
      'ai.provider.default': 'chatgpt',
      'providers.chatgpt.model': 'gpt-6-sol',
    });
    const current = container();
    await current.secretStore.setOAuthConnection('chatgpt', {
      hostId: 'urn:uuid:host-1',
      registration: { clientId: 'oaiapp_1', subject: 'user-1', email: 'writer@example.com' },
      tokens: {
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        scopes: [],
      },
    });
    const listing = (slugs: string[]) => async () =>
      jsonResponse({
        models: slugs.map((slug) => ({ slug, display_name: slug, visibility: 'list' })),
      });

    const offered = await collectHiddenProviderChecks(current, 'chatgpt', listing(['gpt-6-sol']));
    expect(offered.map((check) => [check.status, check.label])).toEqual([
      ['info', '미리보기'],
      ['ok', '로그인'],
    ]);
    expect(offered[1]?.detail).toContain('writer@example.com');

    const missing = await collectHiddenProviderChecks(current, 'chatgpt', listing(['gpt-6.1-sol']));
    expect(missing.map((check) => [check.status, check.label])).toEqual([
      ['info', '미리보기'],
      ['ok', '로그인'],
      ['warn', '모델'],
    ]);
    expect(missing[2]?.detail).toContain(
      'gpt-6-sol 이 이 계정의 모델 목록에 없습니다 (gpt-6.1-sol)',
    );

    const rejected = await collectHiddenProviderChecks(current, 'chatgpt', async () =>
      jsonResponse({ detail: 'not admitted' }, 401),
    );
    expect(rejected[1]).toMatchObject({
      status: 'fail',
      label: '로그인',
      fix: 'storyboard login chatgpt',
    });
  });
});
