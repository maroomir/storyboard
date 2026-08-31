import * as vscode from 'vscode';

import type { AiGateway } from '../../application/ai/aiGateway';
import type { CollectCardProposalsUseCase } from '../../application/cards/collectCardProposalsUseCase';
import {
  CardParseError,
  parseCard,
  parseSceneFileName,
  parseWorkspaceCard,
  sceneSeedSectionLabels,
  serializeCard,
  serializeWorkspaceCard,
} from '@storyboard/story-format';
import type { SceneCard, WorkspaceCard } from '@storyboard/story-format';
import type { SceneStructureFieldKey } from '@storyboard/story-ai';
import { applyCardCollectProposals } from '@storyboard/story-engine';
import { StoryboardLogger } from '../../infrastructure/vscode/logger';
import { loadCharacterRoster } from '../../infrastructure/persistence/relationGraphData';
import { VirtualDocumentStore } from './virtualDocumentStore';
import type { StoryboardResponsePayload } from '@storyboard/story-engine';
import { createWebviewBridge, type StoryboardRpcHandlers } from '../messaging/bridge';
import type { AiProviderRegistry } from '@storyboard/story-ai';
import type { UsageRecorder } from '../../infrastructure/ai/UsageRecorder';
import { createWebviewHtml, getWebviewDistRoot } from './webviewHtml';

const cardEditorViewType = 'storyboard.card';

export interface CardCustomEditorDependencies {
  readonly aiGateway: AiGateway;
  readonly aiProviderRegistry: AiProviderRegistry;
  readonly collectCardProposalsUseCase: CollectCardProposalsUseCase;
  readonly usageRecorder: UsageRecorder;
  readonly logger: StoryboardLogger;
}

const collectPreviewScheme = 'storyboard-collect';

function collectPreviewUri(documentUri: vscode.Uri): vscode.Uri {
  const baseName = (documentUri.path.split('/').at(-1) ?? 'card.card').replace(/\.card$/, '');
  // NOTE: Use .yaml extension so VSCode doesn't route the virtual doc through CardCustomEditorProvider.
  return vscode.Uri.from({
    scheme: collectPreviewScheme,
    path: `/${baseName}.yaml`,
    query: documentUri.toString(),
  });
}

interface CardEditorInitialData {
  readonly documentUri: string;
  readonly rawText: string;
  readonly card?: WorkspaceCard;
  readonly imageUri?: string;
  readonly characterRoster?: Awaited<ReturnType<typeof loadCharacterRoster>>;
  readonly error?: string;
}

export class CardCustomEditorProvider implements vscode.CustomTextEditorProvider {
  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly dependencies: CardCustomEditorDependencies,
    private readonly previewProvider: VirtualDocumentStore,
  ) {}

  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ): void {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        getWebviewDistRoot(this.extensionUri),
        getDocumentWorkspaceRoot(document),
      ],
    };

    void initializeCardEditor(
      document,
      webviewPanel,
      this.extensionUri,
      this.dependencies,
      this.previewProvider,
    );
  }
}

async function initializeCardEditor(
  document: vscode.TextDocument,
  webviewPanel: vscode.WebviewPanel,
  extensionUri: vscode.Uri,
  dependencies: CardCustomEditorDependencies,
  previewProvider: VirtualDocumentStore,
): Promise<void> {
  const initialData = await createInitialData(document, webviewPanel.webview);

  webviewPanel.webview.html = createWebviewHtml(webviewPanel.webview, {
    extensionUri,
    title: 'Storyboard Card',
    view: 'card-editor',
    initialData,
  });

  const bridge = createWebviewBridge(
    webviewPanel.webview,
    createCardEditorHandlers(document, dependencies, previewProvider),
  );
  const documentChangeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.document.uri.toString() !== document.uri.toString()) {
      return;
    }

    void postCardChanged(document, webviewPanel);
  });

  webviewPanel.onDidDispose(() => {
    bridge.dispose();
    documentChangeSubscription.dispose();
  });
}

async function postCardChanged(
  document: vscode.TextDocument,
  webviewPanel: vscode.WebviewPanel,
): Promise<void> {
  const payload = await createInitialData(document, webviewPanel.webview);
  await webviewPanel.webview.postMessage({
    type: 'event',
    method: 'cards.changed',
    payload,
  });
}

export function registerCardCustomEditorProvider(
  context: vscode.ExtensionContext,
  dependencies: CardCustomEditorDependencies,
): vscode.Disposable {
  const previewProvider = new VirtualDocumentStore();

  return vscode.Disposable.from(
    previewProvider,
    vscode.workspace.registerTextDocumentContentProvider(collectPreviewScheme, previewProvider),
    vscode.window.registerCustomEditorProvider(
      cardEditorViewType,
      new CardCustomEditorProvider(context.extensionUri, dependencies, previewProvider),
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: false,
      },
    ),
  );
}

