import * as vscode from "vscode"

import { CardParseError, parseCard, serializeCard } from "../files/card"
import { loadCharacterRoster } from "../core/relationGraphData"
import type { StoryboardCard } from "../shared/card"
import { createWebviewBridge, type StoryboardRpcHandlers } from "../messaging/bridge"
import { createWebviewHtml, getWebviewDistRoot } from "./webviewHtml"

const cardEditorViewType = "storyboard.card"

interface CardEditorInitialData {
  readonly documentUri: string
  readonly rawText: string
  readonly card?: StoryboardCard
  readonly imageUri?: string
  readonly characterRoster?: Awaited<ReturnType<typeof loadCharacterRoster>>
  readonly error?: string
}

export class CardCustomEditorProvider implements vscode.CustomTextEditorProvider {
  public constructor(private readonly extensionUri: vscode.Uri) {}

  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel
  ): void {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [getWebviewDistRoot(this.extensionUri), getDocumentWorkspaceRoot(document)]
    }

    void initializeCardEditor(document, webviewPanel, this.extensionUri)
  }
}

async function initializeCardEditor(
  document: vscode.TextDocument,
  webviewPanel: vscode.WebviewPanel,
  extensionUri: vscode.Uri
): Promise<void> {
  const initialData = await createInitialData(document, webviewPanel.webview)

  webviewPanel.webview.html = createWebviewHtml(webviewPanel.webview, {
    extensionUri,
    title: "Storyboard Card",
    view: "card-editor",
    initialData
  })

  const bridge = createWebviewBridge(webviewPanel.webview, createCardEditorHandlers(document))
  const documentChangeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.document.uri.toString() !== document.uri.toString()) {
      return
    }

    void postCardChanged(document, webviewPanel)
  })

  webviewPanel.onDidDispose(() => {
    bridge.dispose()
    documentChangeSubscription.dispose()
  })
}

async function postCardChanged(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
  const payload = await createInitialData(document, webviewPanel.webview)
  await webviewPanel.webview.postMessage({
    type: "event",
    method: "cards.changed",
    payload
  })
}

export function registerCardCustomEditorProvider(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.window.registerCustomEditorProvider(
    cardEditorViewType,
    new CardCustomEditorProvider(context.extensionUri),
    {
      webviewOptions: {
        retainContextWhenHidden: true
      },
      supportsMultipleEditorsPerDocument: false
    }
  )
}

function createCardEditorHandlers(document: vscode.TextDocument): StoryboardRpcHandlers {
  return {
    "cards.read": async (): Promise<{ readonly card: StoryboardCard }> => ({
      card: parseCard(document.getText())
    }),
    "cards.write": async (payload): Promise<{ readonly card: StoryboardCard }> => {
      await replaceDocumentText(document, serializeCard(payload.card))
      return { card: payload.card }
    },
    "cards.writeRaw": async (payload): Promise<{ readonly card: StoryboardCard; readonly rawText: string }> => {
      const card = parseCard(payload.rawText)
      const rawText = serializeCard(card)
      await replaceDocumentText(document, rawText)
      return { card, rawText }
    }
  }
}

async function createInitialData(document: vscode.TextDocument, webview: vscode.Webview): Promise<CardEditorInitialData> {
  const rawText = document.getText()
  const workspaceRoot = getDocumentWorkspaceRoot(document)

  try {
    const card = parseCard(rawText)
    const characterRoster = card.type === "character" ? await loadCharacterRoster(workspaceRoot) : undefined

    return {
      documentUri: document.uri.toString(),
      rawText,
      card,
      imageUri: resolveCardImageUri(document, card, webview),
      ...(characterRoster === undefined ? {} : { characterRoster })
    }
  } catch (error) {
    return {
      documentUri: document.uri.toString(),
      rawText,
      error: createCardErrorMessage(error)
    }
  }
}

function resolveCardImageUri(
  document: vscode.TextDocument,
  card: StoryboardCard,
  webview: vscode.Webview
): string | undefined {
  const relativeImagePath = card.type === "character" ? card.profile : undefined

  if (!relativeImagePath) {
    return undefined
  }

  const cardDirectory = vscode.Uri.joinPath(document.uri, "..")
  return webview.asWebviewUri(vscode.Uri.joinPath(cardDirectory, relativeImagePath)).toString()
}

function getDocumentWorkspaceRoot(document: vscode.TextDocument): vscode.Uri {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
  return workspaceFolder?.uri ?? vscode.Uri.joinPath(document.uri, "..")
}

async function replaceDocumentText(document: vscode.TextDocument, nextText: string): Promise<void> {
  const edit = new vscode.WorkspaceEdit()
  const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length))
  edit.replace(document.uri, fullRange, nextText)

  const isApplied = await vscode.workspace.applyEdit(edit)

  if (!isApplied) {
    throw new Error("카드 문서 변경을 적용하지 못했습니다.")
  }
}

function createCardErrorMessage(error: unknown): string {
  if (error instanceof CardParseError) {
    return error.message
  }

  if (error instanceof Error) {
    return error.message
  }

  return "카드를 읽을 수 없습니다."
}
