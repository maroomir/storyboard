import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildBotConfig,
  fetchTelegramBotUsername,
  isPlausibleBotToken,
  parseChatIds,
  sendTelegramTestMessage,
  writeBotConfigFile,
} from '../src/config/setup';

describe('parseChatIds', () => {
  it('parses comma or space separated integers, negatives included', () => {
    expect(parseChatIds('123456789')).toEqual([123456789]);
    expect(parseChatIds('123, -100987, 42')).toEqual([123, -100987, 42]);
    expect(parseChatIds(' 123 456 ')).toEqual([123, 456]);
  });

  it('rejects empty and non-integer input', () => {
    expect(parseChatIds('')).toBeUndefined();
    expect(parseChatIds('  ,  ')).toBeUndefined();
    expect(parseChatIds('abc')).toBeUndefined();
    expect(parseChatIds('123, x')).toBeUndefined();
  });
});

describe('isPlausibleBotToken', () => {
  it('accepts the BotFather token shape and rejects others', () => {
    expect(isPlausibleBotToken('123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw')).toBe(true);
    expect(isPlausibleBotToken('not-a-token')).toBe(false);
    expect(isPlausibleBotToken('123456789:short')).toBe(false);
    expect(isPlausibleBotToken('')).toBe(false);
  });
});

describe('buildBotConfig', () => {
  it('builds the minimal config the bot schema accepts', () => {
    const config = buildBotConfig({
      botToken: '123:token',
      allowedChatIds: [1, 2],
      workspacePath: '/novels/my-novel',
      defaultProvider: 'claude-code',
    });

    expect(config).toEqual({
      telegram: { botToken: '123:token', allowedChatIds: [1, 2] },
      workspace: { path: '/novels/my-novel' },
      providers: { default: 'claude-code' },
    });
  });
});

describe('writeBotConfigFile', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'storyboard-bot-setup-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('creates the home directory and writes the config with mode 0600', async () => {
    const nestedHome = join(home, '.storyboard');
    const configFile = join(nestedHome, 'bot.json');

    await writeBotConfigFile(nestedHome, configFile, { telegram: { botToken: 'x' } });

    expect(JSON.parse(readFileSync(configFile, 'utf8'))).toEqual({
      telegram: { botToken: 'x' },
    });
    if (process.platform !== 'win32') {
      expect(statSync(configFile).mode & 0o777).toBe(0o600);
    }
  });
});

describe('fetchTelegramBotUsername', () => {
  it('returns the username on a valid getMe response', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async (): Promise<unknown> => ({ ok: true, result: { username: 'my_story_bot' } }),
    });

    const username = await fetchTelegramBotUsername(
      '123:token',
      fetchFn as unknown as typeof fetch,
    );

    expect(username).toBe('my_story_bot');
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.telegram.org/bot123:token/getMe',
      expect.anything(),
    );
  });

  it('returns undefined on http errors, telegram errors, and network failures', async () => {
    const notOk = vi.fn().mockResolvedValue({ ok: false });
    const apiError = vi.fn().mockResolvedValue({
      ok: true,
      json: async (): Promise<unknown> => ({ ok: false }),
    });
    const network = vi.fn().mockRejectedValue(new Error('offline'));

    expect(await fetchTelegramBotUsername('t', notOk as unknown as typeof fetch)).toBeUndefined();
    expect(
      await fetchTelegramBotUsername('t', apiError as unknown as typeof fetch),
    ).toBeUndefined();
    expect(await fetchTelegramBotUsername('t', network as unknown as typeof fetch)).toBeUndefined();
  });
});

describe('sendTelegramTestMessage', () => {
  it('posts the message and reports telegram-level success', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async (): Promise<unknown> => ({ ok: true }),
    });

    const sent = await sendTelegramTestMessage(
      '123:token',
      42,
      'hello',
      fetchFn as unknown as typeof fetch,
    );

    expect(sent).toBe(true);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/bot123:token/sendMessage');
    expect(JSON.parse(init.body as string)).toEqual({ chat_id: 42, text: 'hello' });
  });

  it('reports failure on network errors', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('offline'));

    expect(await sendTelegramTestMessage('t', 1, 'x', fetchFn as unknown as typeof fetch)).toBe(
      false,
    );
  });
});