function createCardEditorHandlers(
  document: vscode.TextDocument,
  dependencies: CardCustomEditorDependencies,
  previewProvider: VirtualDocumentStore,
): StoryboardRpcHandlers {
  return {
    'cards.read': async (): Promise<{ readonly card: WorkspaceCard }> => ({
      card: parseWorkspaceCard(document.getText()),
    }),
    'cards.write': async (payload): Promise<{ readonly card: WorkspaceCard }> => {
      await replaceDocumentText(document, serializeWorkspaceCard(payload.card));
      return { card: payload.card };
    },
    'cards.writeRaw': async (
      payload,
    ): Promise<{ readonly card: WorkspaceCard; readonly rawText: string }> => {
      const card = parseWorkspaceCard(payload.rawText);
      const rawText = serializeWorkspaceCard(card);
      await replaceDocumentText(document, rawText);
      return { card, rawText };
    },
    'cards.structureScene': async (): Promise<
      StoryboardResponsePayload<'cards.structureScene'>
    > => {
      const card = parseWorkspaceCard(document.getText());

      if (card.type !== 'scene') {
        throw new Error('씬 카드에서만 구조화를 제안할 수 있습니다.');
      }

      const summary = card.summary?.trim() ?? '';
      if (summary.length === 0) {
        throw new Error('summary가 비어 있어 구조화를 제안할 수 없습니다.');
      }

      const missingFields = collectMissingStructureFields(card);
      if (missingFields.length === 0) {
        return { proposal: {} };
      }

      const fileName = document.uri.path.split('/').pop() ?? '';
      const sceneStem = parseSceneFileName(fileName)?.stem ?? card.id;
      const proposal = await dependencies.aiGateway
        .createService(document.uri)
        .proposeSceneStructure(
          {
            sceneSummary: summary,
            missingFields,
            knownFields: describeKnownStructureFields(card),
          },
          {
            providerId: dependencies.aiGateway.getTaskProvider('sceneStructure'),
            attribution: { primary: { kind: 'scene', id: sceneStem } },
          },
        );

      return { proposal };
    },
    'cards.collect': async (): Promise<StoryboardResponsePayload<'cards.collect'>> => {
      const card = parseCard(document.getText());
      const workspaceRoot = getDocumentWorkspaceRoot(document);
      const proposals = await dependencies.collectCardProposalsUseCase.execute(workspaceRoot, card);

      return { proposals };
    },
    'cards.applyCollect': async (
      payload,
    ): Promise<StoryboardResponsePayload<'cards.applyCollect'>> => {
      const card = parseCard(document.getText());
      const merged = applyCardCollectProposals(card, payload.accepted);
      await replaceDocumentText(document, serializeCard(merged));

      return { card: merged };
    },
    'cards.previewCollect': async (
      payload,
    ): Promise<StoryboardResponsePayload<'cards.previewCollect'>> => {
      const card = parseCard(document.getText());
      const merged = applyCardCollectProposals(card, payload.accepted);
      const previewUri = collectPreviewUri(document.uri);
      previewProvider.setContent(previewUri, serializeCard(merged));

      const fileName = document.uri.path.split('/').at(-1) ?? 'card';
      await vscode.commands.executeCommand(
        'vscode.diff',
        document.uri,
        previewUri,
        `${fileName} ↔ 수집 제안`,
        {
          preview: true,
        },
      );

      return {};
    },
  };
}

async function createInitialData(
  document: vscode.TextDocument,
  webview: vscode.Webview,
): Promise<CardEditorInitialData> {
  const rawText = document.getText();
  const workspaceRoot = getDocumentWorkspaceRoot(document);

  try {
    const card = parseWorkspaceCard(rawText);
    const characterRoster =
      card.type === 'character' ? await loadCharacterRoster(workspaceRoot) : undefined;

    return {
      documentUri: document.uri.toString(),
      rawText,
      card,
      imageUri: resolveCardImageUri(document, card, webview),
      ...(characterRoster === undefined ? {} : { characterRoster }),
    };
  } catch (error) {
    return {
      documentUri: document.uri.toString(),
      rawText,
      error: createCardErrorMessage(error),
    };
  }
}

function resolveCardImageUri(
  document: vscode.TextDocument,
  card: WorkspaceCard,
  webview: vscode.Webview,
): string | undefined {
  const relativeImagePath = card.type === 'character' ? card.profile : undefined;

  if (!relativeImagePath) {
    return undefined;
  }

  const cardDirectory = vscode.Uri.joinPath(document.uri, '..');
  return webview.asWebviewUri(vscode.Uri.joinPath(cardDirectory, relativeImagePath)).toString();
}

const sceneStructureScalarKeys = [
  'purpose',
  'conflict',
  'twist',
  'emotionalShift',
  'endState',
] as const;
const sceneStructureListKeys = ['foreshadowing', 'neededCanon'] as const;

function collectMissingStructureFields(card: SceneCard): SceneStructureFieldKey[] {
  const missingScalars = sceneStructureScalarKeys.filter(
    (key) => (card[key]?.trim() ?? '').length === 0,
  );
  const missingLists = sceneStructureListKeys.filter((key) => (card[key] ?? []).length === 0);

  return [...missingScalars, ...missingLists];
}

function describeKnownStructureFields(card: SceneCard): string[] {
  const scalars = sceneStructureScalarKeys.flatMap((key) => {
    const value = card[key]?.trim();
    return value ? [`- ${sceneSeedSectionLabels[key]}: ${value}`] : [];
  });
  const lists = sceneStructureListKeys.flatMap((key) => {
    const values = card[key] ?? [];
    return values.length > 0 ? [`- ${sceneSeedSectionLabels[key]}: ${values.join(', ')}`] : [];
  });

  return [...scalars, ...lists];
}

function getDocumentWorkspaceRoot(document: vscode.TextDocument): vscode.Uri {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  return workspaceFolder?.uri ?? vscode.Uri.joinPath(document.uri, '..');
}

async function replaceDocumentText(document: vscode.TextDocument, nextText: string): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length),
  );
  edit.replace(document.uri, fullRange, nextText);

  const isApplied = await vscode.workspace.applyEdit(edit);

  if (!isApplied) {
    throw new Error('카드 문서 변경을 적용하지 못했습니다.');
  }
}

function createCardErrorMessage(error: unknown): string {
  if (error instanceof CardParseError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return '카드를 읽을 수 없습니다.';
}
