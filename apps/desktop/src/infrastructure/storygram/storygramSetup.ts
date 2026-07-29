import { promises as fs } from 'node:fs';

export const BOT_PROVIDER_IDS = ['claude-code', 'codex', 'mock'] as const;
export type BotProviderId = (typeof BOT_PROVIDER_IDS)[number];

export interface StorygramSetupInput {
  readonly botToken: string;
  readonly allowedChatIds: readonly number[];
  readonly workspacePath: string;
  readonly defaultProvider: BotProviderId;
}

export function parseChatIds(input: string): number[] | undefined {
  const tokens = input
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return undefined;
  }

  const chatIds: number[] = [];
  for (const token of tokens) {
    if (!/^-?\d+$/.test(token)) {
      return undefined;
    }
    chatIds.push(Number(token));
  }
  return chatIds;
}

export function isPlausibleBotToken(token: string): boolean {
  return /^\d+:[A-Za-z0-9_-]{10,}$/.test(token.trim());
}

// Minimal config the bot's strict schema accepts; every omitted section falls back to the bot's
// own defaults, so the wizard never has to chase them.
export function buildStorygramConfig(input: StorygramSetupInput): Record<string, unknown> {
  return {
    telegram: {
      botToken: input.botToken,
      allowedChatIds: [...input.allowedChatIds],
    },
    workspace: {
      path: input.workspacePath,
    },
    providers: {
      default: input.defaultProvider,
    },
  };
}

// SECURITY: the config holds the bot token — the home directory is owner-only (0700) and the file
// is written with mode 0600, matching what the bot's boot check recommends.
export async function writeStorygramConfigFile(
  home: string,
  configFile: string,
  config: Record<string, unknown>,
): Promise<void> {
  await fs.mkdir(home, { recursive: true, mode: 0o700 });
  await fs.writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(configFile, 0o600);
}

const TELEGRAM_REQUEST_TIMEOUT_MS = 10_000;

// SECURITY: the token rides only in the request URL to api.telegram.org (Telegram's own contract);
// it must never appear in logs, error messages, or thrown errors.
export async function fetchTelegramBotUsername(
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<string | undefined> {
  try {
    const response = await fetchFn(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(TELEGRAM_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      return undefined;
    }

    const body = (await response.json()) as {
      ok?: unknown;
      result?: { username?: unknown };
    };
    if (body.ok !== true || typeof body.result?.username !== 'string') {
      return undefined;
    }
    return body.result.username;
  } catch {
    return undefined;
  }
}

export async function sendTelegramTestMessage(
  token: string,
  chatId: number,
  text: string,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(TELEGRAM_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      return false;
    }

    const body = (await response.json()) as { ok?: unknown };
    return body.ok === true;
  } catch {
    return false;
  }
}
