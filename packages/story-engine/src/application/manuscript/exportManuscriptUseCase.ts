import type { WorkspaceRepositories } from '#engine/application/engineServices';
import type { StoryUri } from '@storyboard/story-model';
import { failedResult } from '#engine/application/useCase';
import { renderManuscriptExport, type ManuscriptExportFormat } from '@storyboard/story-model';

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
  | { readonly kind: 'exported'; readonly ok: true; readonly targetUri: StoryUri };

export class ExportManuscriptUseCase {
  public constructor(private readonly repositories: WorkspaceRepositories) {}

  public async loadSource(workspaceRoot: StoryUri): Promise<LoadExportSourceResult> {
    try {
      if (!(await this.repositories.manuscriptExport.hasManuscriptVolume(workspaceRoot))) {
        return { kind: 'missing_volume', ok: false };
      }

      const { markdown, projectName } =
        await this.repositories.manuscriptExport.loadVolume(workspaceRoot);
      return { kind: 'ready', ok: true, markdown, projectName };
    } catch (error) {
      return failedResult(error);
    }
  }

  public async writeExport(
    targetUri: StoryUri,
    markdown: string,
    format: ManuscriptExportFormat,
  ): Promise<ExportManuscriptResult> {
    try {
      const content: string = renderManuscriptExport(markdown, format);
      await this.repositories.manuscriptExport.saveExport(targetUri, content);

      return { kind: 'exported', ok: true, targetUri };
    } catch (error) {
      return failedResult(error);
    }
  }
}
