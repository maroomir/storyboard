import { registerAssembleManuscriptCommand } from '../../commands/assembleManuscript';
import { registerExportManuscriptCommand } from '../../commands/exportManuscript';
import { registerGenerateNovelCommand } from '../../commands/generateNovel';
import { registerGenerateOutlineCommand } from '../../commands/generateOutline';
import { registerGenerateSceneSeedsCommand } from '../../commands/generateSceneSeeds';
import { registerReviewManuscriptCommand } from '../../commands/reviewManuscript';
import { registerSummarizeChaptersCommand } from '../../commands/summarizeChapters';

import { DisposableStore } from '../lifecycle/disposableStore';
import type { IApplicationModule } from '../lifecycle/applicationModule';
import type { IPlatformServices } from './platformModule';

export class NovelModule implements IApplicationModule {
  private readonly disposables = new DisposableStore();

  public constructor(private readonly platform: IPlatformServices) {}

  public initialize(): void {
    const {
      assembleManuscriptUseCase,
      exportManuscriptUseCase,
      generateOutlineUseCase,
      logger,
      novelPipeline,
      reviewManuscriptUseCase,
      summarizeChaptersUseCase,
    } = this.platform;

    this.disposables.add(
      registerGenerateOutlineCommand({ generateOutlineUseCase, logger }),
      registerGenerateSceneSeedsCommand(),
      registerAssembleManuscriptCommand({ assembleManuscriptUseCase, logger }),
      registerReviewManuscriptCommand({ logger, reviewManuscriptUseCase }),
      registerSummarizeChaptersCommand({ logger, summarizeChaptersUseCase }),
      registerGenerateNovelCommand({ novelPipeline }),
      registerExportManuscriptCommand({ exportManuscriptUseCase, logger }),
    );
  }

  public dispose(): void {
    this.disposables.dispose();
  }
}
