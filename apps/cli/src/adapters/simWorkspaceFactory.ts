import { draftPath, scenePath } from '@storyboard/story-engine';
import type { UsageRecord } from '@storyboard/story-ai';
import { TunedConfigBridge } from '@storyboard/story-sim';
import type { ISimWorkspaceFactory, SimSceneGenerator } from '@storyboard/story-sim';

import { createCliContainer, type CliContainerOptions } from '@/container';

// 측정 실행을 제품과 같은 경로에 태운다. 사용자가 `scene generate` 로 밟는 길과 같은 use case 를
// 부르고, 컨테이너가 열어 둔 이음매 셋으로 원장·손잡이·후처리만 갈아끼운다.
export interface SimWorkspaceFactoryOptions {
  readonly logger: CliContainerOptions['logger'];
  readonly version: string;
  readonly provider?: string;
  readonly model?: string;
  readonly localRuntime?: CliContainerOptions['localRuntime'];
  readonly promptVariant?: CliContainerOptions['promptVariant'];
}

export function createSimWorkspaceFactory(
  options: SimWorkspaceFactoryOptions,
): ISimWorkspaceFactory {
  return {
    open: async (input): Promise<SimSceneGenerator> => {
      let pending: UsageRecord[] = [];

      const container = createCliContainer({
        workspacePath: input.workspacePath,
        logger: options.logger,
        canPrompt: false,
        version: options.version,
        ...(options.provider === undefined ? {} : { provider: options.provider }),
        ...(options.model === undefined ? {} : { model: options.model }),
        ...(options.localRuntime === undefined ? {} : { localRuntime: options.localRuntime }),
        ...(options.promptVariant === undefined ? {} : { promptVariant: options.promptVariant }),
        usageSink: {
          record: async (_root, usage): Promise<void> => {
            pending.push(usage);
          },
        },
        createConfigBridge: (dependencies) =>
          new TunedConfigBridge(dependencies, input.tuning, input.sectionOutputLimit),
        // 후처리는 초안 뒤에 카드를 고치는 백그라운드 작업이다. 그 토큰이 다음 씬 측정에 섞이고,
        // 시험체도 회차마다 달라진다.
        postGenerationUpdates: false,
      });

      return {
        workspacePath: input.workspacePath,
        generate: async (sceneStem) => {
          const result = await container.drafts.generate({
            sceneUri: scenePath(container.workspaceRoot, sceneStem),
            // 캐시를 맞으면 AI 호출이 0회라 회차가 아무것도 재지 못한다.
            force: true,
          });

          if (!result.ok) {
            return {
              ok: false,
              kind: result.kind,
              ...(result.kind === 'failed' ? { message: result.message } : {}),
              warnings: [],
            };
          }

          return {
            ok: true,
            kind: result.kind,
            warnings: result.kind === 'generated' ? result.warnings : [],
          };
        },
        drainUsage: () => {
          const drained = pending;
          pending = [];
          return drained;
        },
        readDraft: async (sceneStem) => {
          const bytes = await container.fileSystem.readFile(
            draftPath(container.workspaceRoot, sceneStem),
          );
          return new TextDecoder().decode(bytes);
        },
      };
    },
  };
}
