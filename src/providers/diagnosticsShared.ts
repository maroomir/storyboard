import * as vscode from "vscode"

export function toRange(document: vscode.TextDocument, start: number, end: number): vscode.Range | undefined {
  const body = document.getText()
  if (start < 0 || end < start || end > body.length) {
    return undefined
  }

  const startPosition = document.positionAt(start)
  const endPosition = document.positionAt(end)
  const RangeCtor = (vscode as unknown as { Range?: typeof vscode.Range }).Range
  return RangeCtor ? new RangeCtor(startPosition, endPosition) : ({ start: startPosition, end: endPosition } as vscode.Range)
}

export function createWarningDiagnostic(range: vscode.Range, message: string, source: string): vscode.Diagnostic {
  const DiagnosticCtor = (vscode as unknown as { Diagnostic?: typeof vscode.Diagnostic }).Diagnostic
  const warningSeverity = (vscode.DiagnosticSeverity?.Warning ?? 1) as unknown as vscode.DiagnosticSeverity

  const diagnostic = DiagnosticCtor
    ? new DiagnosticCtor(range, message, warningSeverity)
    : ({ range, message, severity: warningSeverity } as vscode.Diagnostic)
  diagnostic.source = source
  return diagnostic
}
