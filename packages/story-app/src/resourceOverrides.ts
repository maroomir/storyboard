import { listDirectoryFileNames, type IFileSystem } from '@storyboard/story-engine';
import { PromptResourceError, promptResourceKeys, promptResources } from '@storyboard/story-ai';
import {
  craftContractOverrideSchema,
  joinStoryPath,
  overrideCraftContractDefaults,
  resetCraftContractDefaults,
  type StoryUri,
} from '@storyboard/story-format';

// What an author may lay over the bundled defaults, and where inside a resource root (the home
// `~/.storyboard` or a workspace's `.storyboard`) each piece lives. Later roots win.
export const resourceLayout = {
  promptDirectory: 'prompts',
  craftContractFile: 'craftContract.json',
} as const;

export type ResourceOverrideKind = 'prompt' | 'craftContract';

export interface ResourceOverrideApplied {
  readonly kind: ResourceOverrideKind;
  readonly key?: string;
  readonly file: StoryUri;
}

export interface ResourceOverrideProblem {
  readonly file: StoryUri;
  readonly message: string;
}

export interface ResourceOverrideReport {
  readonly applied: readonly ResourceOverrideApplied[];
  readonly problems: readonly ResourceOverrideProblem[];
}

// Applies the author's files in every root over the bundled defaults, lowest precedence first. A
// file that names nothing known or cannot be parsed is reported and skipped, so one typo does not
// silence a whole generation run. Loading starts from the bundled state, so a second load (a
// different workspace) never carries the previous one's files.
export async function loadResourceOverrides(
  fileSystem: IFileSystem,
  roots: readonly StoryUri[],
): Promise<ResourceOverrideReport> {
  const applied: ResourceOverrideApplied[] = [];
  const problems: ResourceOverrideProblem[] = [];
  const report = { applied, problems };

  promptResources.clearOverrides();
  resetCraftContractDefaults();

  for (const root of roots) {
    await loadPromptFiles(fileSystem, joinStoryPath(root, resourceLayout.promptDirectory), report);
    await loadCraftContractFile(
      fileSystem,
      joinStoryPath(root, resourceLayout.craftContractFile),
      report,
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
  directory: StoryUri,
  report: MutableReport,
): Promise<void> {
  const known = new Set(promptResourceKeys());
  const names = await listDirectoryFileNames(fileSystem, directory, (name) => name.endsWith('.md'));

  for (const name of names) {
    const key = name.slice(0, -'.md'.length);
    const file = joinStoryPath(directory, name);

    if (!known.has(key)) {
      report.problems.push({ file, message: `알 수 없는 프롬프트 파일입니다: ${file.fsPath}` });
      continue;
    }

    try {
      promptResources.override(key, await readText(fileSystem, file));
      report.applied.push({ kind: 'prompt', key, file });
    } catch (error) {
      const detail = error instanceof PromptResourceError ? error.message : String(error);
      report.problems.push({
        file,
        message: `프롬프트 파일을 읽지 못했습니다: ${file.fsPath} (${detail})`,
      });
    }
  }
}

async function loadCraftContractFile(
  fileSystem: IFileSystem,
  file: StoryUri,
  report: MutableReport,
): Promise<void> {
  if (!(await fileSystem.exists(file))) {
    return;
  }

  const parsed = craftContractOverrideSchema.strict().safeParse(await readJson(fileSystem, file));

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    report.problems.push({
      file,
      message:
        `작법 계약 파일이 잘못되었습니다: ${file.fsPath} (${issue?.path.join('.') ?? ''} ${issue?.message ?? ''})`.replace(
          '( ',
          '(',
        ),
    });
    return;
  }

  overrideCraftContractDefaults(parsed.data);
  report.applied.push({ kind: 'craftContract', file });
}

async function readText(fileSystem: IFileSystem, file: StoryUri): Promise<string> {
  return new TextDecoder().decode(await fileSystem.readFile(file));
}

// A file that is not JSON at all is reported as an invalid file, the same as one with a bad field.
async function readJson(fileSystem: IFileSystem, file: StoryUri): Promise<unknown> {
  try {
    return JSON.parse(await readText(fileSystem, file)) as unknown;
  } catch {
    return undefined;
  }
}
