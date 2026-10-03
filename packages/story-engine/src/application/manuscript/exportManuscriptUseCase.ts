import type { StoryUri } from '@storyboard/story-model';
import { failedResult } from '#engine/application/useCase';
import { renderManuscriptExport, type ManuscriptExportFormat } from '@storyboard/story-model';

export type ManuscriptExportSource = {
  readonly markdown: string;
  readonly projectName: string;
};

export interface IManuscriptExportRepository {
  hasManuscriptVolume(workspaceRoot: StoryUri): Promise<boolean>;
  loadVolume(workspaceRoot: StoryUri): Promise<ManuscriptExportSource>;
  saveExport(targetUri: StoryUri, content: string): Promise<void>;
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
  | { readonly kind: 'exported'; readonly ok: true; readonly targetUri: StoryUri };

export interface ExportManuscriptUseCaseDependencies {
  readonly repository: IManuscriptExportRepository;
}

export class ExportManuscriptUseCase {
  public constructor(private readonly deps: ExportManuscriptUseCaseDependencies) {}

  public async loadSource(workspaceRoot: StoryUri): Promise<LoadExportSourceResult> {
    try {
      if (!(await this.deps.repository.hasManuscriptVolume(workspaceRoot))) {
        return { kind: 'missing_volume', ok: false };
      }

      const { markdown, projectName } = await this.deps.repository.loadVolume(workspaceRoot);
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
      const content = renderManuscriptExport(markdown, format);
      await this.deps.repository.saveExport(targetUri, content);

      return { kind: 'exported', ok: true, targetUri };
    } catch (error) {
      return failedResult(error);
    }
  }
}
