import { resolveStoryboardHomePaths, type StoryboardHomePaths } from '@storyboard/story-config';

export interface CliPaths {
  readonly home: string;
  readonly configFile: string;
  readonly secretsFile: string;
}

export function resolveCliPaths(env: NodeJS.ProcessEnv = process.env): CliPaths {
  const shared: StoryboardHomePaths = resolveStoryboardHomePaths(env);

  return {
    home: shared.home,
    configFile: shared.configFile,
    secretsFile: shared.secretsFile,
  };
}
