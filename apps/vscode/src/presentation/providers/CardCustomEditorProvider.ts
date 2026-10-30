import { uriExists } from '@/infrastructure/vscode/workspace';
import * as vscode from 'vscode';

import type { AiGateway } from '@storyboard/story-engine';
import type { CardManager } from '@storyboard/story-app';
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
  describeNarration,
  applyCardCollectProposals,
  sceneStructureTextFields,
  sceneStructureListFields,
} from '@storyboard/story-model';
import type {
  SceneCard,
  WorkspaceCard,
  StoryboardRequestPayload,
  StoryboardResponsePayload,
  StoryboardCard,
  CardCollectProposal,
  NarratorCard,
  SceneStructureFieldKey,
  SceneStructureTextField,
  NarratorSummary,
  CharacterRosterEntry,
  SceneStructureProposal,
} from '@storyboard/story-model';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import { VirtualDocumentStore } from '@/presentation/providers/virtualDocumentStore';
import {
  createWebviewBridge,
  type StoryboardRpcHandlers,
  type StoryboardWebviewBridge,
} from '@/presentation/messaging/bridge';
import type { AiProviderRegistry } from '@storyboard/story-ai';
import type { UsageRecorder } from '@/infrastructure/ai/UsageRecorder';
import { createWebviewHtml, getWebviewDistRoot } from '@/presentation/providers/webviewHtml';
import { cardEditorViewType } from '@/contributionIds';

export interface CardCustomEditorDependencies {
  readonly aiGateway: AiGateway;
  readonly aiProviderRegistry: AiProviderRegistry;
  readonly cards: Pick<CardManager, 'collectProposals' | 'loadCharacterRoster' | 'listNarrators'>;
  readonly usageRecorder: UsageRecorder;
  readonly logger: IStoryboardLogger;
}

export const collectPreviewScheme: string = 'storyboard-collect';

function collectPreviewUri(documentUri: vscode.Uri): vscode.Uri {
  const baseName: string = (documentUri.path.split('/').at(-1) ?? 'card.card').replace(
    /\.card$/,
    '',
  );
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
  readonly characterRoster?: readonly CharacterRosterEntry[];
  readonly narratorRoster?: readonly { id: string; name: string; summary: string }[];
  readonly error?: string;
}

export class CardCustomEditorProvider implements vscode.CustomTextEditorProvider {
  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly dependencies: CardCustomEditorDependencies,
    private readonly previewProvider: VirtualDocumentStore,
  ) {}

  public register(): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(cardEditorViewType, this, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
      supportsMultipleEditorsPerDocument: false,
    });
  }

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
  const initialData: CardEditorInitialData = await createInitialData(
    document,
    webviewPanel.webview,
    dependencies.cards,
  );

  webviewPanel.webview.html = createWebviewHtml(webviewPanel.webview, {
    extensionUri,
    title: 'Storyboard Card',
    view: 'card-editor',
    initialData,
  });

  const bridge: StoryboardWebviewBridge = createWebviewBridge(
    webviewPanel.webview,
    new CardEditorRpc(document, dependencies, previewProvider).handlers(),
  );
  const documentChangeSubscription: vscode.Disposable = vscode.workspace.onDidChangeTextDocument(
    (event) => {
      if (event.document.uri.toString() !== document.uri.toString()) {
        return;
      }

      void postCardChanged(document, webviewPanel, dependencies.cards);
    },
  );

  webviewPanel.onDidDispose(() => {
    bridge.dispose();
    documentChangeSubscription.dispose();
  });
}

async function postCardChanged(
  document: vscode.TextDocument,
  webviewPanel: vscode.WebviewPanel,
  cards: CardCustomEditorDependencies['cards'],
): Promise<void> {
  const payload: CardEditorInitialData = await createInitialData(
    document,
    webviewPanel.webview,
    cards,
  );
  await webviewPanel.webview.postMessage({
    type: 'event',
    method: 'cards.changed',
    payload,
  });
}

class CardEditorRpc {
  public constructor(
    private readonly document: vscode.TextDocument,
    private readonly dependencies: CardCustomEditorDependencies,
    private readonly previewProvider: VirtualDocumentStore,
  ) {}

  public handlers(): StoryboardRpcHandlers {
    return {
      'cards.read': this.readCard,
      'cards.write': this.writeCard,
      'cards.writeRaw': this.writeRawCard,
      'cards.structureScene': this.structureScene,
      'cards.collect': this.collectProposals,
      'cards.applyCollect': this.applyCollect,
      'cards.previewCollect': this.previewCollect,
    };
  }

