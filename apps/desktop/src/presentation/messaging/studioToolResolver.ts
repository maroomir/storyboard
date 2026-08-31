import type * as vscode from 'vscode';

import { formatAugmentCards } from '@storyboard/story-ai';
import type {
  ContinuityIssue,
  GrammarIssue,
  StudioAgentInvokeRequest,
  StudioAgentToolSpan,
} from '@storyboard/story-ai';
import {
  buildNarrativeContext,
  buildSceneContext,
  extractDraftBody,
  formatBibleFactLines,
  readSceneFile,
} from '@storyboard/story-format';
import type { ProjectFormat, SceneContext } from '@storyboard/story-format';

import type { AiGateway } from '../../application/ai/aiGateway';
import type { StoryboardLogger } from '../../infrastructure/vscode/logger';
import { readProjectJson } from '../../infrastructure/persistence/projectJson';
import { getStoryboardProjectPaths, scenePath } from '../../infrastructure/vscode/pathConventions';
import {
  sceneContextFileSystem,
  sceneContextPaths,
  vscodeFsAdapter,
} from '../../infrastructure/vscode/workspaceFsAdapters';
import type { StudioToolDiagnostics } from '../providers/studioToolDiagnostics';

export interface StudioInvokeResolverDependencies {
  readonly aiGateway: AiGateway;
  readonly logger: StoryboardLogger;
  readonly diagnostics: StudioToolDiagnostics;
}

export interface StudioInvokeResolverInput {
  readonly workspaceRoot: vscode.Uri;
  readonly sceneStem: string;
  readonly draftUri: vscode.Uri;
  readonly baseline: string;
}

const maxReportedIssues = 10;
const condenseTargetRatio = 0.7;

export function createStudioInvokeResolver(
  deps: StudioInvokeResolverDependencies,
  input: StudioInvokeResolverInput,
): (request: StudioAgentInvokeRequest) => Promise<string> {
  return async (request) => {
    try {
      switch (request.tool) {
        case 'continuityCheck':
          return await runContinuityCheck(deps, input);
        case 'grammarCheck':
          return await runGrammarCheck(deps, input);
        default:
          return await runTransform(deps, input, request);
      }
    } catch (error) {
      deps.logger.warn(`Studio 도구 실행 실패(${request.tool}): ${String(error)}`);
      return `[도구 실패: ${request.tool}] 실행 중 오류가 나서 결과를 얻지 못했다. 도구 없이 판단하라.`;
    }
  };
}

async function runContinuityCheck(
  deps: StudioInvokeResolverDependencies,
  input: StudioInvokeResolverInput,
): Promise<string> {
  const scene = await loadSceneContext(input);

  if (!scene) {
    return '[도구 결과: continuityCheck] 씬 자료를 읽지 못해 검사를 건너뛰었다.';
  }

  const factLines = formatBibleFactLines(scene.sceneContext, scene.bibleFacts);

  if (factLines.length === 0) {
    return '[도구 결과: continuityCheck] 대조할 설정 자료(canon)가 없어 검사할 수 없었다.';
  }

  const issues = await deps.aiGateway
    .createService(input.workspaceRoot)
    .checkContinuity(input.baseline, factLines, {
      providerId: deps.aiGateway.getTaskProvider('continuityCheck'),
      attribution: { primary: { kind: 'scene', id: input.sceneStem } },
    });

  await deps.diagnostics.publishContinuity(input.draftUri, issues);

  if (issues.length === 0) {
    return '[도구 결과: continuityCheck] 설정과 어긋나는 구간이 없다.';
  }

  return [
    `[도구 결과: continuityCheck] 불일치 ${issues.length}건 (에디터에도 표시됨)`,
    ...issues.slice(0, maxReportedIssues).map(describeContinuityIssue),
    ...overflowLine(issues.length),
  ].join('\n');
}

