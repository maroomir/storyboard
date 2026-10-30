import type { DraftManager, ProjectManager } from '@storyboard/story-app';
import type * as vscode from 'vscode';

import { formatAugmentCards } from '@storyboard/story-ai';
import type { ContinuityIssue, GrammarIssue, StoryboardAiService } from '@storyboard/story-ai';
import type {
  StudioAgentInvokeRequest,
  StudioAgentToolSpan,
  ProjectFormat,
  SceneContext,
  SceneFile,
  NarrativeContext,
  StoryboardProject,
  UsageAttribution,
} from '@storyboard/story-model';
import {
  extractDraftBody,
  formatBibleFactLines,
  readSceneFile,
  scenePath,
} from '@storyboard/story-model';

import type { AiGateway } from '@storyboard/story-engine';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import { vscodeFsAdapter } from '@/infrastructure/vscode/workspaceFsAdapters';
import type { StudioToolDiagnostics } from '@/presentation/providers/studioToolDiagnostics';

export interface StudioInvokeResolverDependencies {
  readonly aiGateway: AiGateway;
  readonly logger: IStoryboardLogger;
  readonly diagnostics: StudioToolDiagnostics;
  readonly documents: StudioDocumentManagers;
}

export interface StudioDocumentManagers {
  readonly drafts: Pick<
    DraftManager,
    'readSceneContext' | 'readSceneNarrative' | 'archiveDraftWhenHistoryIsKept'
  >;
  readonly project: Pick<ProjectManager, 'read'>;
}

export interface StudioInvokeResolverInput {
  readonly workspaceRoot: vscode.Uri;
  readonly sceneStem: string;
  readonly draftUri: vscode.Uri;
  readonly baseline: string;
}

const maxReportedIssues: number = 10;
const condenseTargetRatio: number = 0.7;

interface LoadedSceneContext {
  readonly sceneContext: SceneContext;
  readonly bibleFacts: NarrativeContext['bibleFacts'];
  readonly format: ProjectFormat;
}

function describeContinuityIssue(issue: ContinuityIssue): string {
  return `- (${issue.severity}) ${issue.reason} — 해당 구간: "${excerpt(issue.original)}"`;
}

function describeGrammarIssue(issue: GrammarIssue): string {
  return `- ${issue.reason} → 제안: ${issue.suggestion} — "${excerpt(issue.original)}"`;
}

function overflowLine(total: number): string[] {
  return total > maxReportedIssues
    ? [`- 외 ${total - maxReportedIssues}건은 에디터에서 확인.`]
    : [];
}

function excerpt(text: string): string {
  const trimmed: string = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
}

export class StudioInvokeResolver {
  public constructor(
    private readonly deps: StudioInvokeResolverDependencies,
    private readonly input: StudioInvokeResolverInput,
  ) {}

  public readonly resolve = async (request: StudioAgentInvokeRequest): Promise<string> => {
    try {
      switch (request.tool) {
        case 'continuityCheck':
          return await this.runContinuityCheck();
        case 'grammarCheck':
          return await this.runGrammarCheck();
        default:
          return await this.runTransform(request);
      }
    } catch (error) {
      this.deps.logger.warn(`Studio 도구 실행 실패(${request.tool}): ${String(error)}`);
      return `[도구 실패: ${request.tool}] 실행 중 오류가 나서 결과를 얻지 못했다. 도구 없이 판단하라.`;
    }
  };

  private async loadSceneContext(): Promise<LoadedSceneContext | undefined> {
    const { drafts, project } = this.deps.documents;
    const { workspaceRoot, sceneStem } = this.input;

    try {
      const scene: SceneFile = await readSceneFile(
        scenePath(workspaceRoot, sceneStem),
        vscodeFsAdapter,
        `${sceneStem}.card`,
      );
      const sceneContext: SceneContext = await drafts.readSceneContext(workspaceRoot, scene);
      const narrative: NarrativeContext = await drafts.readSceneNarrative(
        workspaceRoot,
        sceneContext,
      );
      const { format }: StoryboardProject = await project.read(workspaceRoot);

      return { sceneContext, bibleFacts: narrative.bibleFacts, format };
    } catch {
      return undefined;
    }
  }

