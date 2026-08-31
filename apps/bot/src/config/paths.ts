import { homedir } from 'node:os';
import { join } from 'node:path';

export interface BotPaths {
  readonly home: string;
  readonly configFile: string;
  readonly stateDb: string;
}

// Expands a leading `~` / `~/` to the home directory. Node's fs does not do shell tilde expansion,
// so a config value like "~/story/novel" would otherwise create a literal "~" directory in the CWD.
// `~user` is left untouched (we do not resolve other users' homes).
export function expandHome(path: string): string {
  if (path === '~') {
    return homedir();
  }
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

// Resolves the storyboard-bot home directory and the files inside it. STORYBOARD_HOME overrides the
// default (~/.storyboard) so tests and alternate installs can point elsewhere. Story content does
// NOT live here — it lives in the Storyboard workspace named by `workspace.path`. The home is
// shared with the other Storyboard apps, so every file this app owns carries a `bot` prefix.
export function resolvePaths(env: NodeJS.ProcessEnv = process.env): BotPaths {
  const override = env.STORYBOARD_HOME?.trim();
  const home = override ? expandHome(override) : join(homedir(), '.storyboard');

  return {
    home,
    configFile: join(home, 'bot.json'),
    stateDb: join(home, 'bot-state.db'),
  };
}
