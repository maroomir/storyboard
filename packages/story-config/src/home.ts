import { homedir } from 'node:os';
import { join } from 'node:path';

export interface StoryboardHomePaths {
  readonly home: string;
  readonly configFile: string;
  readonly secretsFile: string;
  readonly usageDirectory: string;
  readonly cacheDirectory: string;
}

const workspaceConfigRelativePath: string = '.storyboard/config.json';

export function expandHome(path: string): string {
  if (path === '~') {
    return homedir();
  }

  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }

  return path;
}

export function resolveStoryboardHome(env: NodeJS.ProcessEnv = process.env): string {
  const override: string | undefined = env.STORYBOARD_HOME?.trim();

  return override && override.length > 0 ? expandHome(override) : join(homedir(), '.storyboard');
}

export function resolveStoryboardHomePaths(
  env: NodeJS.ProcessEnv = process.env,
): StoryboardHomePaths {
  const home: string = resolveStoryboardHome(env);

  return {
    home,
    configFile: join(home, 'config.json'),
    secretsFile: join(home, 'secrets.json'),
    usageDirectory: join(home, 'usage'),
    cacheDirectory: join(home, 'cache'),
  };
}

export function resolveWorkspaceConfigFile(workspaceRoot: string): string {
  return join(workspaceRoot, workspaceConfigRelativePath);
}
