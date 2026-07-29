import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface StorygramPaths {
  readonly home: string;
  readonly configFile: string;
}

export const DEFAULT_DASHBOARD_PORT = 8787;

export function expandHome(path: string): string {
  if (path === '~') {
    return homedir();
  }
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

// NOTE: Mirrors apps/bot/src/config/paths.ts so both apps agree on where the bot config lives.
export function resolveStorygramPaths(env: NodeJS.ProcessEnv = process.env): StorygramPaths {
  const override = env.STORYGRAM_HOME?.trim();
  const home = override ? expandHome(override) : join(homedir(), '.storygram');

  return { home, configFile: join(home, 'config.json') };
}

export interface StorygramDashboardTarget {
  readonly enabled: boolean;
  readonly port: number;
}

// Tolerant read: the bot owns strict config validation, the extension only needs to know whether a
// config exists and where the dashboard listens. A config the bot would reject still resolves to
// the default target so the status bar can report the bot as stopped instead of hiding it.
export async function readStorygramDashboardTarget(
  configFile: string,
): Promise<StorygramDashboardTarget | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(configFile, 'utf8');
  } catch {
    return undefined;
  }

  let dashboard: { enabled?: unknown; port?: unknown } | undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    dashboard = (parsed as { dashboard?: { enabled?: unknown; port?: unknown } }).dashboard;
  } catch {
    dashboard = undefined;
  }

  return {
    enabled: typeof dashboard?.enabled === 'boolean' ? dashboard.enabled : true,
    port: typeof dashboard?.port === 'number' ? dashboard.port : DEFAULT_DASHBOARD_PORT,
  };
}
