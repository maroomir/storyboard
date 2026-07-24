import type * as vscode from 'vscode';

import type { AiGateway } from '../ai/aiGateway';
import { validateGenerationContract } from '../../domain/generationContract';
import { toOutlineBrief } from '@storyboard/story-format';
import type {
  ChapterPlan,
  ContractFieldKey,
  OutlineCharacterBrief,
  OutlineSynopsis,
  StoryboardProject,
} from '@storyboard/story-format';
export interface IOutlineRepository {
  hasExisting(workspaceRoot: vscode.Uri): Promise<boolean>;
  loadCharacterBriefs(workspaceRoot: vscode.Uri): Promise<readonly OutlineCharacterBrief[]>;
  loadProject(workspaceRoot: vscode.Uri): Promise<StoryboardProject>;
  save(
    workspaceRoot: vscode.Uri,
    synopsis: OutlineSynopsis,
    chapterPlan: ChapterPlan,
  ): Promise<vscode.Uri>;
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
  | { readonly kind: 'generated'; readonly ok: true; readonly synopsisUri: vscode.Uri };

export class GenerateOutlineUseCase {
  public constructor(
    private readonly aiGateway: AiGateway,
    private readonly repository: IOutlineRepository,
  ) {}

  public async execute(
    workspaceRoot: vscode.Uri,
    options: GenerateOutlineOptions,
  ): Promise<GenerateOutlineResult> {
    try {
      const project = await this.repository.loadProject(workspaceRoot);
      const readiness = validateGenerationContract(project.setting);

      if (readiness.missing.length > 0) {
        return { kind: 'missing_contract', missing: readiness.missing, ok: false };
      }

      if (!options.overwrite && (await this.repository.hasExisting(workspaceRoot))) {
        return { kind: 'existing', ok: false };
      }

      const aiService = this.aiGateway.createService(workspaceRoot);
      const brief = toOutlineBrief(project);
      options.onProgress?.('시놉시스 생성 중…');
      const synopsis = await aiService.generateOutlineSynopsis(brief);
      const characters = await this.repository.loadCharacterBriefs(workspaceRoot);
      options.onProgress?.('챕터 구성 중…');
      const chapterPlan = await aiService.generateChapterPlan(brief, synopsis, characters);
      options.onProgress?.('파일 저장 중…');
      const synopsisUri = await this.repository.save(workspaceRoot, synopsis, chapterPlan);

      return { kind: 'generated', ok: true, synopsisUri };
    } catch (error) {
      return {
        kind: 'failed',
        message: error instanceof Error ? error.message : String(error),
        ok: false,
      };
    }
  }
}
