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

import type { IApplicationModule } from '../lifecycle/application-module';
import type { IPlatformServices } from './platform-module';

export class DraftModule implements IApplicationModule {
  private disposables: vscode.Disposable[] = [];

  public constructor(private readonly platform: IPlatformServices) {}

  public initialize(_context: vscode.ExtensionContext): void {
    const { aiProviderRegistry, configBridge, logger, usageRecorder } = this.platform;

    this.disposables.push(
      registerGenerateDraftCommands({ aiProviderRegistry, configBridge, logger, usageRecorder }),
      registerGenerateAllDraftsCommand({ aiProviderRegistry, configBridge, logger, usageRecorder }),
      registerApplyDraftFormatCommand({ aiProviderRegistry, logger, usageRecorder }),
      registerReviseDraftCommand({ aiProviderRegistry, configBridge, logger, usageRecorder }),
      registerExpandDraftCommand({ aiProviderRegistry, logger, usageRecorder }),
      registerAugmentDraftCommands({ aiProviderRegistry, configBridge, logger, usageRecorder }),
      registerNewSceneCommands(),
      registerCharacterHoverProvider(),
      registerInlineCompletionProvider({ aiProviderRegistry, logger, usageRecorder }),
      registerGrammarDiagnosticsProvider({ aiProviderRegistry, logger, usageRecorder }),
      registerContinuityDiagnosticsProvider({ aiProviderRegistry, logger, usageRecorder }),
      registerSlopDiagnosticsProvider({ logger }),
      registerSidebarScenesProvider(_context, { aiProviderRegistry, usageRecorder }),
    );
  }

  public dispose(): void {
    for (const disposable of this.disposables.splice(0).reverse()) {
      disposable.dispose();
    }
  }
}
