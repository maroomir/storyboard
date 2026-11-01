import {
  emptyInterviewAxesFile,
  emptyNoteCandidateFile,
  getStoryboardProjectPaths,
  interviewWorkingModelRelativePath,
  joinStoryPath,
  noteCandidateFileSchema,
  readInterviewAxesFile,
  readInterviewWorkingModelFile,
  writeInterviewAxesFile,
  writeInterviewWorkingModelFile,
  type InterviewAxesFile,
  type InterviewWorkingModel,
  type NoteCandidateFile,
  type StoryboardProjectPaths,
  type StoryUri,
} from '@storyboard/story-model';

import type { IInterviewRepository } from '#engine/application/interviews/interviewRepository';
import type { IFileSystem } from '#engine/ports/fileSystem';

export class InterviewRepository implements IInterviewRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async loadAxes(workspaceRoot: StoryUri): Promise<InterviewAxesFile> {
    const uri: StoryUri = getStoryboardProjectPaths(workspaceRoot).interviewAxes;

    return (await this.fileSystem.exists(uri))
      ? await readInterviewAxesFile(uri, this.fileSystem)
      : emptyInterviewAxesFile;
  }

  public async saveAxes(workspaceRoot: StoryUri, file: InterviewAxesFile): Promise<void> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    await this.fileSystem.createDirectory(paths.interviewCacheDirectory);
    await writeInterviewAxesFile(paths.interviewAxes, this.fileSystem, file);
  }

  public async loadWorkingModel(
    workspaceRoot: StoryUri,
    cardId: string,
  ): Promise<InterviewWorkingModel | undefined> {
    const uri: StoryUri = this.workingModelUri(workspaceRoot, cardId);

    return (await this.fileSystem.exists(uri))
      ? await readInterviewWorkingModelFile(uri, this.fileSystem)
      : undefined;
  }

  public async saveWorkingModel(
    workspaceRoot: StoryUri,
    model: InterviewWorkingModel,
  ): Promise<void> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    await this.fileSystem.createDirectory(paths.interviewCacheDirectory);
    await writeInterviewWorkingModelFile(
      this.workingModelUri(workspaceRoot, model.cardId),
      this.fileSystem,
      model,
    );
  }

  public async deleteWorkingModels(workspaceRoot: StoryUri): Promise<void> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);

    if (!(await this.fileSystem.exists(paths.interviewCacheDirectory))) {
      return;
    }

    for (const [name] of await this.fileSystem.readDirectory(paths.interviewCacheDirectory)) {
      const isWorkingModel: boolean =
        name.endsWith('.json') && name !== 'axes.json' && name !== 'candidates.json';
      if (isWorkingModel) {
        await this.fileSystem.delete(joinStoryPath(paths.interviewCacheDirectory, name));
      }
    }
  }

  public async loadCandidates(workspaceRoot: StoryUri): Promise<NoteCandidateFile> {
    const uri: StoryUri = getStoryboardProjectPaths(workspaceRoot).interviewCandidates;

    if (!(await this.fileSystem.exists(uri))) {
      return emptyNoteCandidateFile;
    }

    return noteCandidateFileSchema.parse(
      JSON.parse(new TextDecoder().decode(await this.fileSystem.readFile(uri))),
    );
  }

  public async saveCandidates(workspaceRoot: StoryUri, file: NoteCandidateFile): Promise<void> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);

    if (file.sources.length === 0) {
      if (await this.fileSystem.exists(paths.interviewCandidates)) {
        await this.fileSystem.delete(paths.interviewCandidates);
      }
      return;
    }

    await this.fileSystem.createDirectory(paths.interviewCacheDirectory);
    await this.fileSystem.writeFile(
      paths.interviewCandidates,
      new TextEncoder().encode(`${JSON.stringify(file, null, 2)}\n`),
    );
  }

  private workingModelUri(workspaceRoot: StoryUri, cardId: string): StoryUri {
    return joinStoryPath(workspaceRoot, interviewWorkingModelRelativePath(cardId));
  }
}
