import type { StoryUri } from '@storyboard/story-format';
import type { IStoryboardLogger } from '#engine/ports/logger';
import { runUseCase, type IUseCase } from '#engine/application/useCase';
import type { AiGateway } from '#engine/application/ai/aiGateway';
import { validateGenerationContract } from '#engine/domain/generationContract';
import { toOutlineBrief } from '@storyboard/story-format';
import type {
  ChapterPlan,
  ContractFieldKey,
  OutlineCharacterBrief,
  OutlineSynopsis,
  StoryboardProject,
} from '@storyboard/story-format';
export interface IOutlineRepository {
  hasExisting(workspaceRoot: StoryUri): Promise<boolean>;
  loadCharacterBriefs(workspaceRoot: StoryUri): Promise<readonly OutlineCharacterBrief[]>;
  loadNarratorIds(workspaceRoot: StoryUri): Promise<readonly string[]>;
  loadProject(workspaceRoot: StoryUri): Promise<StoryboardProject>;
  save(
    workspaceRoot: StoryUri,
    synopsis: OutlineSynopsis,
    chapterPlan: ChapterPlan,
  ): Promise<StoryUri>;
}

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

export interface GenerateOutlineUseCaseDependencies {
  readonly aiGateway: AiGateway;
  readonly repository: IOutlineRepository;
  readonly logger: IStoryboardLogger;
}

export type GenerateOutlineRequest = GenerateOutlineOptions & {
  readonly workspaceRoot: StoryUri;
};

export class GenerateOutlineUseCase implements IUseCase<
  GenerateOutlineRequest,
  GenerateOutlineResult
> {
  public constructor(private readonly deps: GenerateOutlineUseCaseDependencies) {}

  public async execute(request: GenerateOutlineRequest): Promise<GenerateOutlineResult> {
    const { workspaceRoot, ...options } = request;

    return await runUseCase<GenerateOutlineResult>(
      this.deps.logger,
      'Generate outline failed',
      async () => {
        const project = await this.deps.repository.loadProject(workspaceRoot);
        const readiness = validateGenerationContract(project.setting);

        if (readiness.missing.length > 0) {
          return { kind: 'missing_contract', missing: readiness.missing, ok: false };
        }

        if (!options.overwrite && (await this.deps.repository.hasExisting(workspaceRoot))) {
          return { kind: 'existing', ok: false };
        }

        const aiService = this.deps.aiGateway.createService(workspaceRoot);
        const brief = toOutlineBrief(
          project,
          await this.deps.repository.loadNarratorIds(workspaceRoot),
        );
        options.onProgress?.('시놉시스 생성 중…');
        const synopsis = await aiService.generateOutlineSynopsis(brief);
        const characters = await this.deps.repository.loadCharacterBriefs(workspaceRoot);
        options.onProgress?.('챕터 구성 중…');
        const chapterPlan = await aiService.generateChapterPlan(brief, synopsis, characters);
        options.onProgress?.('파일 저장 중…');
        const synopsisUri = await this.deps.repository.save(workspaceRoot, synopsis, chapterPlan);

        return { kind: 'generated', ok: true, synopsisUri };
      },
    );
  }
}
