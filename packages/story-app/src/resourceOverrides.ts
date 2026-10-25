import {
  listDirectoryFileNames,
  overrideNovelPipelinePlan,
  overrideScenePipelinePlan,
  resetNovelPipelinePlan,
  resetScenePipelinePlan,
  type IFileSystem,
} from '@storyboard/story-engine';
import {
  PromptResourceError,
  overridePromptVariantRules,
  promptResourceKeys,
  promptResources,
  promptVariantRulesOverrideSchema,
  resetPromptVariantRules,
} from '@storyboard/story-ai';
import {
  compositionPresetOverrideSchema,
  craftContractOverrideFileSchema,
  joinStoryPath,
  overrideCompositionPresetDefaults,
  parsePipelineSpec,
  PipelineSpecError,
  overrideCraftContractDefaults,
  resetCompositionPresetDefaults,
  resetCraftContractDefaults,
  type PipelineSpec,
  type StoryUri,
} from '@storyboard/story-model';

interface ResourceLayout {
  readonly promptDirectory: string;
  readonly craftContractFile: string;
  readonly promptVariantsFile: string;
  readonly compositionPresetsFile: string;
  readonly scenePipelineFile: string;
  readonly novelPipelineFile: string;
}

export const resourceLayout: ResourceLayout = {
  promptDirectory: 'prompts',
  craftContractFile: 'craftContract.json',
  promptVariantsFile: 'promptVariants.json',
  compositionPresetsFile: 'compositionPresets.json',
  scenePipelineFile: 'pipelines/scene.yaml',
  novelPipelineFile: 'pipelines/novel.yaml',
};

export type ResourceOverrideKind =
  | 'prompt'
  | 'craftContract'
  | 'promptVariants'
  | 'compositionPresets'
  | 'scenePipeline'
  | 'novelPipeline';

export interface ResourceOverrideApplied {
  readonly kind: ResourceOverrideKind;
  readonly key?: string;
  readonly file: StoryUri;
  readonly root: StoryUri;
}

export interface ResourceOverrideProblem {
  readonly file: StoryUri;
  readonly message: string;
}

export interface ResourceOverrideReport {
  readonly applied: readonly ResourceOverrideApplied[];
  readonly problems: readonly ResourceOverrideProblem[];
}

export async function loadResourceOverrides(
  fileSystem: IFileSystem,
  roots: readonly StoryUri[],
): Promise<ResourceOverrideReport> {
  const applied: ResourceOverrideApplied[] = [];
  const problems: ResourceOverrideProblem[] = [];
  const report: MutableReport = { applied, problems };

  promptResources.clearOverrides();
  resetCraftContractDefaults();
  resetPromptVariantRules();
  resetCompositionPresetDefaults();
  resetScenePipelinePlan();
  resetNovelPipelinePlan();

  for (const root of roots) {
    await loadPromptFiles(
      fileSystem,
      root,
      joinStoryPath(root, resourceLayout.promptDirectory),
      report,
    );
    await loadJsonFile(
      fileSystem,
      root,
      joinStoryPath(root, resourceLayout.craftContractFile),
      report,
      {
        kind: 'craftContract',
        label: '작법 계약 파일',
        schema: craftContractOverrideFileSchema,
        apply: overrideCraftContractDefaults,
      },
    );
    await loadJsonFile(
      fileSystem,
      root,
      joinStoryPath(root, resourceLayout.promptVariantsFile),
      report,
      {
        kind: 'promptVariants',
        label: '프롬프트 변형 규칙 파일',
        schema: promptVariantRulesOverrideSchema,
        apply: overridePromptVariantRules,
      },
    );
    await loadJsonFile(
      fileSystem,
      root,
      joinStoryPath(root, resourceLayout.compositionPresetsFile),
      report,
      {
        kind: 'compositionPresets',
        label: '구성 프리셋 파일',
        schema: compositionPresetOverrideSchema,
        apply: overrideCompositionPresetDefaults,
      },
    );
    await loadPipelineFile(
      fileSystem,
      root,
      joinStoryPath(root, resourceLayout.scenePipelineFile),
      report,
      {
        kind: 'scenePipeline',
        label: '씬 파이프라인 명세',
        apply: overrideScenePipelinePlan,
      },
    );
    await loadPipelineFile(
      fileSystem,
      root,
      joinStoryPath(root, resourceLayout.novelPipelineFile),
      report,
      {
        kind: 'novelPipeline',
        label: '장편 파이프라인 명세',
        apply: overrideNovelPipelinePlan,
      },
    );
  }

  return report;
}

