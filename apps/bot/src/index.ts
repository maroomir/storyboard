import packageJson from '../package.json';

import { parseCommandLine, usageText } from './app/commandLine';
import { runDoctor } from './app/runDoctor';
import { runSetup } from './app/runSetup';
import { StoryboardBotApplication } from './app/storyboardBotApplication';
import { ConfigError, loadConfig } from './config/config';
import { resolvePaths } from './config/paths';
import { createLogger, type Logger } from './util/logger';
import { WorkspaceError } from './workspace/workspaceStore';

const SHUTDOWN_TIMEOUT_MS = 15_000;

async function main(): Promise<number> {
  const command = parseCommandLine(process.argv.slice(2));

  switch (command.kind) {
    case 'help':
      process.stdout.write(`${usageText}\n`);
      return 0;
    case 'version':
      process.stdout.write(`${packageJson.version}\n`);
      return 0;
    case 'setup':
      return runSetup();
    case 'doctor':
      return runDoctor();
    case 'unknown':
      process.stderr.write(`error: 알 수 없는 명령: ${command.argument}\n\n${usageText}\n`);
      return 1;
    case 'run':
      break;
  }

  const logger = createLogger();
  const paths = resolvePaths();

  let loaded;
  try {
    loaded = loadConfig(paths.configFile);
  } catch (error) {
    if (error instanceof ConfigError) {
      // A first run has no config yet, which is onboarding rather than a fault; a config that
      // exists but is broken stays an error the operator must read.
      if (error.code === 'not-found') {
        process.stderr.write(onboardingText(paths.configFile));
        return 1;
      }
      logger.error(`설정을 불러오지 못했습니다 (${error.code}): ${error.message}`);
      return 1;
    }
    throw error;
  }

  for (const warning of loaded.warnings) {
    logger.warn(warning);
  }

  const application = new StoryboardBotApplication({
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

function onboardingText(configFile: string): string {
  return [
    `설정이 아직 없습니다: ${configFile}`,
    '',
    '  storyboard-bot setup    토큰·허용 chat id·워크스페이스를 묻고 파일을 만듭니다',
    '',
    '직접 쓰려면 config.example.json 을 복사해 0600 으로 두세요.',
    '',
  ].join('\n');
}

// A shutdown must be forceable and must not lie about its outcome: a second signal exits
// immediately, a hung stop() is bounded by a timeout, and any failure exits non-zero so launchd
// sees the truth.
function installShutdownHandlers(application: StoryboardBotApplication, logger: Logger): void {
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
