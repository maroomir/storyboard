import { join } from 'node:path';

import { expandHome, resolveStoryboardHome } from '@storyboard/story-config';

export { expandHome };

export interface BotPaths {
  readonly home: string;
  readonly configFile: string;
  readonly stateDb: string;
}

// The Storyboard home is shared with the other apps (config.json, secrets.json live there), so the
// files this app owns carry a `bot` prefix. Story content does NOT live here — it lives in the
// workspace named by `workspace.path`.
export function resolvePaths(env: NodeJS.ProcessEnv = process.env): BotPaths {
  const home = resolveStoryboardHome(env);

  return {
    home,
    configFile: join(home, 'bot.json'),
    stateDb: join(home, 'bot-state.db'),
  };
}
