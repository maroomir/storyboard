import { homedir } from 'node:os';
import { join } from 'node:path';

export interface StoryboardHomePaths {
  readonly home: string;
  readonly configFile: string;
  readonly secretsFile: string;
  readonly usageDirectory: string;
  readonly cacheDirectory: string;
  // The author's own prompt wording for every workspace; a workspace's `.storyboard/prompts` wins.
  readonly promptsDirectory: string;
}

export const workspaceConfigRelativePath = '.storyboard/config.json';

// Node's fs does no shell tilde expansion, so a value like "~/story/novel" would otherwise create a
// literal "~" directory in the CWD. `~user` is left untouched.
export function expandHome(path: string): string {
  if (path === '~') {
    return homedir();
  }

  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }

  return path;
}

// STORYBOARD_HOME moves the whole directory, which is what tests and alternate installs use. The
// apps share this directory: one config, one secrets file, one place for usage and caches.
export function resolveStoryboardHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.STORYBOARD_HOME?.trim();

  return override && override.length > 0 ? expandHome(override) : join(homedir(), '.storyboard');
}

export function resolveStoryboardHomePaths(
  env: NodeJS.ProcessEnv = process.env,
): StoryboardHomePaths {
  const home = resolveStoryboardHome(env);

  return {
    home,
    configFile: join(home, 'config.json'),
    secretsFile: join(home, 'secrets.json'),
    usageDirectory: join(home, 'usage'),
    cacheDirectory: join(home, 'cache'),
    promptsDirectory: join(home, 'prompts'),
  };
}

export function resolveWorkspaceConfigFile(workspaceRoot: string): string {
  return join(workspaceRoot, workspaceConfigRelativePath);
}
