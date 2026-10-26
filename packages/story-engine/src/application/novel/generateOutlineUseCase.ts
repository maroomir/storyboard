import type {
  AiServices,
  HostAdapters,
  WorkspaceRepositories,
} from '#engine/application/engineServices';
import type {
  StoryUri,
  ChapterPlan,
  ContractFieldKey,
  OutlineCharacterBrief,
  OutlineSynopsis,
  StoryboardProject,
  GenerationContractReadiness,
  OutlineBrief,
} from '@storyboard/story-model';
import { runUseCase, type IUseCase } from '#engine/application/useCase';
import { validateGenerationContract, toOutlineBrief } from '@storyboard/story-model';
import { refuseChapterCountMismatch } from './chapterPlanContract';
import type { StoryboardAiService } from '@storyboard/story-ai';

export type GenerateOutlineOptions = {
  readonly onProgress?: (message: string) => void;
  readonly overwrite: boolean;
};

export type GenerateOutlineResult =
  | { readonly kind: 'existing'; readonly ok: false }
  | { readonly kind: 'failed'; readonly message: string; readonly ok: false }
  | {
      readonly kind: 'missing_contract';
      readonly missing: readonly ContractFieldKey[];
      readonly ok: false;
    }
  | { readonly kind: 'generated'; readonly ok: true; readonly synopsisUri: StoryUri };

export type GenerateOutlineRequest = GenerateOutlineOptions & {
  readonly workspaceRoot: StoryUri;
};

export class GenerateOutlineUseCase implements IUseCase<
  GenerateOutlineRequest,
  GenerateOutlineResult
> {
  public constructor(
    private readonly host: HostAdapters,
    private readonly ai: AiServices,
    private readonly repositories: WorkspaceRepositories,
  ) {}

  public async execute(request: GenerateOutlineRequest): Promise<GenerateOutlineResult> {
    const { workspaceRoot, ...options } = request;

    return await runUseCase<GenerateOutlineResult>(
      this.host.logger,
      'Generate outline failed',
      async () => {
        const project: StoryboardProject =
          await this.repositories.outline.loadProject(workspaceRoot);
        const readiness: GenerationContractReadiness = validateGenerationContract(project.setting);

        if (readiness.missing.length > 0) {
          return { kind: 'missing_contract', missing: readiness.missing, ok: false };
        }

        if (!options.overwrite && (await this.repositories.outline.hasExisting(workspaceRoot))) {
          return { kind: 'existing', ok: false };
        }

        const aiService: StoryboardAiService = this.ai.gateway.createService(workspaceRoot);
        const brief: OutlineBrief = toOutlineBrief(
          project,
          await this.repositories.outline.loadNarratorIds(workspaceRoot),
        );
        options.onProgress?.('시놉시스 생성 중…');
        const synopsis: OutlineSynopsis = await aiService.generateOutlineSynopsis(brief);
        const characters: readonly OutlineCharacterBrief[] =
          await this.repositories.outline.loadCharacterBriefs(workspaceRoot);
        options.onProgress?.('챕터 구성 중…');
        const chapterPlan: ChapterPlan = await aiService.generateChapterPlan(
          brief,
          synopsis,
          characters,
        );
        refuseChapterCountMismatch(brief, chapterPlan, 'generated');
        options.onProgress?.('파일 저장 중…');
        const synopsisUri: StoryUri = await this.repositories.outline.save(
          workspaceRoot,
          synopsis,
          chapterPlan,
        );

        return { kind: 'generated', ok: true, synopsisUri };
      },
    );
  }
}
