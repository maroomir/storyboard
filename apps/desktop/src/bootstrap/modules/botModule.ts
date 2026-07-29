import { registerOpenBotDashboardCommand } from '../../presentation/commands/openBotDashboard';
import { registerSetupBotCommand } from '../../presentation/commands/setupBot';
import { BotStatusBarItem } from '../../presentation/providers/BotStatusBarItem';

import { DisposableStore } from '../lifecycle/disposableStore';
import type { IApplicationModule } from '../lifecycle/applicationModule';

export class BotModule implements IApplicationModule {
  private readonly disposables = new DisposableStore();

  public initialize(): void {
    this.disposables.add(
      registerSetupBotCommand(),
      registerOpenBotDashboardCommand(),
      new BotStatusBarItem(),
    );
  }

  public dispose(): void {
    this.disposables.dispose();
  }
}
