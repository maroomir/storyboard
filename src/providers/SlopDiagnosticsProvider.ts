import * as vscode from "vscode"

import type { StoryboardLogger } from "../core/logger"
import { isDraftMarkdownFile } from "../core/pathConventions"
import { createDiagnostic, createWarningDiagnostic, toRange } from "./diagnosticsShared"
import { hasStoryboardProject } from "../core/workspace"
import { parseDraft } from "../files/draft"
import { analyzeSlop, type SlopFinding } from "../shared/slop"

const slopCheckCommand = "storyboard.draft.slopCheck"
const slopSource = "storyboard-slop"
const slopDebounceMs = 700

export interface RegisterSlopDiagnosticsProviderDependencies {
  readonly logger: StoryboardLogger
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function computeBodyOffset(documentText: string, body: string): number {
  const normalized = documentText.replace(/\r\n/g, "\n")
  if (!normalized.endsWith(body)) {
    return normalized.indexOf(body)
  }
  return normalized.length - body.length
}

export function toSlopRange(
  document: vscode.TextDocument,
  finding: SlopFinding,
  bodyOffset: number
): vscode.Range | undefined {
  return toRange(document, finding.start + bodyOffset, finding.end + bodyOffset)
}

export function mapSlopFindingsToDiagnostics(
  document: vscode.TextDocument,
  findings: readonly SlopFinding[],
  bodyOffset: number
): vscode.Diagnostic[] {
  return findings.flatMap((finding) => {
    const range = toSlopRange(document, finding, bodyOffset)
    if (!range) {
      return []
    }

    const diagnostic =
      finding.severity === "warning"
        ? createWarningDiagnostic(range, finding.message, slopSource)
        : createDiagnostic(
            range,
            finding.message,
            slopSource,
            (vscode.DiagnosticSeverity?.Information ?? 2) as vscode.DiagnosticSeverity
          )
    return [diagnostic]
  })
}

class SlopDiagnosticsController {
  private readonly collection = vscode.languages.createDiagnosticCollection(slopSource)
  private readonly pendingByUri = new Map<string, number>()

  public constructor(private readonly dependencies: RegisterSlopDiagnosticsProviderDependencies) {}

  public getDiagnosticsCollection(): vscode.DiagnosticCollection {
    return this.collection
  }

  public async runForDocument(document: vscode.TextDocument): Promise<void> {
    if (!(await this.canRun(document))) {
      this.collection.delete(document.uri)
      return
    }

    const documentText = document.getText()

    let body: string
    try {
      body = parseDraft(documentText).body
    } catch (error) {
      this.dependencies.logger.error("Slop check parse failed", error)
      this.collection.delete(document.uri)
      return
    }

    const bodyOffset = computeBodyOffset(documentText, body)
    const findings = analyzeSlop(body)
    this.collection.set(document.uri, mapSlopFindingsToDiagnostics(document, findings, bodyOffset))
  }

  public scheduleRealtimeCheck(document: vscode.TextDocument): void {
    const key = document.uri.toString()
    const nextToken = (this.pendingByUri.get(key) ?? 0) + 1
    this.pendingByUri.set(key, nextToken)

    void (async (): Promise<void> => {
      await sleep(slopDebounceMs)
      if (this.pendingByUri.get(key) !== nextToken) {
        return
      }
      await this.runForDocument(document)
    })()
  }

  public dispose(): void {
    this.collection.dispose()
  }

  private async canRun(document: vscode.TextDocument): Promise<boolean> {
    if (document.uri.scheme !== "file") {
      return false
    }
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
    if (!workspaceFolder) {
      return false
    }
    if (!(await hasStoryboardProject(workspaceFolder))) {
      return false
    }
    return isDraftMarkdownFile(document.uri, workspaceFolder)
  }
}

async function runSlopCheckCommand(controller: SlopDiagnosticsController, uri?: vscode.Uri): Promise<void> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri
  if (!targetUri) {
    await vscode.window.showErrorMessage("활성 드래프트 파일을 찾을 수 없습니다.")
    return
  }

  const document = await vscode.workspace.openTextDocument(targetUri)
  await controller.runForDocument(document)
}

export function registerSlopDiagnosticsProvider(
  dependencies: RegisterSlopDiagnosticsProviderDependencies
): vscode.Disposable {
  const controller = new SlopDiagnosticsController(dependencies)

  const commandRegistration = vscode.commands.registerCommand(slopCheckCommand, (uri?: vscode.Uri) =>
    runSlopCheckCommand(controller, uri)
  )
  const saveListener = vscode.workspace.onDidSaveTextDocument((document) => {
    const realtimeEnabled = vscode.workspace
      .getConfiguration("storyboard")
      .get<boolean>("slop.realtimeEnabled", false)

    if (!realtimeEnabled) {
      return
    }

    controller.scheduleRealtimeCheck(document)
  })
  const closeListener = vscode.workspace.onDidCloseTextDocument((document) => {
    controller.getDiagnosticsCollection().delete(document.uri)
  })

  return vscode.Disposable.from(controller, commandRegistration, saveListener, closeListener)
}
