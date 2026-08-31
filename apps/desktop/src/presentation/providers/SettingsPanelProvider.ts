import * as vscode from 'vscode';

import { createWebviewBridge, type StoryboardRpcHandlers } from '../messaging/bridge';
import { createAiRpcHandlers } from '../messaging/aiRpcHandlers';
import { aiProviderIds } from '@storyboard/story-ai';
import type { AiProviderRegistry, ConfigBridge, SecretStore } from '@storyboard/story-ai';
import { createContractRpcHandlers } from '../messaging/contractRpcHandlers';
import {
  createSettingsRpcHandlers,
  getSettingsReadSnapshot,
} from '../messaging/settingsRpcHandlers';
import type { StoryboardResponsePayload } from '@storyboard/story-engine';
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
