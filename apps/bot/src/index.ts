import { StorygramApplication } from './app/storygramApplication';
import { ConfigError, loadConfig } from './config/config';
import { resolvePaths } from './config/paths';
import { createLogger } from './util/logger';
import { WorkspaceError } from './workspace/workspaceStore';

async function main(): Promise<number> {
  const logger = createLogger();
  const paths = resolvePaths();

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

function installShutdownHandlers(
  application: StorygramApplication,
  logger: ReturnType<typeof createLogger>,
): void {
  let stopping = false;

  const shutdown = (signal: string): void => {
    if (stopping) {
      return;
    }
    stopping = true;
    logger.info(`${signal} 수신, 종료합니다.`);
    void application.stop().finally(() => process.exit(0));
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
