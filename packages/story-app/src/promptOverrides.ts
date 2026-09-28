import { listDirectoryFileNames, type IFileSystem } from '@storyboard/story-engine';
import { PromptResourceError, promptResourceKeys, promptResources } from '@storyboard/story-ai';
import { joinStoryPath, type StoryUri } from '@storyboard/story-format';

export interface PromptOverrideApplied {
  readonly key: string;
  readonly file: StoryUri;
}

export interface PromptOverrideProblem {
  readonly file: StoryUri;
  readonly message: string;
}

export interface PromptOverrideReport {
  readonly applied: readonly PromptOverrideApplied[];
  readonly problems: readonly PromptOverrideProblem[];
}

// Lays the author's prompt files over the bundled text: every `<key>.md` in each directory, later
// directories winning (a workspace over the home). A file that names no prompt or cannot be parsed
// is reported and skipped, so one typo does not silence a whole generation run.
export async function loadPromptOverrides(
  fileSystem: IFileSystem,
  directories: readonly StoryUri[],
): Promise<PromptOverrideReport> {
  const known = new Set(promptResourceKeys());
  const applied: PromptOverrideApplied[] = [];
  const problems: PromptOverrideProblem[] = [];

  for (const directory of directories) {
    const names = await listDirectoryFileNames(fileSystem, directory, (name) =>
      name.endsWith('.md'),
    );

    for (const name of names) {
      const key = name.slice(0, -'.md'.length);
      const file = joinStoryPath(directory, name);

      if (!known.has(key)) {
        problems.push({ file, message: `알 수 없는 프롬프트 파일입니다: ${file.fsPath}` });
        continue;
      }

      try {
        promptResources.override(key, new TextDecoder().decode(await fileSystem.readFile(file)));
        applied.push({ key, file });
      } catch (error) {
        const detail = error instanceof PromptResourceError ? error.message : String(error);
        problems.push({
          file,
          message: `프롬프트 파일을 읽지 못했습니다: ${file.fsPath} (${detail})`,
        });
      }
    }
  }

  return { applied, problems };
}
