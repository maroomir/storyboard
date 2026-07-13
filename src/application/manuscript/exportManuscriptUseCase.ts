import type * as vscode from 'vscode';

import { renderManuscriptExport, type ManuscriptExportFormat } from '../../domain/manuscriptExport';

export type ManuscriptExportSource = {
  readonly markdown: string;
  readonly projectName: string;
};

export interface IManuscriptExportRepository {
  hasManuscriptVolume(workspaceRoot: vscode.Uri): Promise<boolean>;
  loadVolume(workspaceRoot: vscode.Uri): Promise<ManuscriptExportSource>;
  saveExport(targetUri: vscode.Uri, content: string): Promise<void>;
}

export type LoadExportSourceResult =
  | { readonly kind: 'missing_volume'; readonly ok: false }
  | { readonly kind: 'failed'; readonly message: string; readonly ok: false }
  | {
      readonly kind: 'ready';
      readonly ok: true;
      readonly markdown: string;
      readonly projectName: string;
    };

export type ExportManuscriptResult =
  | { readonly kind: 'failed'; readonly message: string; readonly ok: false }
  | { readonly kind: 'exported'; readonly ok: true; readonly targetUri: vscode.Uri };

export class ExportManuscriptUseCase {
  public constructor(private readonly repository: IManuscriptExportRepository) {}

  public async loadSource(workspaceRoot: vscode.Uri): Promise<LoadExportSourceResult> {
    try {
      if (!(await this.repository.hasManuscriptVolume(workspaceRoot))) {
        return { kind: 'missing_volume', ok: false };
      }

      const { markdown, projectName } = await this.repository.loadVolume(workspaceRoot);
      return { kind: 'ready', ok: true, markdown, projectName };
    } catch (error) {
      return {
        kind: 'failed',
        message: error instanceof Error ? error.message : String(error),
        ok: false,
      };
    }
  }

  public async writeExport(
    targetUri: vscode.Uri,
    markdown: string,
    format: ManuscriptExportFormat,
  ): Promise<ExportManuscriptResult> {
    try {
      const content = renderManuscriptExport(markdown, format);
      await this.repository.saveExport(targetUri, content);

      return { kind: 'exported', ok: true, targetUri };
    } catch (error) {
      return {
        kind: 'failed',
        message: error instanceof Error ? error.message : String(error),
        ok: false,
      };
    }
  }
}
