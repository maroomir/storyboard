import { registerAssembleManuscriptCommand } from '../../presentation/commands/assembleManuscript';
import { registerExportManuscriptCommand } from '../../presentation/commands/exportManuscript';
import { registerGenerateNovelCommand } from '../../presentation/commands/generateNovel';
import { registerGenerateOutlineCommand } from '../../presentation/commands/generateOutline';
import { registerGenerateSceneSeedsCommand } from '../../presentation/commands/generateSceneSeeds';
import { registerReviewManuscriptCommand } from '../../presentation/commands/reviewManuscript';
import { registerSummarizeChaptersCommand } from '../../presentation/commands/summarizeChapters';

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
      novelRunStateRepository,
      reviewManuscriptUseCase,
      summarizeChaptersUseCase,
    } = this.platform;

    this.disposables.add(
      registerGenerateOutlineCommand({ generateOutlineUseCase, logger }),
      registerGenerateSceneSeedsCommand(),
      registerAssembleManuscriptCommand({ assembleManuscriptUseCase, logger }),
      registerReviewManuscriptCommand({ logger, reviewManuscriptUseCase }),
      registerSummarizeChaptersCommand({ logger, summarizeChaptersUseCase }),
      registerGenerateNovelCommand({ novelPipeline, novelRunStateRepository }),
      registerExportManuscriptCommand({ exportManuscriptUseCase, logger }),
    );
  }

  public dispose(): void {
    this.disposables.dispose();
  }
}
