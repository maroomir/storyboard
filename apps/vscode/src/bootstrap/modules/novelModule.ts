import * as vscode from 'vscode';

import { registerAssembleManuscriptCommand } from '@/presentation/commands/assembleManuscript';
import { registerCompleteStoryScenesCommand } from '@/presentation/commands/completeStoryScenes';
import { registerExportManuscriptCommand } from '@/presentation/commands/exportManuscript';
import { registerGenerateNovelCommand } from '@/presentation/commands/generateNovel';
import { registerGenerateOutlineCommand } from '@/presentation/commands/generateOutline';
import { registerGenerateSceneSeedsCommand } from '@/presentation/commands/generateSceneSeeds';
import { registerReviewManuscriptCommand } from '@/presentation/commands/reviewManuscript';
import { registerSummarizeChaptersCommand } from '@/presentation/commands/summarizeChapters';

import { DisposableStore } from '@/bootstrap/lifecycle/disposableStore';
import type { IApplicationModule } from '@/bootstrap/lifecycle/applicationModule';
import type { IPlatformServices } from './platformModule';

export class NovelModule implements IApplicationModule {
  private readonly disposables = new DisposableStore();

  public constructor(private readonly platform: IPlatformServices) {}

  public initialize(context: vscode.ExtensionContext): void {
    const {
      assembleManuscriptUseCase,
      completeStoryScenesUseCase,
      configBridge,
      exportManuscriptUseCase,
      fileSystem,
      generateOutlineUseCase,
      logger,
      novelPipeline,
      novelRunStateRepository,
      reviewManuscriptUseCase,
      proposalReviewService,
      summarizeChaptersUseCase,
      usageMeter,
    } = this.platform;

    this.disposables.add(
      registerGenerateOutlineCommand({ generateOutlineUseCase, logger }),
      registerGenerateSceneSeedsCommand({ configBridge }),
      registerCompleteStoryScenesCommand(
        context,
        completeStoryScenesUseCase,
        proposalReviewService,
      ),
      registerAssembleManuscriptCommand({ assembleManuscriptUseCase, logger }),
      registerReviewManuscriptCommand({ logger, reviewManuscriptUseCase }),
      registerSummarizeChaptersCommand({ logger, summarizeChaptersUseCase }),
      registerGenerateNovelCommand({
        configBridge,
        fileSystem,
        novelPipeline,
        novelRunStateRepository,
        usageMeter,
      }),
      registerExportManuscriptCommand({ exportManuscriptUseCase, logger }),
    );
  }

  public dispose(): void {
    this.disposables.dispose();
  }
}
