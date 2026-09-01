import { hasStoryboardProjectAt } from '../../paths/projectDetection';
import type { StoryUri, StoryWorkspaceFolder } from '@storyboard/story-format';
import type { IProjectRepository, ISceneRepository } from '../../ports/repositories';
import { sceneContextPaths } from '../../paths/sceneContextPaths';
import {
  buildNarrativeContext,
  buildSceneContext,
  formatBibleFactLines,
  parseSceneFileName,
  SceneParseError,
} from '@storyboard/story-format';
import {
  draftPath,
  getStoryboardProjectPaths,
  isDirectSceneCardFile,
} from '../../paths/projectPaths';

import { computeSceneInputHash } from '../../domain/files/sceneCache';
import { sceneCacheFilePath } from '../../persistence/sceneCacheWorkspace';
import { resolveSceneBreakJoiner } from '@storyboard/story-pipeline';
import type { GenerateDraftResult, GenerateDraftWorkflowOptions } from './generateDraftTypes';
import { resolveSceneGrounding } from './resolveSceneGrounding';

export interface SceneGenerationInputs {
  readonly workspaceFolder: StoryWorkspaceFolder;
  readonly paths: ReturnType<typeof getStoryboardProjectPaths>;
  readonly scene: Awaited<ReturnType<ISceneRepository['read']>>;
  readonly project: Awaited<ReturnType<IProjectRepository['read']>>;
  readonly context: Awaited<ReturnType<typeof buildSceneContext>>;
  readonly previousContext: string | undefined;
  readonly canonFactLines: readonly string[];
  readonly sceneBreakJoiner: string | undefined;
  readonly inputHash: string;
  readonly draftUri: StoryUri;
  readonly cacheUri: StoryUri;
}

export type SceneGenerationInputsResult =
  | { readonly ok: false; readonly result: GenerateDraftResult }
  | { readonly ok: true; readonly inputs: SceneGenerationInputs };

type SceneGenerationTargetResult =
  | { readonly ok: false; readonly result: GenerateDraftResult }
  | {
      readonly ok: true;
      readonly workspaceFolder: StoryWorkspaceFolder;
      readonly paths: ReturnType<typeof getStoryboardProjectPaths>;
      readonly fileName: string;
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
  sceneUri: StoryUri,
  options: GenerateDraftWorkflowOptions,
): Promise<SceneGenerationTargetResult> {
  const workspaceFolder = options.workspaceLocator.folderFor(sceneUri);

  if (!workspaceFolder) {
    return inputsFailure('씬 파일이 속한 워크스페이스 폴더를 찾을 수 없습니다.');
  }

  if (
    !(await hasStoryboardProjectAt(workspaceFolder.uri, (uri) => options.fileSystem.exists(uri)))
  ) {
    return inputsFailure(
      'Storyboard 프로젝트(.storyboard/project.json)가 없습니다. 먼저 초기화해 주세요.',
    );
  }

  if (!isDirectSceneCardFile(sceneUri, workspaceFolder)) {
    return inputsFailure(
      'Storyboard 씬 파일만 처리할 수 있습니다. `scene/NN-slug.card` 형식의 파일을 선택하거나 해당 파일을 편집기에서 연 뒤 다시 시도해 주세요.',
    );
  }

  const fileName = sceneUri.path.split('/').pop() ?? '';

  if (!parseSceneFileName(fileName)) {
    return inputsFailure('씬 파일명은 `NN-slug.card` 형식이어야 합니다.');
  }

  return {
    ok: true,
    workspaceFolder,
    paths: getStoryboardProjectPaths(workspaceFolder.uri),
    fileName,
  };
}

type SceneAndProjectResult =
  | { readonly ok: false; readonly result: GenerateDraftResult }
  | {
      readonly ok: true;
      readonly scene: Awaited<ReturnType<ISceneRepository['read']>>;
      readonly project: Awaited<ReturnType<IProjectRepository['read']>>;
    };

async function loadSceneAndProject(
  sceneUri: StoryUri,
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
  sceneUri: StoryUri,
  options: GenerateDraftWorkflowOptions,
): Promise<SceneGenerationInputsResult> {
  const target = await resolveSceneGenerationTarget(sceneUri, options);
  if (!target.ok) {
    return target;
  }

  const { workspaceFolder, paths, fileName } = target;

  const loaded = await loadSceneAndProject(sceneUri, fileName, paths, options);
  if (!loaded.ok) {
    return loaded;
  }

  const { project } = loaded;

  const contextResult = await loadSceneContextBundle(
    paths,
    sceneUri,
    loaded.scene,
    project,
    options,
  );
  if (!contextResult.ok) {
    return contextResult;
  }

  const { scene, context, previousContext, sceneBreakJoiner, inputHash } = contextResult;

  return {
    ok: true,
    inputs: {
      workspaceFolder,
      paths,
      scene,
      project,
      context,
      previousContext,
      canonFactLines: contextResult.canonFactLines,
      sceneBreakJoiner,
      inputHash,
      draftUri: draftPath(workspaceFolder.uri, scene.stem),
      cacheUri: sceneCacheFilePath(paths, scene.stem),
    },
  };
}

type SceneContextBundleResult =
  | { readonly ok: false; readonly result: GenerateDraftResult }
  | {
      readonly ok: true;
      readonly scene: Awaited<ReturnType<ISceneRepository['read']>>;
      readonly context: Awaited<ReturnType<typeof buildSceneContext>>;
      readonly previousContext: string | undefined;
      readonly canonFactLines: readonly string[];
      readonly sceneBreakJoiner: string | undefined;
      readonly inputHash: string;
    };

async function loadSceneContextBundle(
  paths: ReturnType<typeof getStoryboardProjectPaths>,
  sceneUri: StoryUri,
  rawScene: Awaited<ReturnType<ISceneRepository['read']>>,
  project: Awaited<ReturnType<IProjectRepository['read']>>,
  options: GenerateDraftWorkflowOptions,
): Promise<SceneContextBundleResult> {
  const ctxPaths = sceneContextPaths(paths);
  let builtContext;
  try {
    builtContext = await buildSceneContext(ctxPaths, rawScene, options.fileSystem);
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

  // NOTE: 사실 시트는 컨텍스트를 만든 뒤 확정한다. 그래야 카드 id가 아닌 실제 인물 이름으로 제안받고,
  // 확정된 사실이 inputHash와 생성 프롬프트에 같이 반영된다. grounding은 characters/location을
  // 건드리지 않으므로 컨텍스트를 다시 만들지 않고 씬만 갈아 끼운다.
  const grounded = await resolveSceneGrounding(
    sceneUri,
    rawScene,
    builtContext.characters.map((character) => character.name),
    options,
  );
  if (grounded.kind === 'cancelled') {
    return { ok: false, result: { ok: false, kind: 'cancelled' } };
  }

  const scene = grounded.scene;
  const context = { ...builtContext, scene };

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
    grounding: scene.frontmatter.grounding,
  });

  return {
    ok: true,
    scene,
    context,
    previousContext: narrativeContext.prompt,
    canonFactLines: formatBibleFactLines(context, narrativeContext.bibleFacts),
    sceneBreakJoiner,
    inputHash,
  };
}
