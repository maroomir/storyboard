import { homedir } from 'node:os';
import { join } from 'node:path';

export interface CliPaths {
  readonly home: string;
  readonly configFile: string;
  readonly secretsFile: string;
}

// The Storyboard home is shared with the other apps, so every file this one owns carries a `cli`
// prefix. STORYBOARD_HOME moves the whole directory, which is what tests and alternate installs use.
export function resolveCliPaths(env: NodeJS.ProcessEnv = process.env): CliPaths {
  const override = env.STORYBOARD_HOME?.trim();
  const home = override && override.length > 0 ? override : join(homedir(), '.storyboard');

  return {
    home,
    configFile: join(home, 'cli.json'),
    secretsFile: join(home, 'cli-secrets.json'),
  };
}
