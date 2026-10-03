import type {
  AssembleManuscriptRequest,
  AssembleManuscriptResult,
  AssembleManuscriptUseCase,
  ExportManuscriptResult,
  ExportManuscriptUseCase,
  LoadExportSourceResult,
  ReviewManuscriptRequest,
  ReviewManuscriptResult,
  ReviewManuscriptUseCase,
  SummarizeChaptersRequest,
  SummarizeChaptersResult,
  SummarizeChaptersUseCase,
} from '@storyboard/story-engine';
import type { ManuscriptExportFormat, StoryUri } from '@storyboard/story-model';

export interface ManuscriptManagerDependencies {
  readonly assembleManuscriptUseCase: AssembleManuscriptUseCase;
  readonly reviewManuscriptUseCase: ReviewManuscriptUseCase;
  readonly summarizeChaptersUseCase: SummarizeChaptersUseCase;
  readonly exportManuscriptUseCase: ExportManuscriptUseCase;
}

// The whole-manuscript verbs: stitch the drafts into a volume, review it, summarize it, export it.
export class ManuscriptManager {
  public constructor(private readonly deps: ManuscriptManagerDependencies) {}

  public assemble(request: AssembleManuscriptRequest): Promise<AssembleManuscriptResult> {
    return this.deps.assembleManuscriptUseCase.execute(request);
  }

  public review(request: ReviewManuscriptRequest): Promise<ReviewManuscriptResult> {
    return this.deps.reviewManuscriptUseCase.execute(request);
  }

  public summarizeChapters(request: SummarizeChaptersRequest): Promise<SummarizeChaptersResult> {
    return this.deps.summarizeChaptersUseCase.execute(request);
  }

  public loadExportSource(workspaceRoot: StoryUri): Promise<LoadExportSourceResult> {
    return this.deps.exportManuscriptUseCase.loadSource(workspaceRoot);
  }

  public writeExport(
    targetUri: StoryUri,
    markdown: string,
    format: ManuscriptExportFormat,
  ): Promise<ExportManuscriptResult> {
    return this.deps.exportManuscriptUseCase.writeExport(targetUri, markdown, format);
  }
}