  private readonly readCard = async (): Promise<{ readonly card: WorkspaceCard }> => ({
    card: await loadEditorCard(this.document),
  });

  private readonly writeCard = async (
    payload: StoryboardRequestPayload<'cards.write'>,
  ): Promise<{ readonly card: WorkspaceCard }> => {
    await persistEditorCard(this.document, payload.card);
    return { card: payload.card };
  };

  private readonly writeRawCard = async (
    payload: StoryboardRequestPayload<'cards.writeRaw'>,
  ): Promise<{ readonly card: WorkspaceCard; readonly rawText: string }> => {
    const card: WorkspaceCard = parseWorkspaceCard(payload.rawText);
    const rawText: string = await persistEditorCard(this.document, card);
    return { card, rawText };
  };

  private readonly structureScene = async (): Promise<
    StoryboardResponsePayload<'cards.structureScene'>
  > => {
    const card: WorkspaceCard = await loadEditorCard(this.document);

    if (card.type !== 'scene') {
      throw new Error('씬 카드에서만 구조화를 제안할 수 있습니다.');
    }

    const summary: string = card.summary?.trim() ?? '';
    if (summary.length === 0) {
      throw new Error('summary가 비어 있어 구조화를 제안할 수 없습니다.');
    }

    const missingFields: SceneStructureFieldKey[] = collectMissingStructureFields(card);
    if (missingFields.length === 0) {
      return { proposal: {} };
    }

    return { proposal: await this.proposeSceneStructure(card, summary, missingFields) };
  };

  private async proposeSceneStructure(
    card: SceneCard,
    summary: string,
    missingFields: readonly SceneStructureFieldKey[],
  ): Promise<SceneStructureProposal> {
    const { aiGateway } = this.dependencies;
    const fileName: string = this.document.uri.path.split('/').pop() ?? '';
    const sceneStem: string = parseSceneFileName(fileName)?.stem ?? card.id;
    return await aiGateway.createService(this.document.uri).proposeSceneStructure(
      {
        sceneSummary: summary,
        missingFields,
        knownFields: describeKnownStructureFields(card),
      },
      {
        providerId: aiGateway.getTaskProvider('sceneStructure'),
        attribution: { primary: { kind: 'scene', id: sceneStem } },
      },
    );
  }

  private readonly collectProposals = async (): Promise<
    StoryboardResponsePayload<'cards.collect'>
  > => {
    const card: StoryboardCard = parseCard(this.document.getText());
    const workspaceRoot: vscode.Uri = getDocumentWorkspaceRoot(this.document);
    const proposals: CardCollectProposal[] = await this.dependencies.cards.collectProposals({
      workspaceRoot,
      card,
    });

    return { proposals };
  };

  private readonly applyCollect = async (
    payload: StoryboardRequestPayload<'cards.applyCollect'>,
  ): Promise<StoryboardResponsePayload<'cards.applyCollect'>> => {
    const card: StoryboardCard = parseCard(this.document.getText());
    const merged: StoryboardCard = applyCardCollectProposals(card, payload.accepted);
    await replaceDocumentText(this.document, serializeCard(merged));

    return { card: merged };
  };

  private readonly previewCollect = async (
    payload: StoryboardRequestPayload<'cards.previewCollect'>,
  ): Promise<StoryboardResponsePayload<'cards.previewCollect'>> => {
    const card: StoryboardCard = parseCard(this.document.getText());
    const merged: StoryboardCard = applyCardCollectProposals(card, payload.accepted);
    const previewUri: vscode.Uri = collectPreviewUri(this.document.uri);
    this.previewProvider.setContent(previewUri, serializeCard(merged));

    const fileName: string = this.document.uri.path.split('/').at(-1) ?? 'card';
    await vscode.commands.executeCommand(
      'vscode.diff',
      this.document.uri,
      previewUri,
      `${fileName} ↔ 수집 제안`,
      {
        preview: true,
      },
    );

    return {};
  };
}

