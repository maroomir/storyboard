import { homedir } from 'node:os';
import { join } from 'node:path';

export interface StorygramPaths {
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

// Resolves the storygram home directory and the files inside it. STORYGRAM_HOME overrides the
// default (~/.storygram) so tests and alternate installs can point elsewhere. Story content does
// NOT live here — it lives in the Storyboard workspace named by `workspace.path`.
export function resolvePaths(env: NodeJS.ProcessEnv = process.env): StorygramPaths {
  const override = env.STORYGRAM_HOME?.trim();
  const home = override ? expandHome(override) : join(homedir(), '.storygram');

  return {
    home,
    configFile: join(home, 'config.json'),
    stateDb: join(home, 'state.db'),
  };
}