async function runGrammarCheck(
  deps: StudioInvokeResolverDependencies,
  input: StudioInvokeResolverInput,
): Promise<string> {
  const issues = await deps.aiGateway
    .createService(input.workspaceRoot)
    .checkGrammar(input.baseline, {
      providerId: deps.aiGateway.getTaskProvider('grammarCheck'),
      attribution: { primary: { kind: 'scene', id: input.sceneStem } },
    });

  await deps.diagnostics.publishGrammar(input.draftUri, issues);

  if (issues.length === 0) {
    return '[도구 결과: grammarCheck] 문법·맞춤법 문제가 없다.';
  }

  return [
    `[도구 결과: grammarCheck] 문제 ${issues.length}건 (에디터에도 표시됨)`,
    ...issues.slice(0, maxReportedIssues).map(describeGrammarIssue),
    ...overflowLine(issues.length),
  ].join('\n');
}

async function runTransform(
  deps: StudioInvokeResolverDependencies,
  input: StudioInvokeResolverInput,
  request: StudioAgentInvokeRequest,
): Promise<string> {
  const span = request.span;

  if (!span) {
    return `[도구 실패: ${request.tool}] span 없이 부를 수 없는 도구다.`;
  }

  const body = extractDraftBody(input.baseline);

  if (body.slice(span.startOffset, span.endOffset) !== span.oldText) {
    return `[도구 실패: ${request.tool}] span이 본문과 일치하지 않아 실행하지 못했다. 오프셋과 oldText를 본문 그대로 다시 맞춰라.`;
  }

  const text = await transformSpan(deps, input, request, span);

  if (text.trim().length === 0) {
    return `[도구 실패: ${request.tool}] 빈 결과가 돌아왔다. 도구 없이 직접 고쳐 propose하라.`;
  }

  return [
    `[도구 결과: ${request.tool}] 아래는 초벌이다. 문맥에 맞게 다듬어 propose의 newText로 써라.`,
    text.trim(),
  ].join('\n');
}

async function transformSpan(
  deps: StudioInvokeResolverDependencies,
  input: StudioInvokeResolverInput,
  request: StudioAgentInvokeRequest,
  span: StudioAgentToolSpan,
): Promise<string> {
  const service = deps.aiGateway.createService(input.workspaceRoot);
  const attribution = { primary: { kind: 'scene', id: input.sceneStem } } as const;

  if (request.tool === 'expand') {
    return service.expandDraft(
      span.oldText,
      {},
      {
        providerId: deps.aiGateway.getTaskProvider('draftExpansion'),
        attribution,
      },
    );
  }

  const scene = await loadSceneContext(input);

  if (request.tool === 'condense') {
    return service.condenseDraft(
      {
        body: span.oldText,
        format: scene?.format ?? 'novel',
        targetLength: Math.round(span.oldText.length * condenseTargetRatio),
        ...(scene === undefined ? {} : { intent: scene.sceneContext.scene.body }),
      },
      { providerId: deps.aiGateway.getTaskProvider('draftRevision'), attribution },
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
    { providerId: deps.aiGateway.getTaskProvider('draftAugment'), attribution },
  );
}

interface LoadedSceneContext {
  readonly sceneContext: SceneContext;
  readonly bibleFacts: Awaited<ReturnType<typeof buildNarrativeContext>>['bibleFacts'];
  readonly format: ProjectFormat;
}

async function loadSceneContext(
  input: StudioInvokeResolverInput,
): Promise<LoadedSceneContext | undefined> {
  const paths = getStoryboardProjectPaths(input.workspaceRoot);
  const sceneFileName = `${input.sceneStem}.card`;

  try {
    const scene = await readSceneFile(
      scenePath(input.workspaceRoot, input.sceneStem),
      vscodeFsAdapter,
      sceneFileName,
    );
    const contextPaths = sceneContextPaths(paths);
    const sceneContext = await buildSceneContext(contextPaths, scene, sceneContextFileSystem);
    const narrative = await buildNarrativeContext(
      contextPaths,
      sceneContext,
      sceneContextFileSystem,
    );
    const project = await readProjectJson(paths.projectJson);

    return { sceneContext, bibleFacts: narrative.bibleFacts, format: project.format };
  } catch {
    return undefined;
  }
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
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
}
