import * as vscode from 'vscode';

import { registerCanonDiffCommand } from '../../commands/canonDiff';
import { registerCreateCardCommands } from '../../commands/createCard';
import { registerMigrateCardTextCommand } from '../../commands/migrateCardTextToList';
import { registerPromoteBibleCandidatesCommand } from '../../commands/promoteBibleCandidates';
import { registerPromoteCardCandidatesCommand } from '../../commands/promoteCardCandidates';
import { registerRecommendCardCommands } from '../../commands/recommendCards';
import { registerRenameCardCommands } from '../../commands/renameCard';
import { registerCardCustomEditorProvider } from '../../providers/CardCustomEditorProvider';
import { registerCardRenameParticipant } from '../../providers/CardRenameParticipant';
import { registerSidebarCardsProviders } from '../../providers/SidebarCardsProvider';

import { DisposableStore } from '../lifecycle/disposableStore';
import type { IApplicationModule } from '../lifecycle/applicationModule';
import type { IPlatformServices } from './platformModule';

export class CardModule implements IApplicationModule {
  private readonly disposables = new DisposableStore();

  public constructor(private readonly platform: IPlatformServices) {}

  public initialize(context: vscode.ExtensionContext): void {
    const {
      aiProviderRegistry,
      collectCardProposalsUseCase,
      createCardUseCase,
      cardSidebarRepository,
      logger,
      promoteBibleCandidatesUseCase,
      promoteCardCandidatesUseCase,
      recommendCardsUseCase,
      usageRecorder,
    } = this.platform;

    this.disposables.add(
      registerCreateCardCommands({ createCardUseCase }),
      registerRecommendCardCommands({ createCardUseCase, recommendCardsUseCase }),
      registerRenameCardCommands(),
      registerMigrateCardTextCommand({ logger }),
      registerCardRenameParticipant({ logger }),
      registerPromoteBibleCandidatesCommand({ logger, promoteBibleCandidatesUseCase }),
      registerPromoteCardCandidatesCommand({ logger, promoteCardCandidatesUseCase }),
      registerCanonDiffCommand({ logger }),
      registerCardCustomEditorProvider(context, {
        aiProviderRegistry,
        collectCardProposalsUseCase,
        usageRecorder,
        logger,
      }),
      registerSidebarCardsProviders(context, {
        aiProviderRegistry,
        cardSidebarRepository,
        usageRecorder,
      }),
    );
  }

  public dispose(): void {
    this.disposables.dispose();
  }
}
