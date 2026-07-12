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

import type { IApplicationModule } from '../lifecycle/application-module';
import type { IPlatformServices } from './platform-module';

export class CardModule implements IApplicationModule {
  private disposables: vscode.Disposable[] = [];

  public constructor(private readonly platform: IPlatformServices) {}

  public initialize(context: vscode.ExtensionContext): void {
    const { aiProviderRegistry, logger, usageRecorder } = this.platform;

    this.disposables.push(
      registerCreateCardCommands(),
      registerRecommendCardCommands({ aiProviderRegistry, usageRecorder, logger }),
      registerRenameCardCommands(),
      registerMigrateCardTextCommand({ logger }),
      registerCardRenameParticipant({ logger }),
      registerPromoteBibleCandidatesCommand({ logger }),
      registerPromoteCardCandidatesCommand({ logger }),
      registerCanonDiffCommand({ logger }),
      registerCardCustomEditorProvider(context, { aiProviderRegistry, usageRecorder, logger }),
      registerSidebarCardsProviders(context, { aiProviderRegistry, usageRecorder }),
    );
  }

  public dispose(): void {
    for (const disposable of this.disposables.splice(0).reverse()) {
      disposable.dispose();
    }
  }
}