  private async runContinuityCheck(): Promise<string> {
    const scene: LoadedSceneContext | undefined = await this.loadSceneContext();

    if (!scene) {
      return '[도구 결과: continuityCheck] 씬 자료를 읽지 못해 검사를 건너뛰었다.';
    }

    const factLines: string[] = formatBibleFactLines(scene.sceneContext, scene.bibleFacts);

    if (factLines.length === 0) {
      return '[도구 결과: continuityCheck] 대조할 설정 자료(canon)가 없어 검사할 수 없었다.';
    }

    const issues: ContinuityIssue[] = await this.deps.aiGateway
      .createService(this.input.workspaceRoot)
      .checkContinuity(this.input.baseline, factLines, {
        providerId: this.deps.aiGateway.getTaskProvider('continuityCheck'),
        attribution: { primary: { kind: 'scene', id: this.input.sceneStem } },
      });

    await this.deps.diagnostics.publishContinuity(this.input.draftUri, issues);

    if (issues.length === 0) {
      return '[도구 결과: continuityCheck] 설정과 어긋나는 구간이 없다.';
    }

    return [
      `[도구 결과: continuityCheck] 불일치 ${issues.length}건 (에디터에도 표시됨)`,
      ...issues.slice(0, maxReportedIssues).map(describeContinuityIssue),
      ...overflowLine(issues.length),
    ].join('\n');
  }

  private async runGrammarCheck(): Promise<string> {
    const issues: GrammarIssue[] = await this.deps.aiGateway
      .createService(this.input.workspaceRoot)
      .checkGrammar(this.input.baseline, {
        providerId: this.deps.aiGateway.getTaskProvider('grammarCheck'),
        attribution: { primary: { kind: 'scene', id: this.input.sceneStem } },
      });

    await this.deps.diagnostics.publishGrammar(this.input.draftUri, issues);

    if (issues.length === 0) {
      return '[도구 결과: grammarCheck] 문법·맞춤법 문제가 없다.';
    }

    return [
      `[도구 결과: grammarCheck] 문제 ${issues.length}건 (에디터에도 표시됨)`,
      ...issues.slice(0, maxReportedIssues).map(describeGrammarIssue),
      ...overflowLine(issues.length),
    ].join('\n');
  }

  private async runTransform(request: StudioAgentInvokeRequest): Promise<string> {
    const span: StudioAgentToolSpan | undefined = request.span;

    if (!span) {
      return `[도구 실패: ${request.tool}] span 없이 부를 수 없는 도구다.`;
    }

    const body: string = extractDraftBody(this.input.baseline);

    if (body.slice(span.startOffset, span.endOffset) !== span.oldText) {
      return `[도구 실패: ${request.tool}] span이 본문과 일치하지 않아 실행하지 못했다. 오프셋과 oldText를 본문 그대로 다시 맞춰라.`;
    }

    const text: string = await this.transformSpan(request, span);

    if (text.trim().length === 0) {
      return `[도구 실패: ${request.tool}] 빈 결과가 돌아왔다. 도구 없이 직접 고쳐 propose하라.`;
    }

    return [
      `[도구 결과: ${request.tool}] 아래는 초벌이다. 문맥에 맞게 다듬어 propose의 newText로 써라.`,
      text.trim(),
    ].join('\n');
  }

  private async transformSpan(
    request: StudioAgentInvokeRequest,
    span: StudioAgentToolSpan,
  ): Promise<string> {
    const service: StoryboardAiService = this.deps.aiGateway.createService(
      this.input.workspaceRoot,
    );
    const attribution: UsageAttribution = { primary: { kind: 'scene', id: this.input.sceneStem } };

    if (request.tool === 'expand') {
      return service.expandDraft(
        span.oldText,
        {},
        {
          providerId: this.deps.aiGateway.getTaskProvider('draftExpansion'),
          attribution,
        },
      );
    }

    const scene: LoadedSceneContext | undefined = await this.loadSceneContext();

    if (request.tool === 'condense') {
      return service.condenseDraft(
        {
          body: span.oldText,
          format: scene?.format ?? 'novel',
          targetLength: Math.round(span.oldText.length * condenseTargetRatio),
          ...(scene === undefined ? {} : { intent: scene.sceneContext.scene.body }),
        },
        { providerId: this.deps.aiGateway.getTaskProvider('draftRevision'), attribution },
      );
    }

    if (!scene) {
      throw new Error('씬 자료를 읽지 못해 보충할 수 없습니다.');
    }

    return service.augmentDraft(
      {
        target: span.oldText,
        scope: 'selection',
        format: scene.format,
        cards: formatAugmentCards(scene.sceneContext.characters, scene.sceneContext.background),
        facts: formatBibleFactLines(scene.sceneContext, scene.bibleFacts),
        intent: scene.sceneContext.scene.body,
        ...(request.instruction === undefined ? {} : { instruction: request.instruction }),
      },
      { providerId: this.deps.aiGateway.getTaskProvider('draftAugment'), attribution },
    );
  }
}
