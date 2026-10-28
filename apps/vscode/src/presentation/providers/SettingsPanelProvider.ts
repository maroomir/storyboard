import type { DisposableHandle, SettingsConfigFiles } from '@storyboard/story-model';
import * as vscode from 'vscode';

import { createWebviewBridge, type StoryboardRpcHandlers } from '@/presentation/messaging/bridge';
import { AiRpc } from '@/presentation/messaging/aiRpcHandlers';
import { aiProviderIds } from '@storyboard/story-model';
import type { AiProviderRegistry, ConfigBridge, SecretStore } from '@storyboard/story-ai';
import { ContractRpc } from '@/presentation/messaging/contractRpcHandlers';
import { SettingsRpc, getSettingsReadSnapshot } from '@/presentation/messaging/settingsRpcHandlers';
import type { StoryboardResponsePayload } from '@storyboard/story-model';
import { createWebviewHtml, getWebviewDistRoot } from './webviewHtml';

const panelViewType: string = 'storyboard.settings';

export interface SettingsPanelDependencies {
  readonly aiProviderRegistry: AiProviderRegistry;
  readonly secretStore: SecretStore;
  readonly configBridge: ConfigBridge;
  readonly configFiles: () => SettingsConfigFiles;
}

export interface ISettingsPanel extends vscode.Disposable {
  reveal(extensionUri: vscode.Uri): void;
}

export class SettingsPanelProvider implements ISettingsPanel {
  private panel: vscode.WebviewPanel | undefined;
  private bridge: DisposableHandle | undefined;
  private hostSubscriptions: vscode.Disposable | undefined;

  public constructor(private readonly dependencies: SettingsPanelDependencies) {}

  public reveal(extensionUri: vscode.Uri): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      void this.postSettingsChanged();
      return;
    }

    void this.open(extensionUri);
  }

  public dispose(): void {
    this.panel?.dispose();
    this.clearPanelResources();
  }

  private async open(extensionUri: vscode.Uri): Promise<void> {
    const initialSnapshot: StoryboardResponsePayload<'settings.read'> =
      await getSettingsReadSnapshot({
        configBridge: this.dependencies.configBridge,
        registry: this.dependencies.aiProviderRegistry,
        configFiles: this.dependencies.configFiles,
      });

    const panel: vscode.WebviewPanel = vscode.window.createWebviewPanel(
      panelViewType,
      'Storyboard Settings',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [getWebviewDistRoot(extensionUri)],
      },
    );

    this.panel = panel;

    panel.webview.html = createWebviewHtml(panel.webview, {
      extensionUri,
      title: 'Storyboard Settings',
      view: 'settings',
      initialData: initialSnapshot,
    });

    this.bridge = createWebviewBridge(panel.webview, this.createHandlers());

    const secretDisposables: DisposableHandle[] = aiProviderIds.map((providerId) =>
      this.dependencies.secretStore.onDidChangeApiKey(providerId, () => {
        void this.postSettingsChanged();
      }),
    );

    this.hostSubscriptions = vscode.Disposable.from(
      this.dependencies.configBridge.onDidChange(() => {
        void this.postSettingsChanged();
      }),
      ...secretDisposables,
    );

    panel.onDidDispose(() => this.clearPanelResources());
  }

  private async postSettingsChanged(): Promise<void> {
    if (!this.panel) {
      return;
    }

    const payload: StoryboardResponsePayload<'settings.read'> = await getSettingsReadSnapshot({
      configBridge: this.dependencies.configBridge,
      registry: this.dependencies.aiProviderRegistry,
      configFiles: this.dependencies.configFiles,
    });

    await this.panel.webview.postMessage({
      type: 'event',
      method: 'settings.changed',
      payload,
    });
  }

  private createHandlers(): StoryboardRpcHandlers {
    return {
      ...new AiRpc(this.dependencies.aiProviderRegistry).handlers(),
      ...new SettingsRpc({
        configBridge: this.dependencies.configBridge,
        secretStore: this.dependencies.secretStore,
        registry: this.dependencies.aiProviderRegistry,
        configFiles: this.dependencies.configFiles,
      }).handlers(),
      ...new ContractRpc().handlers(),
    };
  }

  private clearPanelResources(): void {
    this.bridge?.dispose();
    this.bridge = undefined;
    this.hostSubscriptions?.dispose();
    this.hostSubscriptions = undefined;
    this.panel = undefined;
  }
}
