import * as vscode from 'vscode';

import { BuildStoryCardsFromScenesCommand } from '@/presentation/commands/buildStoryCardsFromScenesCommand';
import { CanonDiffCommand } from '@/presentation/commands/canonDiffCommand';
import { CreateBackgroundCardCommand } from '@/presentation/commands/createBackgroundCardCommand';
import { CreateCharacterCardCommand } from '@/presentation/commands/createCharacterCardCommand';
import { PromoteBibleCandidatesCommand } from '@/presentation/commands/promoteBibleCandidatesCommand';
import { PromoteCardCandidatesCommand } from '@/presentation/commands/promoteCardCandidatesCommand';
import { RecommendBackgroundCardsCommand } from '@/presentation/commands/recommendBackgroundCardsCommand';
import { RecommendCharacterCardsCommand } from '@/presentation/commands/recommendCharacterCardsCommand';
import { RenameBackgroundCardCommand } from '@/presentation/commands/renameBackgroundCardCommand';
import { RenameCharacterCardCommand } from '@/presentation/commands/renameCharacterCardCommand';
import {
  CardCustomEditorProvider,
  collectPreviewScheme,
} from '@/presentation/providers/CardCustomEditorProvider';
import { CardDiagnosticsProvider } from '@/presentation/providers/CardDiagnosticsProvider';
import { CardRenameParticipant } from '@/presentation/providers/CardRenameParticipant';
import { PreviewDocuments } from '@/presentation/providers/previewDocuments';
import {
  SidebarCardsProvider,
  backgroundsSidebarOptions,
  charactersSidebarOptions,
} from '@/presentation/providers/SidebarCardsProvider';

import { CommandRegistrar } from '@/bootstrap/commandRegistrar';
import { DisposableStore } from '@/bootstrap/lifecycle/disposableStore';
import type { IApplicationModule } from '@/bootstrap/lifecycle/applicationModule';
import type { IPlatformServices } from './platformModule';

export class CardModule implements IApplicationModule {
  private readonly disposables: DisposableStore = new DisposableStore();

  public constructor(private readonly platform: IPlatformServices) {}

  public initialize(context: vscode.ExtensionContext): void {
    const {
      aiGateway,
      aiProviderRegistry,
      cards,
      notes,
      logger,
      proposalReviewService,
      usageRecorder,
    } = this.platform;
    const collectPreview: PreviewDocuments = new PreviewDocuments(collectPreviewScheme);
    const sidebarDependencies: ConstructorParameters<typeof SidebarCardsProvider>[1] = {
      aiProviderRegistry,
      cardSidebarRepository: cards.sidebar,
      usageRecorder,
    };

    this.disposables.add(
      collectPreview.register(),
      new CommandRegistrar().register([
        new CreateCharacterCardCommand({ cards }),
        new CreateBackgroundCardCommand({ cards }),
        new RecommendCharacterCardsCommand({ cards }),
        new RecommendBackgroundCardsCommand({ cards }),
        new BuildStoryCardsFromScenesCommand(cards, proposalReviewService),
        new RenameCharacterCardCommand(),
        new RenameBackgroundCardCommand(),
        new PromoteBibleCandidatesCommand({ logger, cards }),
        new PromoteCardCandidatesCommand({ logger, cards, notes }),
        new CanonDiffCommand({ logger }),
      ]),
      new CardRenameParticipant(logger).register(),
      new CardDiagnosticsProvider({ logger }).register(),
      new CardCustomEditorProvider(
        context.extensionUri,
        { aiGateway, aiProviderRegistry, cards, usageRecorder, logger },
        collectPreview.store,
      ).register(),
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
