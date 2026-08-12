import type * as vscode from 'vscode';

import type { IProjectRepository, ISceneRepository } from '../ports/repositories';
import { parseSceneFileName, SceneParseError } from '@seedkernel/wasm';
import { buildNarrativeContext, buildSceneContext } from '@/domain/sceneContext';
import {
  draftPath,
  getStoryboardProjectPaths,
  isDirectSceneTextFile,
} from '../../infrastructure/vscode/pathConventions';
import { sceneContextPaths } from '../../infrastructure/vscode/workspaceFsAdapters';
import { hasStoryboardProject } from '../../infrastructure/vscode/workspace';
import { resolveWorkspaceFolder } from '../../infrastructure/vscode/workspaceFolder';
import { computeSceneInputHash } from '../../domain/files/sceneCache';
import { sceneCacheFilePath } from '../../infrastructure/persistence/sceneCacheWorkspace';
import { resolveSceneBreakJoiner } from '@storyboard/story-pipeline';
import type { GenerateDraftResult, GenerateDraftWorkflowOptions } from './generateDraftTypes';

export interface SceneGenerationInputs {
  readonly workspaceFolder: vscode.WorkspaceFolder;
  readonly paths: ReturnType<typeof getStoryboardProjectPaths>;
  readonly scene: Awaited<ReturnType<ISceneRepository['read']>>;
  readonly project: Awaited<ReturnType<IProjectRepository['read']>>;
  readonly context: Awaited<ReturnType<typeof buildSceneContext>>;
  readonly previousContext: string | undefined;
  readonly sceneBreakJoiner: string | undefined;
  readonly inputHash: string;
  readonly draftUri: vscode.Uri;
  readonly cacheUri: vscode.Uri;
}

export type SceneGenerationInputsResult =
  | { ok: false; result: GenerateDraftResult }
  | { ok: true; inputs: SceneGenerationInputs };

type SceneGenerationTargetResult =
  | { ok: false; result: GenerateDraftResult }
  | {
      ok: true;
      workspaceFolder: vscode.WorkspaceFolder;
      paths: ReturnType<typeof getStoryboardProjectPaths>;
      fileName: string;
    };

export function reportWorkflowFailure(
  options: GenerateDraftWorkflowOptions,
  logMessage: string,
  error: unknown,
  userMessage: string,
): GenerateDraftResult {
  options.logger.error(logMessage, error);

  if (!options.suppressLoggerPanel) {
    options.logger.show();
  }

  return { ok: false, kind: 'failed', message: userMessage };
}

function inputsFailure(message: string): { ok: false; result: GenerateDraftResult } {
  return { ok: false, result: { ok: false, kind: 'failed', message } };
}

async function resolveSceneGenerationTarget(
  sceneUri: vscode.Uri,
): Promise<SceneGenerationTargetResult> {
  const workspaceFolder = resolveWorkspaceFolder(sceneUri);

  if (!workspaceFolder) {
    return inputsFailure('씬 파일이 속한 워크스페이스 폴더를 찾을 수 없습니다.');
  }

  if (!(await hasStoryboardProject(workspaceFolder))) {
    return inputsFailure(
      'Storyboard 프로젝트(.storyboard/project.json)가 없습니다. 먼저 초기화해 주세요.',
    );
  }

  if (!isDirectSceneTextFile(sceneUri, workspaceFolder)) {
    return inputsFailure(
      'Storyboard 씬 파일만 처리할 수 있습니다. `scene/NN-slug.txt` 형식의 파일을 선택하거나 해당 파일을 편집기에서 연 뒤 다시 시도해 주세요.',
    );
  }

  const fileName = sceneUri.path.split('/').pop() ?? '';

  if (!parseSceneFileName(fileName)) {
    return inputsFailure('씬 파일명은 `NN-slug.txt` 형식이어야 합니다.');
  }

  return {
    ok: true,
    workspaceFolder,
    paths: getStoryboardProjectPaths(workspaceFolder.uri),
    fileName,
  };
}

