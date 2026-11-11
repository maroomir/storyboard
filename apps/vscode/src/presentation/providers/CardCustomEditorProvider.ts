import * as vscode from 'vscode';

import type { CardManager, CardViewReading } from '@storyboard/story-app';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import {
  bundleFileNames,
  elementKindDirectories,
  elementKinds,
  type CardView,
  type ElementKind,
  type StoryboardResponsePayload,
} from '@storyboard/story-model';
import { uriExists } from '@/infrastructure/vscode/workspace';
import {
  createWebviewBridge,
  type StoryboardRpcHandlers,
  type StoryboardWebviewBridge,
} from '@/presentation/messaging/bridge';
import { createWebviewHtml, getWebviewDistRoot } from '@/presentation/providers/webviewHtml';
import { cardEditorViewType, sidebarViewIds } from '@/contributionIds';

export interface CardCustomEditorDependencies {
  readonly cards: Pick<CardManager, 'readView'>;
  readonly logger: IStoryboardLogger;
}

export interface CardViewerData {
  readonly documentUri: string;
  readonly view?: CardView;
  readonly warnings: readonly string[];
  readonly imageUri?: string;
  readonly error?: string;
}

interface BundleLocation {
  readonly workspaceRoot: vscode.Uri;
  readonly kind: ElementKind;
  readonly directoryName: string;
  readonly bundleUri: vscode.Uri;
}

const bundleImageFileNames: Readonly<Partial<Record<ElementKind, string>>> = {
  character: bundleFileNames.profileImage,
  background: bundleFileNames.placeImage,
};

const notBundleCardMessage: string = '카드 번들의 card.yaml 이 아닙니다.';

export function locateBundle(cardUri: vscode.Uri): BundleLocation | undefined {
  const workspaceFolder: vscode.WorkspaceFolder | undefined =
    vscode.workspace.getWorkspaceFolder(cardUri);
  const segments: readonly string[] = cardUri.path.split('/');
  const kind: ElementKind | undefined = elementKinds.find(
    (candidate) => elementKindDirectories[candidate] === segments.at(-3),
  );
  const directoryName: string | undefined = segments.at(-2);

  return workspaceFolder === undefined || kind === undefined || directoryName === undefined
    ? undefined
    : {
        workspaceRoot: workspaceFolder.uri,
        kind,
        directoryName,
        bundleUri: vscode.Uri.joinPath(cardUri, '..'),
      };
}

export class CardCustomEditorProvider implements vscode.CustomTextEditorProvider {
  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly dependencies: CardCustomEditorDependencies,
  ) {}

  public register(): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(cardEditorViewType, this, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    });
  }

  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ): void {
    const location: BundleLocation | undefined = locateBundle(document.uri);
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        getWebviewDistRoot(this.extensionUri),
        location?.bundleUri ?? vscode.Uri.joinPath(document.uri, '..'),
      ],
    };

    void new CardViewerSession(document, webviewPanel, this.dependencies, location).open(
      this.extensionUri,
    );
  }
}

export class CardViewerSession {
  public constructor(
    private readonly document: vscode.TextDocument,
    private readonly panel: vscode.WebviewPanel,
    private readonly dependencies: CardCustomEditorDependencies,
    private readonly location: BundleLocation | undefined,
  ) {}

  public async open(extensionUri: vscode.Uri): Promise<void> {
    this.panel.webview.html = createWebviewHtml(this.panel.webview, {
      extensionUri,
      title: 'Storyboard Card',
      view: 'card-viewer',
      initialData: await this.loadViewerData(),
    });

    const bridge: StoryboardWebviewBridge = createWebviewBridge(
      this.panel.webview,
      this.handlers(),
    );
    const watcher: vscode.FileSystemWatcher | undefined =
      this.location === undefined
        ? undefined
        : vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(this.location.bundleUri, '*.yaml'),
          );
    const refresh = (): void => void this.postViewChanged();
    const subscriptions: readonly vscode.Disposable[] = [
      ...(watcher === undefined
        ? []
        : [
            watcher,
            watcher.onDidCreate(refresh),
            watcher.onDidChange(refresh),
            watcher.onDidDelete(refresh),
          ]),
    ];

    this.panel.onDidDispose(() => {
      bridge.dispose();
      subscriptions.forEach((subscription) => subscription.dispose());
    });
  }

  public handlers(): StoryboardRpcHandlers {
    return {
      'cards.openText': this.openText,
      'cards.editInStudio': this.editInStudio,
    };
  }

  public async loadViewerData(): Promise<CardViewerData> {
    const documentUri: string = this.document.uri.toString();
    if (this.location === undefined) {
      return { documentUri, warnings: [], error: notBundleCardMessage };
    }

    const reading: CardViewReading = await this.dependencies.cards.readView(
      this.location.workspaceRoot,
      this.location.kind,
      this.location.directoryName,
    );
    if (!reading.ok) {
      return { documentUri, warnings: [], error: reading.message };
    }

    const imageUri: string | undefined = await this.resolveImageUri(this.location);
    return {
      documentUri,
      view: reading.view,
      warnings: reading.warnings,
      ...(imageUri === undefined ? {} : { imageUri }),
    };
  }

  private async resolveImageUri(location: BundleLocation): Promise<string | undefined> {
    const imageFileName: string | undefined = bundleImageFileNames[location.kind];
    const imageUri: vscode.Uri | undefined =
      imageFileName === undefined
        ? undefined
        : vscode.Uri.joinPath(location.bundleUri, imageFileName);

    return imageUri !== undefined && (await uriExists(imageUri))
      ? this.panel.webview.asWebviewUri(imageUri).toString()
      : undefined;
  }

  private async postViewChanged(): Promise<void> {
    await this.panel.webview.postMessage({
      type: 'event',
      method: 'cards.changed',
      payload: await this.loadViewerData(),
    });
  }

  private readonly openText = async (): Promise<StoryboardResponsePayload<'cards.openText'>> => {
    await vscode.commands.executeCommand('vscode.openWith', this.document.uri, 'default');

    const statementsUri: vscode.Uri | undefined =
      this.location === undefined
        ? undefined
        : vscode.Uri.joinPath(this.location.bundleUri, bundleFileNames.statements);
    if (statementsUri !== undefined && (await uriExists(statementsUri))) {
      await vscode.commands.executeCommand('vscode.openWith', statementsUri, 'default', {
        viewColumn: vscode.ViewColumn.Beside,
      });
    }

    return {};
  };

  private readonly editInStudio = async (): Promise<
    StoryboardResponsePayload<'cards.editInStudio'>
  > => {
    await vscode.commands.executeCommand(`${sidebarViewIds.studio}.focus`);
    return {};
  };
}
