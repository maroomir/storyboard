import { registerOpenBotDashboardCommand } from '../../presentation/commands/openBotDashboard';
import { BotStatusBarItem } from '../../presentation/providers/BotStatusBarItem';

import { DisposableStore } from '../lifecycle/disposableStore';
import type { IApplicationModule } from '../lifecycle/applicationModule';

export class BotModule implements IApplicationModule {
  private readonly disposables = new DisposableStore();

  public initialize(): void {
    this.disposables.add(registerOpenBotDashboardCommand(), new BotStatusBarItem());
  }

  public dispose(): void {
    this.disposables.dispose();
  }
}
