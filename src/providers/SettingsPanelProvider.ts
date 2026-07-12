import * as vscode from 'vscode';

import { createWebviewBridge, type StoryboardRpcHandlers } from '../messaging/bridge';
import { createAiRpcHandlers } from '../services/ai/rpcHandlers';
import { type AiProviderRegistry } from '../services/ai/providerRegistry';
import { aiProviderIds } from '../services/ai/types';
import { type SecretStore } from '../services/secrets/SecretStore';
import { type ConfigBridge } from '../services/settings/ConfigBridge';
import { createContractRpcHandlers } from '../services/settings/contractRpcHandlers';
import {
  createSettingsRpcHandlers,
  getSettingsReadSnapshot,
} from '../services/settings/settingsRpcHandlers';
import type { StoryboardResponsePayload } from '../shared/messaging';
import { createWebviewHtml, getWebviewDistRoot } from './webviewHtml';

const panelViewType = 'storyboard.settings';

export interface SettingsPanelDependencies {
  readonly aiProviderRegistry: AiProviderRegistry;
  readonly secretStore: SecretStore;
  readonly configBridge: ConfigBridge;
}

export interface ISettingsPanel extends vscode.Disposable {
  reveal(extensionUri: vscode.Uri): void;
}

export class SettingsPanelProvider implements ISettingsPanel {
  private panel: vscode.WebviewPanel | undefined;
  private bridge: { readonly dispose: () => void } | undefined;
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
    const initialSnapshot = await getSettingsReadSnapshot({
      configBridge: this.dependencies.configBridge,
      registry: this.dependencies.aiProviderRegistry,
    });

    const panel = vscode.window.createWebviewPanel(
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

    const secretDisposables = aiProviderIds.map((providerId) =>
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
    });

    await this.panel.webview.postMessage({
      type: 'event',
      method: 'settings.changed',
      payload,
    });
  }

  private createHandlers(): StoryboardRpcHandlers {
    return {
      ...createAiRpcHandlers(this.dependencies.aiProviderRegistry),
      ...createSettingsRpcHandlers({
        configBridge: this.dependencies.configBridge,
        secretStore: this.dependencies.secretStore,
        registry: this.dependencies.aiProviderRegistry,
      }),
      ...createContractRpcHandlers(),
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
