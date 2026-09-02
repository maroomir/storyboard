import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import { z, ZodError } from 'zod';

import { expandHome } from './paths';

const telegramConfigSchema = z.object({
  botToken: z.string().trim().min(1),
  allowedChatIds: z.array(z.number().int()).default([]),
  allowedUserIds: z.array(z.number().int()).default([]),
});

// The Storyboard workspace this bot edits. `path` points at the very same directory the VSCode
// extension opens — there is no clone and no separate copy. `remote` is optional: with no remote,
// saving still commits locally and `/sync` reports `no-remote` without touching the network.
const workspaceConfigSchema = z.object({
  path: z
    .string()
    .trim()
    .min(1)
    .transform(expandHome)
    .refine(isAbsolute, { message: '워크스페이스 경로는 절대 경로여야 합니다.' }),
  remote: z.string().trim().min(1).optional(),
  pushDebounceSec: z.number().int().positive().default(30),
  syncIntervalSec: z.number().int().positive().default(300),
});

// Slim provider selection. The AI engine itself lives in @storyboard/story-ai; this block only
// chooses which provider and model it runs with. The bot is CLI-only by decision #22/#33: API-key
// providers are rejected here with a clear message instead of failing at job time, and every
// section is strict so a typo or an unsupported field errors loudly instead of being silently
// stripped (blind-pass B5/M1/M2/M3).
const botProviderIds = ['mock', 'claude-code', 'codex'] as const;

const botProviderIdSchema = z.enum(botProviderIds, {
  message: `프로바이더는 CLI 전용입니다: ${['mock', 'claude-code', 'codex'].join(', ')} (openai·claude·google은 봇에서 지원하지 않습니다)`,
});

const providerSectionSchema = z.strictObject({
  model: z.string().trim().min(1).optional(),
  command: z.string().trim().min(1).optional(),
  timeoutMs: z.number().int().positive().optional(),
  reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
});

const taskEntrySchema = z.union([
  botProviderIdSchema,
  z.strictObject({
    provider: botProviderIdSchema,
    model: z.string().trim().min(1).optional(),
  }),
]);

const providersConfigSchema = z.strictObject({
  default: botProviderIdSchema.optional(),
  tasks: z.record(z.string(), taskEntrySchema).optional(),
  models: z.partialRecord(botProviderIdSchema, providerSectionSchema).optional(),
});

// Mirrors the extension's `storyboard.draft.*` settings (decision #31): the revise gate runs after
// every generation unless the operator switches it off.
const draftConfigSchema = z.strictObject({
  reviseAfterGenerate: z.boolean().default(true),
  reviseMaxIterations: z.number().int().min(1).max(5).default(2),
  // Mirrors `storyboard.grounding.autoApprove`, but a queued job cannot stop to ask Telegram for
  // approval, so off means the bot leaves grounding alone instead of prompting.
  autoGrounding: z.boolean().default(true),
});

const privacyConfigSchema = z.object({
  minimizeChatBody: z.boolean().default(false),
});

const jobsConfigSchema = z.object({
  heavyConcurrency: z.number().int().positive().default(1),
  lightConcurrency: z.number().int().positive().default(1),
});

// SECURITY: the dashboard server binds 127.0.0.1 only; `enabled` lets an operator turn it off
// entirely without touching the port.
const dashboardConfigSchema = z.object({
  enabled: z.boolean().default(true),
  port: z.number().int().min(1).max(65535).default(8787),
});

export const configSchema = z.object({
  telegram: telegramConfigSchema,
  workspace: workspaceConfigSchema,
  providers: providersConfigSchema.optional(),
  draft: draftConfigSchema.optional(),
  privacy: privacyConfigSchema.default({ minimizeChatBody: false }),
  jobs: jobsConfigSchema.default({ heavyConcurrency: 1, lightConcurrency: 1 }),
  dashboard: dashboardConfigSchema.default({ enabled: true, port: 8787 }),
});