type SceneAndProjectResult =
  | { ok: false; result: GenerateDraftResult }
  | {
      ok: true;
      scene: Awaited<ReturnType<ISceneRepository['read']>>;
      project: Awaited<ReturnType<IProjectRepository['read']>>;
    };

async function loadSceneAndProject(
  sceneUri: vscode.Uri,
  fileName: string,
  paths: ReturnType<typeof getStoryboardProjectPaths>,
  options: GenerateDraftWorkflowOptions,
): Promise<SceneAndProjectResult> {
  let scene;
  try {
    scene = await options.sceneRepository.read(sceneUri, fileName);
  } catch (error) {
    if (error instanceof SceneParseError) {
      return inputsFailure(`씬 파일을 읽을 수 없습니다: ${error.message}`);
    }

    return {
      ok: false,
      result: reportWorkflowFailure(
        options,
        'Failed to read scene file',
        error,
        '씬 파일을 읽는 중 오류가 발생했습니다. Output 패널을 확인해 주세요.',
      ),
    };
  }

  let project;
  try {
    project = await options.projectRepository.read(paths.projectJson);
  } catch (error) {
    return {
      ok: false,
      result: reportWorkflowFailure(
        options,
        'Failed to read project.json',
        error,
        'project.json을 읽을 수 없습니다. Output 패널을 확인해 주세요.',
      ),
    };
  }

  return { ok: true, scene, project };
}

export async function loadSceneGenerationInputs(
  sceneUri: vscode.Uri,
  options: GenerateDraftWorkflowOptions,
): Promise<SceneGenerationInputsResult> {
  const target = await resolveSceneGenerationTarget(sceneUri);
  if (!target.ok) {
    return target;
  }

  const { workspaceFolder, paths, fileName } = target;

  const loaded = await loadSceneAndProject(sceneUri, fileName, paths, options);
  if (!loaded.ok) {
    return loaded;
  }

  const { scene, project } = loaded;

  const contextResult = await loadSceneContextBundle(paths, scene, project, options);
  if (!contextResult.ok) {
    return contextResult;
  }

  const { context, previousContext, sceneBreakJoiner, inputHash } = contextResult;

  return {
    ok: true,
    inputs: {
      workspaceFolder,
      paths,
      scene,
      project,
      context,
      previousContext,
      sceneBreakJoiner,
      inputHash,
      draftUri: draftPath(workspaceFolder.uri, scene.stem),
      cacheUri: sceneCacheFilePath(paths, scene.stem),
    },
  };
}

type SceneContextBundleResult =
  | { ok: false; result: GenerateDraftResult }
  | {
      ok: true;
      context: Awaited<ReturnType<typeof buildSceneContext>>;
      previousContext: string | undefined;
      sceneBreakJoiner: string | undefined;
      inputHash: string;
    };

async function loadSceneContextBundle(
  paths: ReturnType<typeof getStoryboardProjectPaths>,
  scene: Awaited<ReturnType<ISceneRepository['read']>>,
  project: Awaited<ReturnType<IProjectRepository['read']>>,
  options: GenerateDraftWorkflowOptions,
): Promise<SceneContextBundleResult> {
  const ctxPaths = sceneContextPaths(paths);
  let context;
  try {
    context = await buildSceneContext(ctxPaths, scene, options.fileSystem);
  } catch (error) {
    return {
      ok: false,
      result: reportWorkflowFailure(
        options,
        'Failed to build scene context',
        error,
        '씬 컨텍스트를 구성하지 못했습니다. Output 패널을 확인해 주세요.',
      ),
    };
  }

  const narrativeContext = await buildNarrativeContext(ctxPaths, context, options.fileSystem);
  const sceneBreakJoiner = resolveSceneBreakJoiner(
    options.configBridge.getDraftSceneBreakSeparator(),
  );
  const inputHash = computeSceneInputHash({
    sceneBody: context.scene.body,
    characters: context.characters,
    background: context.background,
    format: project.format,
    bibleFacts: narrativeContext.bibleFacts,
    sceneBreakJoiner,
  });

  return {
    ok: true,
    context,
    previousContext: narrativeContext.prompt,
    sceneBreakJoiner,
    inputHash,
  };
}
