import { loadSeedkernel } from '@seedkernel/wasm';
import { loadWeeding } from '@weeding/wasm';

import { StorygramApplication } from './app/storygramApplication';
import { ConfigError, loadConfig } from './config/config';
import { resolvePaths } from './config/paths';
import { createLogger, type Logger } from './util/logger';
import { WorkspaceError } from './workspace/workspaceStore';

const SHUTDOWN_TIMEOUT_MS = 15_000;

async function main(): Promise<number> {
  const logger = createLogger();
  const paths = resolvePaths();

  // NOTE: The workspace format engine and diagnostics engine are WebAssembly; load them before
  // any codec or diagnostic runs.
  await loadSeedkernel();
  await loadWeeding();

  let loaded;
  try {
    loaded = loadConfig(paths.configFile);
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.error(`설정을 불러오지 못했습니다 (${error.code}): ${error.message}`);
      return 1;
    }
    throw error;
  }

  for (const warning of loaded.warnings) {
    logger.warn(warning);
  }

  const application = new StorygramApplication({
    config: loaded.config,
    logger,
    stateDbPath: paths.stateDb,
    configFilePath: paths.configFile,
  });

  try {
    await application.start();
  } catch (error) {
    if (error instanceof WorkspaceError) {
      logger.error(error.message);
      return 1;
    }
    throw error;
  }

  installShutdownHandlers(application, logger);
  return 0;
}

// A shutdown must be forceable and must not lie about its outcome: a second signal exits
// immediately, a hung stop() is bounded by a timeout, and any failure exits non-zero so launchd
// sees the truth.
function installShutdownHandlers(application: StorygramApplication, logger: Logger): void {
  let stopping = false;

  const shutdown = (signal: string): void => {
    if (stopping) {
      logger.warn(`${signal} 재수신 — 즉시 종료합니다.`);
      process.exit(130);
    }
    stopping = true;
    logger.info(`${signal} 수신, 종료합니다. (한 번 더 누르면 즉시 종료)`);

    const timeout = setTimeout(() => {
      logger.error(`종료가 ${SHUTDOWN_TIMEOUT_MS / 1000}초 안에 끝나지 않아 강제 종료합니다.`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timeout.unref();

    void application
      .stop()
      .then(() => {
        clearTimeout(timeout);
        process.exit(0);
      })
      .catch((error: unknown) => {
        clearTimeout(timeout);
        logger.error('종료 처리 중 오류가 발생했습니다.', error);
        process.exit(1);
      });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main()
  .then((code) => {
    if (code !== 0) {
      process.exitCode = code;
    }
  })
  .catch((error: unknown) => {
    createLogger().error('예기치 못한 오류로 종료합니다.', error);
    process.exitCode = 1;
  });
