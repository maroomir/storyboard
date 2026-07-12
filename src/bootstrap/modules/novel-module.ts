import { registerAssembleManuscriptCommand } from '../../commands/assembleManuscript';
import { registerExportManuscriptCommand } from '../../commands/exportManuscript';
import { registerGenerateNovelCommand } from '../../commands/generateNovel';
import { registerGenerateOutlineCommand } from '../../commands/generateOutline';
import { registerGenerateSceneSeedsCommand } from '../../commands/generateSceneSeeds';
import { registerReviewManuscriptCommand } from '../../commands/reviewManuscript';
import { registerSummarizeChaptersCommand } from '../../commands/summarizeChapters';

import { DisposableStore } from '../lifecycle/disposable-store';
import type { IApplicationModule } from '../lifecycle/application-module';
import type { IPlatformServices } from './platform-module';

export class NovelModule implements IApplicationModule {
  private readonly disposables = new DisposableStore();

  public constructor(private readonly platform: IPlatformServices) {}

  public initialize(): void {
    const { aiProviderRegistry, logger, novelPipeline, usageRecorder } = this.platform;

    this.disposables.add(
      registerGenerateOutlineCommand({ aiProviderRegistry, logger, usageRecorder }),
      registerGenerateSceneSeedsCommand(),
      registerAssembleManuscriptCommand({ logger }),
      registerReviewManuscriptCommand({ aiProviderRegistry, logger }),
      registerSummarizeChaptersCommand({ aiProviderRegistry, logger }),
      registerGenerateNovelCommand({ novelPipeline }),
      registerExportManuscriptCommand({ logger }),
    );
  }

  public dispose(): void {
    this.disposables.dispose();
  }
}
