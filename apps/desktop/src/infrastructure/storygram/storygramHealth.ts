import { readStorygramDashboardTarget, resolveStorygramPaths } from './storygramConfigFile';

export type StorygramHealth =
  | { readonly status: 'unconfigured' }
  | { readonly status: 'dashboard-disabled' }
  | { readonly status: 'offline'; readonly port: number }
  | {
      readonly status: 'online';
      readonly port: number;
      readonly projectName: string;
      readonly syncState: string;
    };

export interface StorygramHealthDeps {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchFn?: typeof fetch;
}

const HEALTH_REQUEST_TIMEOUT_MS = 2_000;

export async function checkStorygramHealth(
  deps: StorygramHealthDeps = {},
): Promise<StorygramHealth> {
  const { configFile } = resolveStorygramPaths(deps.env ?? process.env);
  const target = await readStorygramDashboardTarget(configFile);
  if (target === undefined) {
    return { status: 'unconfigured' };
  }
  if (!target.enabled) {
    return { status: 'dashboard-disabled' };
  }

  const fetchFn = deps.fetchFn ?? fetch;
  try {
    const response = await fetchFn(`http://127.0.0.1:${target.port}/api/workspace`, {
      signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { status: 'offline', port: target.port };
    }

    const body = (await response.json()) as { name?: unknown; syncState?: unknown };
    return {
      status: 'online',
      port: target.port,
      projectName: typeof body.name === 'string' ? body.name : '?',
      syncState: typeof body.syncState === 'string' ? body.syncState : '?',
    };
  } catch {
    return { status: 'offline', port: target.port };
  }
}
