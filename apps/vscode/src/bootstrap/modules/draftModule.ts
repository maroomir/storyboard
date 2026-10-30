import * as vscode from 'vscode';

import { ApplyDraftFormatCommand } from '@/presentation/commands/applyDraftFormatCommand';
import { augmentPreviewScheme } from '@/presentation/commands/augmentDraft';
import { AugmentDraftCommand } from '@/presentation/commands/augmentDraftCommand';
import { AugmentSelectionCommand } from '@/presentation/commands/augmentSelectionCommand';
import { CONDENSE_PREVIEW_SCHEME } from '@/presentation/commands/condenseDraft';
import { CondenseDraftCommand } from '@/presentation/commands/condenseDraftCommand';
import { CreateSceneCommand } from '@/presentation/commands/createSceneCommand';
import { EditSelectionCommand } from '@/presentation/commands/editSelectionCommand';
import { ExpandDraftCommand } from '@/presentation/commands/expandDraftCommand';
import { GenerateAllDraftsCommand } from '@/presentation/commands/generateAllDraftsCommand';
import { GenerateDraftCommand } from '@/presentation/commands/generateDraftCommand';
import { GenerateSceneBeatsCommand } from '@/presentation/commands/generateSceneBeatsCommand';
import { OpenSceneDraftCommand } from '@/presentation/commands/openSceneDraftCommand';
import { RegenerateDraftCommand } from '@/presentation/commands/regenerateDraftCommand';
import { RenameSceneCommand } from '@/presentation/commands/renameSceneCommand';
import { ResealStoryStateCommand } from '@/presentation/commands/resealStoryStateCommand';
import { ReviseDraftCommand } from '@/presentation/commands/reviseDraftCommand';
import { CharacterHoverProvider } from '@/presentation/providers/CharacterHoverProvider';
import { ContinuityDiagnosticsProvider } from '@/presentation/providers/ContinuityDiagnosticsProvider';
import { GrammarDiagnosticsProvider } from '@/presentation/providers/GrammarDiagnosticsProvider';
import { DraftInlineCompletionProvider } from '@/presentation/providers/InlineCompletionProvider';
import { PreviewDocuments } from '@/presentation/providers/previewDocuments';
import { SidebarScenesProvider } from '@/presentation/providers/SidebarScenesProvider';
import { SlopDiagnosticsProvider } from '@/presentation/providers/SlopDiagnosticsProvider';

import { CommandRegistrar } from '@/bootstrap/commandRegistrar';
import { DisposableStore } from '@/bootstrap/lifecycle/disposableStore';
import type { IApplicationModule } from '@/bootstrap/lifecycle/applicationModule';
import type { IPlatformServices } from '@/bootstrap/modules/platformModule';

export class DraftModule implements IApplicationModule {
  private readonly disposables: DisposableStore = new DisposableStore();

  public constructor(private readonly platform: IPlatformServices) {}

  public initialize(context: vscode.ExtensionContext): void {
    const {
      aiProviderRegistry,
      aiGateway,
      configBridge,
      drafts,
      fileSystem,
      runGate,
      logger,
      project,
      usageRecorder,
    } = this.platform;
    const augmentPreview: PreviewDocuments = new PreviewDocuments(augmentPreviewScheme);
    const condensePreview: PreviewDocuments = new PreviewDocuments(CONDENSE_PREVIEW_SCHEME);
    const grammar: GrammarDiagnosticsProvider = new GrammarDiagnosticsProvider({
      drafts,
      configBridge,
      logger,
    });
    const continuity: ContinuityDiagnosticsProvider = new ContinuityDiagnosticsProvider({
      drafts,
      configBridge,
      logger,
    });
    const slop: SlopDiagnosticsProvider = new SlopDiagnosticsProvider({
      drafts,
      configBridge,
      logger,
    });

    this.disposables.add(
      augmentPreview.register(),
      condensePreview.register(),
      new CommandRegistrar().register([
        new GenerateDraftCommand({ drafts, runGate }),
        new RegenerateDraftCommand({ drafts, runGate }),
        new GenerateAllDraftsCommand({ drafts, logger, runGate }),
        new GenerateSceneBeatsCommand({ drafts }),
        new ApplyDraftFormatCommand({ drafts, logger }),
        new ReviseDraftCommand({ configBridge, drafts, logger }),
        new ExpandDraftCommand({ drafts, logger }),
        new CondenseDraftCommand({ drafts, configBridge, logger }, condensePreview.store),
        new AugmentDraftCommand({ drafts, logger }, augmentPreview.store),
        new AugmentSelectionCommand({ drafts, logger }, augmentPreview.store),
        new EditSelectionCommand({ drafts, logger }, augmentPreview.store),
        new CreateSceneCommand({ configBridge, project }),
        new OpenSceneDraftCommand(),
        new RenameSceneCommand({ drafts, runGate }),
        new ResealStoryStateCommand({ configBridge, fileSystem, logger }),
        ...grammar.commands,
        ...continuity.commands,
        ...slop.commands,
      ]),
      new CharacterHoverProvider().register(),
      new DraftInlineCompletionProvider({ aiGateway, configBridge }).register(),
      grammar.register(),
      continuity.register(),
      slop.register(),
      new SidebarScenesProvider(context.extensionUri, {
        aiProviderRegistry,
        sceneSidebarRepository: drafts.scenes,
        usageRecorder,
      }).register(),
    );
  }

  public dispose(): void {
    this.disposables.dispose();
  }
}