interface MutableReport {
  readonly applied: ResourceOverrideApplied[];
  readonly problems: ResourceOverrideProblem[];
}

async function loadPromptFiles(
  fileSystem: IFileSystem,
  root: StoryUri,
  directory: StoryUri,
  report: MutableReport,
): Promise<void> {
  const known: Set<string> = new Set(promptResourceKeys());
  const names: readonly string[] = await listDirectoryFileNames(fileSystem, directory, (name) =>
    name.endsWith('.md'),
  );

  for (const name of names) {
    const key: string = name.slice(0, -'.md'.length);
    const file: StoryUri = joinStoryPath(directory, name);

    if (!known.has(key)) {
      report.problems.push({ file, message: `알 수 없는 프롬프트 파일입니다: ${file.fsPath}` });
      continue;
    }

    try {
      promptResources.override(key, await readText(fileSystem, file));
      report.applied.push({ kind: 'prompt', key, file, root });
    } catch (error) {
      const detail: string = error instanceof PromptResourceError ? error.message : String(error);
      report.problems.push({
        file,
        message: `프롬프트 파일을 읽지 못했습니다: ${file.fsPath} (${detail})`,
      });
    }
  }
}

interface SchemaIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

type SchemaParseResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: { readonly issues: readonly SchemaIssue[] } };

interface SchemaLike<T> {
  safeParse(value: unknown): SchemaParseResult<T>;
}

interface JsonResource<T> {
  readonly kind: ResourceOverrideKind;
  readonly label: string;
  readonly schema: SchemaLike<T>;
  readonly apply: (value: T) => void;
}

async function loadJsonFile<T>(
  fileSystem: IFileSystem,
  root: StoryUri,
  file: StoryUri,
  report: MutableReport,
  resource: JsonResource<T>,
): Promise<void> {
  if (!(await fileSystem.exists(file))) {
    return;
  }

  const parsed: SchemaParseResult<T> = resource.schema.safeParse(await readJson(fileSystem, file));

  if (!parsed.success) {
    const issue: SchemaIssue | undefined = parsed.error.issues[0];
    const detail: string = [issue?.path.map(String).join('.'), issue?.message]
      .filter(Boolean)
      .join(' ');
    report.problems.push({
      file,
      message: `${resource.label}이 잘못되었습니다: ${file.fsPath} (${detail})`,
    });
    return;
  }

  resource.apply(parsed.data);
  report.applied.push({ kind: resource.kind, file, root });
}

interface PipelineResource {
  readonly kind: ResourceOverrideKind;
  readonly label: string;
  readonly apply: (spec: PipelineSpec) => unknown;
}

async function loadPipelineFile(
  fileSystem: IFileSystem,
  root: StoryUri,
  file: StoryUri,
  report: MutableReport,
  resource: PipelineResource,
): Promise<void> {
  if (!(await fileSystem.exists(file))) {
    return;
  }

  try {
    resource.apply(parsePipelineSpec(await readText(fileSystem, file)));
    report.applied.push({ kind: resource.kind, file, root });
  } catch (error) {
    const detail: string = error instanceof PipelineSpecError ? error.message : String(error);
    report.problems.push({
      file,
      message: `${resource.label}를 쓸 수 없습니다: ${file.fsPath} (${detail})`,
    });
  }
}

async function readText(fileSystem: IFileSystem, file: StoryUri): Promise<string> {
  return new TextDecoder().decode(await fileSystem.readFile(file));
}

async function readJson(fileSystem: IFileSystem, file: StoryUri): Promise<unknown> {
  try {
    return JSON.parse(await readText(fileSystem, file)) as unknown;
  } catch {
    return undefined;
  }
}
