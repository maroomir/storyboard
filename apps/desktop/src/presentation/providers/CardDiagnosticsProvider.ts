import * as vscode from 'vscode';
import { CardParseError, parseCard } from '@seedkernel/wasm';
import type { StoryboardLogger } from '../../infrastructure/vscode/logger';
import { isIgnoredSampleCardFileName } from '../../infrastructure/vscode/pathConventions';
import { resolveStoryboardWorkspaceRoot } from '../../infrastructure/vscode/workspace';
import { createDiagnostic } from './diagnosticsShared';

const cardSource = 'storyboard-card';
const cardGlobs = ['character/*.card', 'background/*.card'] as const;

export interface CardDiagnosticSpan {
  readonly line: number;
  readonly start: number;
  readonly end: number;
  readonly message: string;
}

export interface RegisterCardDiagnosticsProviderDependencies {
  readonly logger: StoryboardLogger;
}

// NOTE: 무효 카드는 씬 생성에서 조용히 탈락하므로(sceneContext), Problems 패널이 사용자에게 유일한
// 신호다. 엔진이 돌려주는 `키: 사유` 목록을 필드 단위 스팬으로 옮겨 어떤 키가 왜 틀렸는지 보여준다.
export function mapCardErrorToSpans(text: string, error: unknown): CardDiagnosticSpan[] {
  if (error instanceof CardParseError) {
    if (error.code === 'invalid-card-schema') {
      const issues = parseSchemaIssues(error.message);
      if (issues.length > 0) {
        return issues.map((issue) => schemaIssueToSpan(text, issue));
      }
    }

    if (error.code === 'invalid-yaml') {
      return [yamlErrorToSpan(text, undefined, error.message)];
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  return [{ line: 0, start: 0, end: firstLineLength(text), message }];
}

interface CardSchemaIssue {
  readonly path: string;
  readonly message: string;
}

// The engine reports `Card 스키마가 올바르지 않습니다. (path: reason; path: reason)`; each entry
// carries the dotted field path the reason belongs to.
function parseSchemaIssues(message: string): CardSchemaIssue[] {
  const detail = /\((.*)\)\s*$/s.exec(message)?.[1];
  if (detail === undefined) {
    return [];
  }

  return detail.split('; ').flatMap((entry) => {
    const separator = entry.indexOf(': ');
    if (separator === -1) {
      return [{ path: '', message: entry }];
    }
    return [{ path: entry.slice(0, separator), message: entry }];
  });
}

function schemaIssueToSpan(text: string, issue: CardSchemaIssue): CardDiagnosticSpan {
  const message = issue.message;
  const key = issue.path
    .split('.')
    .reverse()
    .find((segment) => segment.length > 0);
  const position = key ? locateKey(text, key) : undefined;

  return position
    ? { ...position, message }
    : { line: 0, start: 0, end: firstLineLength(text), message };
}

function locateKey(
  text: string,
  key: string,
): { readonly line: number; readonly start: number; readonly end: number } | undefined {
  const keyPattern = new RegExp(`^(\\s*)${escapeRegExp(key)}:`);
  const lines = text.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const match = keyPattern.exec(lines[index] ?? '');
    if (match) {
      const start = match[1]?.length ?? 0;
      return { line: index, start, end: start + key.length };
    }
  }

  return undefined;
}

function yamlErrorToSpan(text: string, cause: unknown, message: string): CardDiagnosticSpan {
  const mark = (cause as { mark?: { line?: number } } | undefined)?.mark;
  const line = typeof mark?.line === 'number' && mark.line >= 0 ? mark.line : 0;
  const lines = text.split('\n');

  return { line, start: 0, end: (lines[line] ?? '').length, message };
}

function firstLineLength(text: string): number {
  const newlineIndex = text.indexOf('\n');
  return newlineIndex === -1 ? text.length : newlineIndex;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cardFileName(uri: vscode.Uri): string {
  const segments = uri.path.split('/');
  return segments[segments.length - 1] ?? '';
}

function createRange(span: CardDiagnosticSpan): vscode.Range {
  const RangeCtor = (vscode as unknown as { Range?: typeof vscode.Range }).Range;
  return RangeCtor
    ? new RangeCtor(span.line, span.start, span.line, span.end)
    : ({
        start: { line: span.line, character: span.start },
        end: { line: span.line, character: span.end },
      } as vscode.Range);
}

class CardDiagnosticsController {
  private readonly collection = vscode.languages.createDiagnosticCollection(cardSource);

  public constructor(private readonly logger: StoryboardLogger) {}

  public async validateUri(uri: vscode.Uri): Promise<void> {
    if (isIgnoredSampleCardFileName(cardFileName(uri))) {
      return;
    }

    let text: string;
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      text = new TextDecoder().decode(bytes);
    } catch (error) {
      this.logger.error('Card diagnostics read failed', error);
      return;
    }

    try {
      parseCard(text);
      this.collection.delete(uri);
    } catch (error) {
      const severity = (vscode.DiagnosticSeverity?.Error ?? 0) as vscode.DiagnosticSeverity;
      const diagnostics = mapCardErrorToSpans(text, error).map((span) =>
        createDiagnostic(createRange(span), span.message, cardSource, severity),
      );
      this.collection.set(uri, diagnostics);
    }
  }

  public clear(uri: vscode.Uri): void {
    this.collection.delete(uri);
  }

  public async scanWorkspace(): Promise<void> {
    const root = await resolveStoryboardWorkspaceRoot();
    if (!root) {
      return;
    }

    for (const glob of cardGlobs) {
      const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(root, glob));
      for (const uri of uris) {
        await this.validateUri(uri);
      }
    }
  }

  public dispose(): void {
    this.collection.dispose();
  }
}

export function registerCardDiagnosticsProvider(
  dependencies: RegisterCardDiagnosticsProviderDependencies,
): vscode.Disposable {
  const controller = new CardDiagnosticsController(dependencies.logger);
  const watchers: vscode.Disposable[] = [];

  void (async (): Promise<void> => {
    await controller.scanWorkspace();

    const root = await resolveStoryboardWorkspaceRoot();
    if (!root) {
      return;
    }

    for (const glob of cardGlobs) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(root, glob),
      );
      watchers.push(
        watcher,
        watcher.onDidCreate((uri) => void controller.validateUri(uri)),
        watcher.onDidChange((uri) => void controller.validateUri(uri)),
        watcher.onDidDelete((uri) => controller.clear(uri)),
      );
    }
  })();

  return {
    dispose: (): void => {
      controller.dispose();
      watchers.forEach((watcher) => watcher.dispose());
    },
  };
}
