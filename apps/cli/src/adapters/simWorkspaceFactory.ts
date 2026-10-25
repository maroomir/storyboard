import { draftPath, scenePath } from '@storyboard/story-model';
import type { UsageRecord } from '@storyboard/story-model';
import { TunedConfigBridge } from '@storyboard/story-sim';
import type {
  ISimWorkspaceFactory,
  SceneGenerationOutcome,
  SimSceneGenerator,
} from '@storyboard/story-sim';

import { createCliContainer, type CliContainer, type CliContainerOptions } from '@/container';
import type { GenerateDraftResult } from '@storyboard/story-engine';

const shouldUpdateCardsInBackgroundDuringMeasurement: boolean = false;
const shouldBypassDraftCacheSoEveryRunCallsAi: boolean = true;

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

      const container: CliContainer = createCliContainer({
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
        postGenerationUpdates: shouldUpdateCardsInBackgroundDuringMeasurement,
      });

      return {
        workspacePath: input.workspacePath,
        generate: async (sceneStem: string): Promise<SceneGenerationOutcome> => {
          const draftGeneration: GenerateDraftResult = await container.drafts.generate({
            sceneUri: scenePath(container.workspaceRoot, sceneStem),
            force: shouldBypassDraftCacheSoEveryRunCallsAi,
          });

          if (!draftGeneration.ok) {
            return {
              ok: false,
              kind: draftGeneration.kind,
              ...(draftGeneration.kind === 'failed' ? { message: draftGeneration.message } : {}),
              warnings: [],
            };
          }

          return {
            ok: true,
            kind: draftGeneration.kind,
            warnings: draftGeneration.kind === 'generated' ? draftGeneration.warnings : [],
          };
        },
        drainUsage: (): readonly UsageRecord[] => {
          const drained: UsageRecord[] = pending;
          pending = [];
          return drained;
        },
        readDraft: async (sceneStem: string): Promise<string> => {
          const bytes: Uint8Array = await container.fileSystem.readFile(
            draftPath(container.workspaceRoot, sceneStem),
          );
          return new TextDecoder().decode(bytes);
        },
      };
    },
  };
}
