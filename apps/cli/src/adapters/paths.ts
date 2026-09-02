import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { resolveStoryboardHomePaths } from '@storyboard/story-config';

export interface CliPaths {
  readonly home: string;
  readonly configFile: string;
  readonly secretsFile: string;
}

// The three apps share one config and one secrets file under the Storyboard home. An install that
// still has the CLI-only `cli.json` / `cli-secrets.json` keeps working from them until the shared
// file exists, and is told once per run to move.
export function resolveCliPaths(
  env: NodeJS.ProcessEnv = process.env,
  warn: (message: string) => void = () => undefined,
): CliPaths {
  const shared = resolveStoryboardHomePaths(env);

  return {
    home: shared.home,
    configFile: preferShared(shared.configFile, join(shared.home, 'cli.json'), warn),
    secretsFile: preferShared(shared.secretsFile, join(shared.home, 'cli-secrets.json'), warn),
  };
}

function preferShared(
  sharedFile: string,
  legacyFile: string,
  warn: (message: string) => void,
): string {
  if (existsSync(sharedFile) || !existsSync(legacyFile)) {
    return sharedFile;
  }

  warn(`${legacyFile} 은 이제 ${sharedFile} 로 통합되었습니다. 파일 이름을 바꿔 주세요.`);
  return legacyFile;
}
