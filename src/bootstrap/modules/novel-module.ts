import * as vscode from 'vscode';

import { registerAssembleManuscriptCommand } from '../../commands/assembleManuscript';
import { registerExportManuscriptCommand } from '../../commands/exportManuscript';
import { registerGenerateNovelCommand } from '../../commands/generateNovel';
import { registerGenerateOutlineCommand } from '../../commands/generateOutline';
import { registerGenerateSceneSeedsCommand } from '../../commands/generateSceneSeeds';
import { registerReviewManuscriptCommand } from '../../commands/reviewManuscript';
import { registerSummarizeChaptersCommand } from '../../commands/summarizeChapters';

import type { IApplicationModule } from '../lifecycle/application-module';
import type { IPlatformServices } from './platform-module';

export class NovelModule implements IApplicationModule {
  private disposables: vscode.Disposable[] = [];

  public constructor(private readonly platform: IPlatformServices) {}

  public initialize(): void {
    const { aiProviderRegistry, configBridge, logger, postGenerationUpdates, usageRecorder } =
      this.platform;

    this.disposables.push(
      registerGenerateOutlineCommand({ aiProviderRegistry, logger, usageRecorder }),
      registerGenerateSceneSeedsCommand(),
      registerAssembleManuscriptCommand({ logger }),
      registerReviewManuscriptCommand({ aiProviderRegistry, logger }),
      registerSummarizeChaptersCommand({ aiProviderRegistry, logger }),
      registerGenerateNovelCommand({
        aiProviderRegistry,
        configBridge,
        logger,
        postGenerationUpdates,
        usageRecorder,
      }),
      registerExportManuscriptCommand({ logger }),
    );
  }

  public dispose(): void {
    for (const disposable of this.disposables.splice(0).reverse()) {
      disposable.dispose();
    }
  }
}
