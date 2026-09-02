import { accessSync, constants } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// Mirrors what a shell would do for `codex` or `/opt/codex`: absolute paths are checked as-is,
// bare names are searched along PATH.
export function findExecutableOnPath(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (isAbsolute(command)) {
    return isExecutable(command) ? command : undefined;
  }

  for (const directory of (env.PATH ?? '').split(delimiter).filter((entry) => entry.length > 0)) {
    const candidate = join(directory, command);

    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return undefined;
}
