import { z } from 'zod';

const botProviderIdSchema = z.enum(['mock', 'claude-code', 'codex']);

const botWorkspaceCandidateSchema = z.object({
  path: z.string().min(1),
  hasProject: z.boolean(),
  isConnected: z.boolean(),
});

const botHealthStatusSchema = z.enum(['unconfigured', 'dashboard-disabled', 'offline', 'online']);

// SECURITY: the bot token never crosses this boundary. The read payload carries only a masked hint
// so the panel can show that a token exists, and there is no update method that accepts one —
// changing the token goes through the setup wizard, which verifies it against Telegram first.
export const botConfigReadResponsePayloadSchema = z.object({
  configured: z.boolean(),
  configFile: z.string().min(1),
  tokenHint: z.string().nullable(),
  allowedChatIds: z.array(z.number().int()),
  allowedUserIds: z.array(z.number().int()),
  workspacePath: z.string().nullable(),
  remote: z.string().nullable(),
  defaultProvider: botProviderIdSchema.nullable(),
  dashboardPort: z.number().int().nullable(),
  workspaceCandidates: z.array(botWorkspaceCandidateSchema),
  health: botHealthStatusSchema,
});

export const botConfigReadRequestPayloadSchema = z.object({});

export const botConfigUpdateRequestPayloadSchema = z.object({
  allowedChatIds: z.array(z.number().int()).optional(),
  allowedUserIds: z.array(z.number().int()).optional(),
  workspacePath: z.string().trim().min(1).optional(),
  remote: z.string().trim().min(1).nullable().optional(),
  defaultProvider: botProviderIdSchema.optional(),
});

export const botRestartRequestPayloadSchema = z.object({});

export const botRestartResponsePayloadSchema = z.object({
  status: z.enum(['restarted', 'not-installed', 'unsupported-platform', 'failed']),
  detail: z.string().optional(),
});
