import * as vscode from 'vscode';

import { BuildStoryCardsFromScenesCommand } from '@/presentation/commands/buildStoryCardsFromScenesCommand';
import { CreateBackgroundCardCommand } from '@/presentation/commands/createBackgroundCardCommand';
import { CreateCharacterCardCommand } from '@/presentation/commands/createCharacterCardCommand';
import { PromoteCardCandidatesCommand } from '@/presentation/commands/promoteCardCandidatesCommand';
import { RecommendBackgroundCardsCommand } from '@/presentation/commands/recommendBackgroundCardsCommand';
import { RecommendCharacterCardsCommand } from '@/presentation/commands/recommendCharacterCardsCommand';
import { RenameBackgroundCardCommand } from '@/presentation/commands/renameBackgroundCardCommand';
import { RenameCharacterCardCommand } from '@/presentation/commands/renameCharacterCardCommand';
import { CardCustomEditorProvider } from '@/presentation/providers/CardCustomEditorProvider';
import { CardDiagnosticsProvider } from '@/presentation/providers/CardDiagnosticsProvider';
import { CardRenameParticipant } from '@/presentation/providers/CardRenameParticipant';
import {
  SidebarCardsProvider,
  backgroundsSidebarOptions,
  charactersSidebarOptions,
} from '@/presentation/providers/SidebarCardsProvider';

import { CommandRegistrar } from '@/bootstrap/commandRegistrar';
import { DisposableStore } from '@/bootstrap/lifecycle/disposableStore';
import type { IApplicationModule } from '@/bootstrap/lifecycle/applicationModule';
import type { IPlatformServices } from '@/bootstrap/modules/platformModule';

export class CardModule implements IApplicationModule {
  private readonly disposables: DisposableStore = new DisposableStore();

  public constructor(private readonly platform: IPlatformServices) {}

  public initialize(context: vscode.ExtensionContext): void {
    const {
      aiProviderRegistry,
      cards,
      drafts,
      logger,
      proposalReviewService,
      studioLauncher,
      usageRecorder,
    } = this.platform;
    const sidebarDependencies: ConstructorParameters<typeof SidebarCardsProvider>[1] = {
      aiProviderRegistry,
      cardSidebarRepository: cards.sidebar,
      usageRecorder,
    };

    this.disposables.add(
      new CommandRegistrar().register([
        new CreateCharacterCardCommand({ launcher: studioLauncher }),
        new CreateBackgroundCardCommand({ launcher: studioLauncher }),
        new RecommendCharacterCardsCommand({ cards }),
        new RecommendBackgroundCardsCommand({ cards }),
        new BuildStoryCardsFromScenesCommand(cards, proposalReviewService),
        new RenameCharacterCardCommand({ cards }),
        new RenameBackgroundCardCommand({ cards }),
        new PromoteCardCandidatesCommand({ cards }),
      ]),
      new CardRenameParticipant({ cards, drafts, logger }).register(),
      new CardDiagnosticsProvider({ logger }).register(),
      new CardCustomEditorProvider(context.extensionUri, { cards, logger }).register(),
      new SidebarCardsProvider(
        context.extensionUri,
        sidebarDependencies,
        charactersSidebarOptions,
      ).register(),
      new SidebarCardsProvider(
        context.extensionUri,
        sidebarDependencies,
        backgroundsSidebarOptions,
      ).register(),
    );
  }

  public dispose(): void {
    this.disposables.dispose();
  }
}
