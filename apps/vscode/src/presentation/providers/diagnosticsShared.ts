import * as vscode from 'vscode';

export function toRange(
  document: vscode.TextDocument,
  start: number,
  end: number,
): vscode.Range | undefined {
  const body: string = document.getText();
  if (start < 0 || end < start || end > body.length) {
    return undefined;
  }

  const startPosition: vscode.Position = document.positionAt(start);
  const endPosition: vscode.Position = document.positionAt(end);
  const RangeCtor: typeof vscode.Range | undefined = (
    vscode as unknown as { Range?: typeof vscode.Range }
  ).Range;
  return RangeCtor
    ? new RangeCtor(startPosition, endPosition)
    : ({ start: startPosition, end: endPosition } as vscode.Range);
}

export function createDiagnostic(
  range: vscode.Range,
  message: string,
  source: string,
  severity: vscode.DiagnosticSeverity,
): vscode.Diagnostic {
  const DiagnosticCtor: typeof vscode.Diagnostic | undefined = (
    vscode as unknown as { Diagnostic?: typeof vscode.Diagnostic }
  ).Diagnostic;

  const diagnostic: vscode.Diagnostic = DiagnosticCtor
    ? new DiagnosticCtor(range, message, severity)
    : ({ range, message, severity } as vscode.Diagnostic);
  diagnostic.source = source;
  return diagnostic;
}

export function createWarningDiagnostic(
  range: vscode.Range,
  message: string,
  source: string,
): vscode.Diagnostic {
  const warningSeverity: vscode.DiagnosticSeverity = (vscode.DiagnosticSeverity?.Warning ??
    1) as unknown as vscode.DiagnosticSeverity;
  return createDiagnostic(range, message, source, warningSeverity);
}
