import * as vscode from 'vscode';

import { registerApplyDraftFormatCommand } from '@/presentation/commands/applyDraftFormat';
import { registerAugmentDraftCommands } from '@/presentation/commands/augmentDraft';
import { registerExpandDraftCommand } from '@/presentation/commands/expandDraft';
import { registerCondenseDraftCommand } from '@/presentation/commands/condenseDraft';
import { registerGenerateAllDraftsCommand } from '@/presentation/commands/generateAllDrafts';
import { registerGenerateDraftCommands } from '@/presentation/commands/generateDraft';
import { registerGenerateSceneBeatsCommand } from '@/presentation/commands/generateSceneBeats';
import { registerMigrateScenesCommand } from '@/presentation/commands/migrateScenes';
import { registerResealStoryStateCommand } from '@/presentation/commands/resealStoryState';
import { registerNewSceneCommands } from '@/presentation/commands/newScene';
import { registerReviseDraftCommand } from '@/presentation/commands/reviseDraft';
import { registerCharacterHoverProvider } from '@/presentation/providers/CharacterHoverProvider';
import { registerContinuityDiagnosticsProvider } from '@/presentation/providers/ContinuityDiagnosticsProvider';
import { registerGrammarDiagnosticsProvider } from '@/presentation/providers/GrammarDiagnosticsProvider';
import { registerInlineCompletionProvider } from '@/presentation/providers/InlineCompletionProvider';
import { registerSidebarScenesProvider } from '@/presentation/providers/SidebarScenesProvider';
import { registerSlopDiagnosticsProvider } from '@/presentation/providers/SlopDiagnosticsProvider';

import { DisposableStore } from '@/bootstrap/lifecycle/disposableStore';
import type { IApplicationModule } from '@/bootstrap/lifecycle/applicationModule';
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
      fileSystem,
      expandDraftUseCase,
      generateDraftUseCase,
      generateAllDraftsUseCase,
      generateSceneBeatsUseCase,
      logger,
      reviseAfterGenerateGate,
      reviseDraftUseCase,
      sceneSidebarRepository,
      usageRecorder,
    } = this.platform;

    this.disposables.add(
      registerGenerateDraftCommands({
        fileSystem,
        generateDraftUseCase,
        reviseAfterGenerateGate,
      }),
      registerGenerateAllDraftsCommand({
        fileSystem,
        generateAllDraftsUseCase,
        logger,
      }),
      registerGenerateSceneBeatsCommand({ generateSceneBeatsUseCase }),
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
      registerNewSceneCommands({ configBridge }),
      registerMigrateScenesCommand({ logger }),
      registerResealStoryStateCommand({ configBridge, fileSystem, logger }),
      registerCharacterHoverProvider(),
      registerInlineCompletionProvider({ aiGateway, configBridge }),
      registerGrammarDiagnosticsProvider({ aiGateway, configBridge, logger }),
      registerContinuityDiagnosticsProvider({ aiGateway, configBridge, logger }),
      registerSlopDiagnosticsProvider({ configBridge, logger }),
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
