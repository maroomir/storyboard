import { resolveStoryboardHomePaths } from '@storyboard/story-config';

export interface CliPaths {
  readonly home: string;
  readonly configFile: string;
  readonly secretsFile: string;
}

// The extension and the CLI share one config and one secrets file under the Storyboard home.
export function resolveCliPaths(env: NodeJS.ProcessEnv = process.env): CliPaths {
  const shared = resolveStoryboardHomePaths(env);

  return {
    home: shared.home,
    configFile: shared.configFile,
    secretsFile: shared.secretsFile,
  };
}
