import * as vscode from 'vscode';

import { registerApplyDraftFormatCommand } from '../../commands/applyDraftFormat';
import { registerAugmentDraftCommands } from '../../commands/augmentDraft';
import { registerExpandDraftCommand } from '../../commands/expandDraft';
import { registerGenerateAllDraftsCommand } from '../../commands/generateAllDrafts';
import { registerGenerateDraftCommands } from '../../commands/generateDraft';
import { registerNewSceneCommands } from '../../commands/newScene';
import { registerReviseDraftCommand } from '../../commands/reviseDraft';
import { registerCharacterHoverProvider } from '../../providers/CharacterHoverProvider';
import { registerContinuityDiagnosticsProvider } from '../../providers/ContinuityDiagnosticsProvider';
import { registerGrammarDiagnosticsProvider } from '../../providers/GrammarDiagnosticsProvider';
import { registerInlineCompletionProvider } from '../../providers/InlineCompletionProvider';
import { registerSidebarScenesProvider } from '../../providers/SidebarScenesProvider';
import { registerSlopDiagnosticsProvider } from '../../providers/SlopDiagnosticsProvider';

import { DisposableStore } from '../lifecycle/disposable-store';
import type { IApplicationModule } from '../lifecycle/application-module';
import type { IPlatformServices } from './platform-module';

export class DraftModule implements IApplicationModule {
  private readonly disposables = new DisposableStore();

  public constructor(private readonly platform: IPlatformServices) {}

  public initialize(_context: vscode.ExtensionContext): void {
    const {
      aiProviderRegistry,
      aiGateway,
      augmentDraftUseCase,
      configBridge,
      generateDraftUseCase,
      logger,
      reviseDraftUseCase,
      usageRecorder,
    } = this.platform;

    this.disposables.add(
      registerGenerateDraftCommands({
        configBridge,
        generateDraftUseCase,
        logger,
        reviseDraftUseCase,
      }),
      registerGenerateAllDraftsCommand({
        configBridge,
        generateDraftUseCase,
        logger,
        reviseDraftUseCase,
      }),
      registerApplyDraftFormatCommand({ aiGateway, logger }),
      registerReviseDraftCommand({ configBridge, logger, reviseDraftUseCase }),
      registerExpandDraftCommand({ aiProviderRegistry, logger, usageRecorder }),
      registerAugmentDraftCommands({ augmentDraftUseCase, configBridge, logger }),
      registerNewSceneCommands(),
      registerCharacterHoverProvider(),
      registerInlineCompletionProvider({ aiGateway }),
      registerGrammarDiagnosticsProvider({ aiGateway, logger }),
      registerContinuityDiagnosticsProvider({ aiGateway, logger }),
      registerSlopDiagnosticsProvider({ logger }),
      registerSidebarScenesProvider(_context, { aiProviderRegistry, usageRecorder }),
    );
  }

  public dispose(): void {
    this.disposables.dispose();
  }
}
