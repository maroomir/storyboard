import * as vscode from 'vscode';
import { ZodError, type ZodIssue } from 'zod';

import {
  CardParseError,
  STORYBOARD_GLOBS,
  parseCard,
  isIgnoredSampleCardFileName,
} from '@storyboard/story-model';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import { resolveStoryboardWorkspaceRoot } from '@/infrastructure/vscode/workspace';
import { createDiagnostic } from './diagnosticsShared';

const cardSource: string = 'storyboard-card';
const cardGlobs: readonly string[] = [
  STORYBOARD_GLOBS.characterCards,
  STORYBOARD_GLOBS.backgroundCards,
];

export interface CardDiagnosticSpan {
  readonly line: number;
  readonly start: number;
  readonly end: number;
  readonly message: string;
}

export interface RegisterCardDiagnosticsProviderDependencies {
  readonly logger: IStoryboardLogger;
}

export function mapCardErrorToSpans(text: string, error: unknown): CardDiagnosticSpan[] {
  if (error instanceof CardParseError) {
    if (error.code === 'invalid-card-schema' && error.cause instanceof ZodError) {
      return error.cause.issues.map((issue) => schemaIssueToSpan(text, issue));
    }

    if (error.code === 'invalid-yaml') {
      return [yamlErrorToSpan(text, error.cause, error.message)];
    }
  }

  const message: string = error instanceof Error ? error.message : String(error);
  return [{ line: 0, start: 0, end: firstLineLength(text), message }];
}

function schemaIssueToSpan(text: string, issue: ZodIssue): CardDiagnosticSpan {
  const message: string =
    issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message;
  const key: string | undefined = [...issue.path]
    .reverse()
    .find((segment): segment is string => typeof segment === 'string');
  const position: KeyLocation | undefined = key ? locateKey(text, key) : undefined;

  return position
    ? { ...position, message }
    : { line: 0, start: 0, end: firstLineLength(text), message };
}

interface KeyLocation {
  readonly line: number;
  readonly start: number;
  readonly end: number;
}

function locateKey(text: string, key: string): KeyLocation | undefined {
  const keyPattern: RegExp = new RegExp(`^(\\s*)${escapeRegExp(key)}:`);
  const lines: string[] = text.split('\n');

  for (let index: number = 0; index < lines.length; index += 1) {
    const match: RegExpExecArray | null = keyPattern.exec(lines[index] ?? '');
    if (match) {
      const start: number = match[1]?.length ?? 0;
      return { line: index, start, end: start + key.length };
    }
  }

  return undefined;
}

interface YamlErrorMark {
  readonly line?: number;
}

function yamlErrorToSpan(text: string, cause: unknown, message: string): CardDiagnosticSpan {
  const mark: YamlErrorMark | undefined = (cause as { mark?: YamlErrorMark } | undefined)?.mark;
  const line: number = typeof mark?.line === 'number' && mark.line >= 0 ? mark.line : 0;
  const lines: string[] = text.split('\n');

  return { line, start: 0, end: (lines[line] ?? '').length, message };
}

function firstLineLength(text: string): number {
  const newlineIndex: number = text.indexOf('\n');
  return newlineIndex === -1 ? text.length : newlineIndex;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cardFileName(uri: vscode.Uri): string {
  const segments: string[] = uri.path.split('/');
  return segments[segments.length - 1] ?? '';
}

function createRange(span: CardDiagnosticSpan): vscode.Range {
  const RangeCtor: typeof vscode.Range | undefined = (
    vscode as unknown as { Range?: typeof vscode.Range }
  ).Range;
  return RangeCtor
    ? new RangeCtor(span.line, span.start, span.line, span.end)
    : ({
        start: { line: span.line, character: span.start },
        end: { line: span.line, character: span.end },
      } as vscode.Range);
}

class CardDiagnosticsController {
  private readonly collection: vscode.DiagnosticCollection =
    vscode.languages.createDiagnosticCollection(cardSource);

  public constructor(private readonly logger: IStoryboardLogger) {}

  public async validateUri(uri: vscode.Uri): Promise<void> {
    if (isIgnoredSampleCardFileName(cardFileName(uri))) {
      return;
    }

    let text: string;
    try {
      const bytes: Uint8Array<ArrayBufferLike> = await vscode.workspace.fs.readFile(uri);
      text = new TextDecoder().decode(bytes);
    } catch (error) {
      this.logger.error('Card diagnostics read failed', error);
      return;
    }

    try {
      parseCard(text);
      this.collection.delete(uri);
    } catch (error) {
      const severity: vscode.DiagnosticSeverity = (vscode.DiagnosticSeverity?.Error ??
        0) as vscode.DiagnosticSeverity;
      const diagnostics: vscode.Diagnostic[] = mapCardErrorToSpans(text, error).map((span) =>
        createDiagnostic(createRange(span), span.message, cardSource, severity),
      );
      this.collection.set(uri, diagnostics);
    }
  }

  public clear(uri: vscode.Uri): void {
    this.collection.delete(uri);
  }

  public async scanWorkspace(): Promise<void> {
    const root: vscode.Uri | undefined = await resolveStoryboardWorkspaceRoot();
    if (!root) {
      return;
    }

    for (const glob of cardGlobs) {
      const uris: vscode.Uri[] = await vscode.workspace.findFiles(
        new vscode.RelativePattern(root, glob),
      );
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
  const controller: CardDiagnosticsController = new CardDiagnosticsController(dependencies.logger);
  const watchers: vscode.Disposable[] = [];

  void (async (): Promise<void> => {
    await controller.scanWorkspace();

    const root: vscode.Uri | undefined = await resolveStoryboardWorkspaceRoot();
    if (!root) {
      return;
    }

    for (const glob of cardGlobs) {
      const watcher: vscode.FileSystemWatcher = vscode.workspace.createFileSystemWatcher(
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
