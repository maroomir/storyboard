import * as vscode from 'vscode';

import { registerCanonDiffCommand } from '@/presentation/commands/canonDiff';
import { registerBuildStoryCardsFromScenesCommand } from '@/presentation/commands/buildStoryCardsFromScenes';
import { registerCreateCardCommands } from '@/presentation/commands/createCard';
import { registerPromoteBibleCandidatesCommand } from '@/presentation/commands/promoteBibleCandidates';
import { registerPromoteCardCandidatesCommand } from '@/presentation/commands/promoteCardCandidates';
import { registerRecommendCardCommands } from '@/presentation/commands/recommendCards';
import { registerRenameCardCommands } from '@/presentation/commands/renameCard';
import { registerCardCustomEditorProvider } from '@/presentation/providers/CardCustomEditorProvider';
import { registerCardDiagnosticsProvider } from '@/presentation/providers/CardDiagnosticsProvider';
import { registerCardRenameParticipant } from '@/presentation/providers/CardRenameParticipant';
import { registerSidebarCardsProviders } from '@/presentation/providers/SidebarCardsProvider';

import { DisposableStore } from '@/bootstrap/lifecycle/disposableStore';
import type { IApplicationModule } from '@/bootstrap/lifecycle/applicationModule';
import type { IPlatformServices } from './platformModule';

export class CardModule implements IApplicationModule {
  private readonly disposables = new DisposableStore();

  public constructor(private readonly platform: IPlatformServices) {}

  public initialize(context: vscode.ExtensionContext): void {
    const { aiGateway, aiProviderRegistry, cards, logger, proposalReviewService, usageRecorder } =
      this.platform;

    this.disposables.add(
      registerCreateCardCommands({ cards }),
      registerRecommendCardCommands({ cards }),
      registerBuildStoryCardsFromScenesCommand(context, cards, proposalReviewService),
      registerRenameCardCommands(),
      registerCardRenameParticipant({ logger }),
      registerPromoteBibleCandidatesCommand({ logger, cards }),
      registerPromoteCardCandidatesCommand({ logger, cards }),
      registerCanonDiffCommand({ logger }),
      registerCardDiagnosticsProvider({ logger }),
      registerCardCustomEditorProvider(context, {
        aiGateway,
        aiProviderRegistry,
        cards,
        usageRecorder,
        logger,
      }),
      registerSidebarCardsProviders(context, {
        aiProviderRegistry,
        cardSidebarRepository: cards.sidebar,
        usageRecorder,
      }),
    );
  }

  public dispose(): void {
    this.disposables.dispose();
  }
}
