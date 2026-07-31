export type BotProviderId = 'mock' | 'claude-code' | 'codex';

export interface BotConfigView {
  readonly tokenHint: string | null;
  readonly allowedChatIds: number[];
  readonly allowedUserIds: number[];
  readonly workspacePath: string | null;
  readonly remote: string | null;
  readonly defaultProvider: BotProviderId | null;
  readonly dashboardPort: number | null;
}

export interface BotConfigPatch {
  readonly allowedChatIds?: readonly number[];
  readonly allowedUserIds?: readonly number[];
  readonly workspacePath?: string;
  readonly remote?: string | null;
  readonly defaultProvider?: BotProviderId;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function asIntegerArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is number => Number.isInteger(entry))
    : [];
}

function asProviderId(value: unknown): BotProviderId | null {
  return value === 'mock' || value === 'claude-code' || value === 'codex' ? value : null;
}

// SECURITY: the only thing ever derived from the token is this hint — enough to tell one bot from
// another (the numeric id before the colon is public) while the secret half stays in the file.
export function maskBotToken(token: unknown): string | null {
  if (typeof token !== 'string' || token.length === 0) {
    return null;
  }

  const [botId] = token.split(':');
  return botId !== undefined && botId.length > 0 ? `${botId}:••••••` : '••••••';
}

export function readBotConfigView(raw: unknown): BotConfigView {
  const root = asRecord(raw) ?? {};
  const telegram = asRecord(root.telegram) ?? {};
  const workspace = asRecord(root.workspace) ?? {};
  const providers = asRecord(root.providers) ?? {};
  const dashboard = asRecord(root.dashboard) ?? {};

  return {
    tokenHint: maskBotToken(telegram.botToken),
    allowedChatIds: asIntegerArray(telegram.allowedChatIds),
    allowedUserIds: asIntegerArray(telegram.allowedUserIds),
    workspacePath: typeof workspace.path === 'string' ? workspace.path : null,
    remote: typeof workspace.remote === 'string' ? workspace.remote : null,
    defaultProvider: asProviderId(providers.default),
    dashboardPort: typeof dashboard.port === 'number' ? dashboard.port : null,
  };
}

// Merges into the parsed document rather than rebuilding it: the bot config carries sections this
// panel does not edit (providers.models, providers.tasks, draft, jobs, privacy) and dropping them
// on save would silently reset the user's tuning.
export function applyBotConfigPatch(raw: unknown, patch: BotConfigPatch): JsonRecord {
  const root: JsonRecord = { ...(asRecord(raw) ?? {}) };

  if (patch.allowedChatIds !== undefined || patch.allowedUserIds !== undefined) {
    const telegram: JsonRecord = { ...(asRecord(root.telegram) ?? {}) };
    if (patch.allowedChatIds !== undefined) {
      telegram.allowedChatIds = [...patch.allowedChatIds];
    }
    if (patch.allowedUserIds !== undefined) {
      telegram.allowedUserIds = [...patch.allowedUserIds];
    }
    root.telegram = telegram;
  }

  if (patch.workspacePath !== undefined || patch.remote !== undefined) {
    const workspace: JsonRecord = { ...(asRecord(root.workspace) ?? {}) };
    if (patch.workspacePath !== undefined) {
      workspace.path = patch.workspacePath;
    }
    if (patch.remote !== undefined) {
      if (patch.remote === null) {
        delete workspace.remote;
      } else {
        workspace.remote = patch.remote;
      }
    }
    root.workspace = workspace;
  }

  if (patch.defaultProvider !== undefined) {
    const providers: JsonRecord = { ...(asRecord(root.providers) ?? {}) };
    providers.default = patch.defaultProvider;
    root.providers = providers;
  }

  return root;
}
