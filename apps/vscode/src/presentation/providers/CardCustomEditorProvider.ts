import { vscodeFileSystem } from '@/infrastructure/vscode/vscodeFileSystem';
import { uriExists } from '@/infrastructure/vscode/workspace';
import * as vscode from 'vscode';

import type { AiGateway } from '@storyboard/story-engine';
import type { CollectCardProposalsUseCase } from '@storyboard/story-engine';
import {
  CardParseError,
  isInlineSceneSummary,
  parseCard,
  parseSceneFileName,
  parseWorkspaceCard,
  sceneSeedSectionLabels,
  sceneSummaryFileName,
  sceneSummaryReference,
  serializeCard,
  serializeWorkspaceCard,
} from '@storyboard/story-format';
import type { SceneCard, WorkspaceCard } from '@storyboard/story-format';
import type { SceneStructureFieldKey } from '@storyboard/story-ai';
import { applyCardCollectProposals } from '@storyboard/story-engine';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import {
  getStoryboardProjectPaths,
  loadCharacterRoster,
  loadNarratorCards,
} from '@storyboard/story-engine';
import { describeNarration } from '@storyboard/story-ai';
import { VirtualDocumentStore } from './virtualDocumentStore';
import type { StoryboardResponsePayload } from '@storyboard/story-engine';
import { createWebviewBridge, type StoryboardRpcHandlers } from '@/presentation/messaging/bridge';
import type { AiProviderRegistry } from '@storyboard/story-ai';
import type { UsageRecorder } from '@/infrastructure/ai/UsageRecorder';
import { createWebviewHtml, getWebviewDistRoot } from './webviewHtml';
import { cardEditorViewType } from '@/contributionIds';

export interface CardCustomEditorDependencies {
  readonly aiGateway: AiGateway;
  readonly aiProviderRegistry: AiProviderRegistry;
  readonly collectCardProposalsUseCase: CollectCardProposalsUseCase;
  readonly usageRecorder: UsageRecorder;
  readonly logger: IStoryboardLogger;
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
  readonly narratorRoster?: readonly { id: string; name: string; summary: string }[];
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
      card: await loadEditorCard(document),
    }),
    'cards.write': async (payload): Promise<{ readonly card: WorkspaceCard }> => {
      await persistEditorCard(document, payload.card);
      return { card: payload.card };
    },
    'cards.writeRaw': async (
      payload,
    ): Promise<{ readonly card: WorkspaceCard; readonly rawText: string }> => {
      const card = parseWorkspaceCard(payload.rawText);
      const rawText = await persistEditorCard(document, card);
      return { card, rawText };
    },
    'cards.structureScene': async (): Promise<
      StoryboardResponsePayload<'cards.structureScene'>
    > => {
      const card = await loadEditorCard(document);

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
      const proposals = await dependencies.collectCardProposalsUseCase.execute({
        workspaceRoot,
        card,
      });

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

async function loadNarratorRoster(
  workspaceRoot: vscode.Uri,
): Promise<{ id: string; name: string; summary: string }[]> {
  const narrators = await loadNarratorCards(
    getStoryboardProjectPaths(workspaceRoot),
    vscodeFileSystem,
  );

  return [...narrators.values()].map((card) => ({
    id: card.id,
    name: card.name,
    summary: describeNarration({
      person: card.person,
      knowledge: card.knowledge,
      ...(card.focal === undefined ? {} : { focal: card.focal }),
      tense: card.tense ?? 'past',
    }),
  }));
}

async function createInitialData(
  document: vscode.TextDocument,
  webview: vscode.Webview,
): Promise<CardEditorInitialData> {
  const rawText = document.getText();
  const workspaceRoot = getDocumentWorkspaceRoot(document);

  try {
    const card = await loadEditorCard(document);
    const characterRoster =
      card.type === 'character'
        ? await loadCharacterRoster(vscodeFileSystem, workspaceRoot)
        : undefined;
    // 씬 카드의 서술자 드롭다운은 워크스페이스의 서술자 카드에서 채운다.
    const narratorRoster =
      card.type === 'scene' ? await loadNarratorRoster(workspaceRoot) : undefined;

    return {
      documentUri: document.uri.toString(),
      rawText,
      card,
      imageUri: resolveCardImageUri(document, card, webview),
      ...(characterRoster === undefined ? {} : { characterRoster }),
      ...(narratorRoster === undefined ? {} : { narratorRoster }),
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

// NOTE: The editor shows summary prose, but the card on disk holds only `<stem>.summary.md`;
// the prose lives in that sidecar so a creator's summary stays apart from machine-written beats.
async function loadEditorCard(document: vscode.TextDocument): Promise<WorkspaceCard> {
  const card = parseWorkspaceCard(document.getText());
  const summaryFileName = card.type === 'scene' ? sceneSummaryReference(card.summary) : undefined;

  if (card.type !== 'scene' || summaryFileName === undefined) {
    return card;
  }

  const summaryText = await readSiblingText(sceneSummarySiblingUri(document, summaryFileName));
  return { ...card, summary: summaryText.trim() === '' ? undefined : summaryText.trimEnd() };
}

async function persistEditorCard(
  document: vscode.TextDocument,
  card: WorkspaceCard,
): Promise<string> {
  if (card.type !== 'scene') {
    return replaceCardText(document, serializeWorkspaceCard(card));
  }

  const existingReference = resolveExistingSummaryReference(document);
  const inlineSummary = isInlineSceneSummary(card.summary) ? card.summary?.trim() : undefined;

  if (existingReference === undefined && inlineSummary === undefined) {
    return replaceCardText(document, serializeWorkspaceCard(card));
  }

  const fileName = document.uri.path.split('/').pop() ?? '';
  const summaryFileName =
    existingReference ?? sceneSummaryFileName(parseSceneFileName(fileName)?.stem ?? card.id);
  await writeSiblingText(
    sceneSummarySiblingUri(document, summaryFileName),
    `${inlineSummary ?? ''}\n`,
  );

  return replaceCardText(document, serializeWorkspaceCard({ ...card, summary: summaryFileName }));
}

function resolveExistingSummaryReference(document: vscode.TextDocument): string | undefined {
  try {
    const current = parseWorkspaceCard(document.getText());
    return current.type === 'scene' ? sceneSummaryReference(current.summary) : undefined;
  } catch {
    return undefined;
  }
}

function sceneSummarySiblingUri(document: vscode.TextDocument, fileName: string): vscode.Uri {
  return vscode.Uri.joinPath(document.uri, '..', fileName);
}

function findOpenDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
  return vscode.workspace.textDocuments.find(
    (candidate) => candidate.uri.toString() === uri.toString(),
  );
}

async function readSiblingText(uri: vscode.Uri): Promise<string> {
  const open = findOpenDocument(uri);
  if (open !== undefined) {
    return open.getText();
  }

  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return '';
  }
}

async function writeSiblingText(uri: vscode.Uri, text: string): Promise<void> {
  const open =
    findOpenDocument(uri) ??
    ((await uriExists(uri)) ? await vscode.workspace.openTextDocument(uri) : undefined);

  if (open === undefined) {
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
    return;
  }

  if (open.getText() !== text) {
    await replaceDocumentText(open, text);
  }
}

async function replaceCardText(document: vscode.TextDocument, nextText: string): Promise<string> {
  await replaceDocumentText(document, nextText);
  return nextText;
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