async function loadNarratorRoster(
  cards: Pick<CardManager, 'listNarrators'>,
  workspaceRoot: vscode.Uri,
): Promise<NarratorSummary[]> {
  const narrators: ReadonlyMap<string, NarratorCard> = await cards.listNarrators(workspaceRoot);

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
  cards: CardCustomEditorDependencies['cards'],
): Promise<CardEditorInitialData> {
  const rawText: string = document.getText();
  const workspaceRoot: vscode.Uri = getDocumentWorkspaceRoot(document);

  try {
    const card: WorkspaceCard = await loadEditorCard(document);
    const characterRoster: readonly CharacterRosterEntry[] | undefined =
      card.type === 'character' ? await cards.loadCharacterRoster(workspaceRoot) : undefined;
    const narratorRoster: NarratorSummary[] | undefined =
      card.type === 'scene' ? await loadNarratorRoster(cards, workspaceRoot) : undefined;

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
  const relativeImagePath: string | undefined =
    card.type === 'character' ? card.profile : undefined;

  if (!relativeImagePath) {
    return undefined;
  }

  const cardDirectory: vscode.Uri = vscode.Uri.joinPath(document.uri, '..');
  return webview.asWebviewUri(vscode.Uri.joinPath(cardDirectory, relativeImagePath)).toString();
}

function collectMissingStructureFields(card: SceneCard): SceneStructureFieldKey[] {
  const missingScalars: SceneStructureTextField[] = sceneStructureTextFields.filter(
    (key) => (card[key]?.trim() ?? '').length === 0,
  );
  const missingLists: ('foreshadowing' | 'neededCanon')[] = sceneStructureListFields.filter(
    (key) => (card[key] ?? []).length === 0,
  );

  return [...missingScalars, ...missingLists];
}

function describeKnownStructureFields(card: SceneCard): string[] {
  const scalars: string[] = sceneStructureTextFields.flatMap((key) => {
    const value: string | undefined = card[key]?.trim();
    return value ? [`- ${sceneSeedSectionLabels[key]}: ${value}`] : [];
  });
  const lists: string[] = sceneStructureListFields.flatMap((key) => {
    const values: string[] = card[key] ?? [];
    return values.length > 0 ? [`- ${sceneSeedSectionLabels[key]}: ${values.join(', ')}`] : [];
  });

  return [...scalars, ...lists];
}

function getDocumentWorkspaceRoot(document: vscode.TextDocument): vscode.Uri {
  const workspaceFolder: vscode.WorkspaceFolder | undefined = vscode.workspace.getWorkspaceFolder(
    document.uri,
  );
  return workspaceFolder?.uri ?? vscode.Uri.joinPath(document.uri, '..');
}

async function loadEditorCard(document: vscode.TextDocument): Promise<WorkspaceCard> {
  const card: WorkspaceCard = parseWorkspaceCard(document.getText());
  const summaryFileName: string | undefined =
    card.type === 'scene' ? sceneSummaryReference(card.summary) : undefined;

  if (card.type !== 'scene' || summaryFileName === undefined) {
    return card;
  }

  const summaryText: string = await readSiblingText(
    sceneSummarySiblingUri(document, summaryFileName),
  );
  return { ...card, summary: summaryText.trim() === '' ? undefined : summaryText.trimEnd() };
}

async function persistEditorCard(
  document: vscode.TextDocument,
  card: WorkspaceCard,
): Promise<string> {
  if (card.type !== 'scene') {
    return replaceCardText(document, serializeWorkspaceCard(card));
  }

  const existingReference: string | undefined = resolveExistingSummaryReference(document);
  const inlineSummary: string | undefined = isInlineSceneSummary(card.summary)
    ? card.summary?.trim()
    : undefined;

  if (existingReference === undefined && inlineSummary === undefined) {
    return replaceCardText(document, serializeWorkspaceCard(card));
  }

  const fileName: string = document.uri.path.split('/').pop() ?? '';
  const summaryFileName: string =
    existingReference ?? sceneSummaryFileName(parseSceneFileName(fileName)?.stem ?? card.id);
  await writeSiblingText(
    sceneSummarySiblingUri(document, summaryFileName),
    `${inlineSummary ?? ''}\n`,
  );

  return replaceCardText(document, serializeWorkspaceCard({ ...card, summary: summaryFileName }));
}

function resolveExistingSummaryReference(document: vscode.TextDocument): string | undefined {
  try {
    const current: WorkspaceCard = parseWorkspaceCard(document.getText());
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
  const open: vscode.TextDocument | undefined = findOpenDocument(uri);
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
  const open: vscode.TextDocument | undefined =
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
  const edit: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
  const fullRange: vscode.Range = new vscode.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length),
  );
  edit.replace(document.uri, fullRange, nextText);

  const isApplied: boolean = await vscode.workspace.applyEdit(edit);

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
