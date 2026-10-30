import type * as vscode from 'vscode';

import { AssembleManuscriptCommand } from '@/presentation/commands/assembleManuscriptCommand';
import { CompleteStoryScenesCommand } from '@/presentation/commands/completeStoryScenesCommand';
import { ExportManuscriptCommand } from '@/presentation/commands/exportManuscriptCommand';
import { GenerateNovelCommand } from '@/presentation/commands/generateNovelCommand';
import { GenerateOutlineCommand } from '@/presentation/commands/generateOutlineCommand';
import { GenerateSceneSeedsCommand } from '@/presentation/commands/generateSceneSeedsCommand';
import { ReviewManuscriptCommand } from '@/presentation/commands/reviewManuscriptCommand';
import { SummarizeChaptersCommand } from '@/presentation/commands/summarizeChaptersCommand';

import { CommandRegistrar } from '@/bootstrap/commandRegistrar';
import { DisposableStore } from '@/bootstrap/lifecycle/disposableStore';
import type { IApplicationModule } from '@/bootstrap/lifecycle/applicationModule';
import type { IPlatformServices } from '@/bootstrap/modules/platformModule';

export class NovelModule implements IApplicationModule {
  private readonly disposables: DisposableStore = new DisposableStore();

  public constructor(private readonly platform: IPlatformServices) {}

  public initialize(_context: vscode.ExtensionContext): void {
    const { configBridge, runGate, logger, manuscript, novel, proposalReviewService } =
      this.platform;

    this.disposables.add(
      new CommandRegistrar().register([
        new GenerateOutlineCommand({ novel, logger }),
        new GenerateSceneSeedsCommand({ configBridge }),
        new CompleteStoryScenesCommand(novel, proposalReviewService),
        new AssembleManuscriptCommand({ manuscript, logger }),
        new ReviewManuscriptCommand({ logger, manuscript }),
        new SummarizeChaptersCommand({ logger, manuscript }),
        new GenerateNovelCommand({ novel, runGate }),
        new ExportManuscriptCommand({ manuscript, logger }),
      ]),
    );
  }

  public dispose(): void {
    this.disposables.dispose();
  }
}
