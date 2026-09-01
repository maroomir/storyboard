import * as vscode from 'vscode';

import { registerApplyDraftFormatCommand } from '@/presentation/commands/applyDraftFormat';
import { registerAugmentDraftCommands } from '@/presentation/commands/augmentDraft';
import { registerExpandDraftCommand } from '@/presentation/commands/expandDraft';
import { registerCondenseDraftCommand } from '@/presentation/commands/condenseDraft';
import { registerGenerateAllDraftsCommand } from '@/presentation/commands/generateAllDrafts';
import { registerGenerateDraftCommands } from '@/presentation/commands/generateDraft';
import { registerMigrateScenesCommand } from '@/presentation/commands/migrateScenes';
import { registerNewSceneCommands } from '@/presentation/commands/newScene';
import { registerReviseDraftCommand } from '@/presentation/commands/reviseDraft';
import { registerCharacterHoverProvider } from '@/presentation/providers/CharacterHoverProvider';
import { registerContinuityDiagnosticsProvider } from '@/presentation/providers/ContinuityDiagnosticsProvider';
import { registerGrammarDiagnosticsProvider } from '@/presentation/providers/GrammarDiagnosticsProvider';
import { registerInlineCompletionProvider } from '@/presentation/providers/InlineCompletionProvider';
import { registerSidebarScenesProvider } from '@/presentation/providers/SidebarScenesProvider';
import { registerSlopDiagnosticsProvider } from '@/presentation/providers/SlopDiagnosticsProvider';

import { DisposableStore } from '../lifecycle/disposableStore';
import type { IApplicationModule } from '../lifecycle/applicationModule';
import type { IPlatformServices } from './platformModule';

export class DraftModule implements IApplicationModule {
  private readonly disposables = new DisposableStore();

  public constructor(private readonly platform: IPlatformServices) {}

  public initialize(_context: vscode.ExtensionContext): void {
    const {
      aiProviderRegistry,
      aiGateway,
      applyDraftFormatUseCase,
      augmentDraftUseCase,
      configBridge,
      condenseDraftUseCase,
      expandDraftUseCase,
      generateDraftUseCase,
      generateAllDraftsUseCase,
      logger,
      reviseAfterGenerateGate,
      reviseDraftUseCase,
      sceneSidebarRepository,
      usageRecorder,
    } = this.platform;

    this.disposables.add(
      registerGenerateDraftCommands({
        generateDraftUseCase,
        reviseAfterGenerateGate,
      }),
      registerGenerateAllDraftsCommand({
        generateAllDraftsUseCase,
        logger,
      }),
      registerApplyDraftFormatCommand({ applyDraftFormatUseCase, logger }),
      registerReviseDraftCommand({
        configBridge,
        logger,
        reviseAfterGenerateGate,
        reviseDraftUseCase,
      }),
      registerExpandDraftCommand({ expandDraftUseCase, logger }),
      registerCondenseDraftCommand({ condenseDraftUseCase, configBridge, logger }),
      registerAugmentDraftCommands({ augmentDraftUseCase, logger }),
      registerNewSceneCommands(),
      registerMigrateScenesCommand({ logger }),
      registerCharacterHoverProvider(),
      registerInlineCompletionProvider({ aiGateway }),
      registerGrammarDiagnosticsProvider({ aiGateway, logger }),
      registerContinuityDiagnosticsProvider({ aiGateway, logger }),
      registerSlopDiagnosticsProvider({ logger }),
      registerSidebarScenesProvider(_context, {
        aiProviderRegistry,
        sceneSidebarRepository,
        usageRecorder,
      }),
    );
  }

  public dispose(): void {
    this.disposables.dispose();
  }
}
