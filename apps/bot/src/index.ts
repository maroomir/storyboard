import { ConfigError, loadConfig } from './config/config';
import { resolvePaths } from './config/paths';
import { createLogger } from './util/logger';
import { WorkspaceError, WorkspaceStore } from './workspace/workspaceStore';

// Boot preflight: prove the config parses and the configured directory really is a Storyboard
// workspace before anything starts polling Telegram or touching git.
async function main(): Promise<number> {
  const logger = createLogger();
  const paths = resolvePaths();

  let config;
  try {
    config = loadConfig(paths.configFile);
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.error(`설정을 불러오지 못했습니다 (${error.code}): ${error.message}`);
      return 1;
    }
    throw error;
  }

  for (const warning of config.warnings) {
    logger.warn(warning);
  }

  const store = new WorkspaceStore(config.config.workspace.path);
  try {
    await store.assertIsWorkspace();
  } catch (error) {
    if (error instanceof WorkspaceError) {
      logger.error(error.message);
      return 1;
    }
    throw error;
  }

  const project = await store.readProject();
  const cards = await store.listCards();
  const scenes = await store.listScenes();

  logger.info(
    `워크스페이스 준비 완료: ${project.value.name} (카드 ${cards.length}개, 씬 ${scenes.length}개) @ ${store.root}`,
  );

  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    createLogger().error('예기치 못한 오류로 종료합니다.', error);
    process.exitCode = 1;
  });
