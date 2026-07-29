import * as vscode from 'vscode';

import type { IApplicationModule } from './lifecycle/applicationModule';
import { BotModule } from './modules/botModule';
import { CardModule } from './modules/cardModule';
import { DraftModule } from './modules/draftModule';
import { NovelModule } from './modules/novelModule';
import { PlatformModule } from './modules/platformModule';
import { ProjectModule } from './modules/projectModule';
import { WorkbenchModule } from './modules/workbenchModule';

type ApplicationState =
  | { readonly status: 'created' }
  | { readonly status: 'initialized'; readonly modules: readonly IApplicationModule[] }
  | { readonly status: 'disposed' };

export class StoryboardApplication implements vscode.Disposable {
  private state: ApplicationState = { status: 'created' };

  public initialize(context: vscode.ExtensionContext): void {
    if (this.state.status !== 'created') {
      throw new Error(`StoryboardApplication cannot initialize from ${this.state.status}.`);
    }

    const platformModule = new PlatformModule();
    const modules: IApplicationModule[] = [platformModule];

    try {
      platformModule.initialize(context);
      const platform = platformModule.getServices();

      modules.push(
        new ProjectModule(platform),
        new CardModule(platform),
        new DraftModule(platform),
        new NovelModule(platform),
        new WorkbenchModule(platform),
        new BotModule(),
      );

      for (const module of modules.slice(1)) {
        module.initialize(context);
      }
    } catch (error) {
      this.disposeModules(modules);
      this.state = { status: 'disposed' };
      throw error;
    }

    this.state = { status: 'initialized', modules };
    context.subscriptions.push(this);
  }

  public dispose(): void {
    if (this.state.status === 'disposed') {
      return;
    }

    if (this.state.status === 'initialized') {
      this.disposeModules(this.state.modules);
    }

    this.state = { status: 'disposed' };
  }

  private disposeModules(modules: readonly IApplicationModule[]): void {
    for (const module of [...modules].reverse()) {
      module.dispose();
    }
  }
}