export type ProvidersConfig = z.infer<typeof providersConfigSchema>;
export type DraftConfig = z.infer<typeof draftConfigSchema>;
export type JobsConfig = z.infer<typeof jobsConfigSchema>;
export type BotConfig = z.infer<typeof configSchema>;

export type ConfigErrorCode = 'not-found' | 'invalid-json' | 'invalid-schema';

export class ConfigError extends Error {
  public constructor(
    public readonly code: ConfigErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface ConfigLoadResult {
  readonly config: BotConfig;
  readonly warnings: readonly string[];
}

export function loadConfig(configPath: string): ConfigLoadResult {
  const raw = readConfigFile(configPath);
  const parsed = parseConfigJson(raw);
  const config = validateConfig(parsed);

  return {
    config,
    warnings: [...collectLegacyWarnings(parsed), ...collectPermissionWarnings(configPath)],
  };
}

// Story content moved back out of the `.seed` archive into the git workspace, so a config written
// for the seed era names a store this build cannot read.
function collectLegacyWarnings(parsed: unknown): string[] {
  if (typeof parsed !== 'object' || parsed === null) {
    return [];
  }

  const warnings: string[] = [];
  // AI selection and draft switches now live in the shared ~/.storyboard/config.json, where the
  // extension and the CLI read them too. The old blocks still apply, as overrides, until moved.
  for (const block of ['providers', 'draft'] as const) {
    if (block in parsed) {
      warnings.push(
        `\`${block}\` 블록은 이제 ~/.storyboard/config.json (또는 워크스페이스의 .storyboard/config.json) 에서 읽습니다. bot.json 의 값이 아직 우선하지만, 옮기면 익스텐션·CLI와 같은 설정을 씁니다.`,
      );
    }
  }
  if ('seed' in parsed) {
    warnings.push(
      '`seed.*` 설정은 더 이상 사용되지 않습니다. 스토리는 이제 `workspace.path`가 가리키는 Storyboard 워크스페이스에 보관됩니다.',
    );
  }

  // A misspelled top-level section would otherwise be stripped without a trace.
  const knownKeys = new Set([
    'telegram',
    'workspace',
    'providers',
    'draft',
    'privacy',
    'jobs',
    'dashboard',
    'seed',
  ]);
  for (const key of Object.keys(parsed)) {
    if (!knownKeys.has(key)) {
      warnings.push(`알 수 없는 설정 항목을 무시합니다: \`${key}\``);
    }
  }

  return warnings;
}

function readConfigFile(configPath: string): string {
  try {
    return readFileSync(configPath, 'utf8');
  } catch (error) {
    throw new ConfigError('not-found', `설정 파일을 읽을 수 없습니다: ${configPath}`, error);
  }
}

function parseConfigJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new ConfigError('invalid-json', '설정 파일 JSON을 파싱할 수 없습니다.', error);
  }
}

function validateConfig(parsed: unknown): BotConfig {
  const result = configSchema.safeParse(parsed);

  if (!result.success) {
    throw new ConfigError('invalid-schema', formatSchemaIssues(result.error), result.error);
  }

  return result.data;
}

function formatSchemaIssues(error: ZodError): string {
  const details = error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');

  return `설정 스키마가 올바르지 않습니다. (${details})`;
}

// SECURITY: the config file holds the bot token, so it should be readable only by its owner
// (mode 0600). We warn rather than fail because filesystem semantics vary; on Windows POSIX
// permission bits are not meaningful. Exported so /doctor reports the same finding the boot check
// logs — an operator who never reads the log still sees it.
export function collectPermissionWarnings(configPath: string): string[] {
  if (process.platform === 'win32') {
    return [];
  }

  let mode: number;
  try {
    mode = statSync(configPath).mode & 0o777;
  } catch {
    return [];
  }

  if ((mode & 0o077) === 0) {
    return [];
  }

  const octal = mode.toString(8).padStart(3, '0');
  return [
    `설정 파일 권한이 0${octal}입니다. 봇 토큰 보호를 위해 \`chmod 600 ${configPath}\`를 권장합니다.`,
  ];
}
