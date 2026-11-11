import type {
  InterviewAxesFile,
  InterviewWorkingModel,
  Statement,
  StoryUri,
} from '@storyboard/story-model';

export interface IInterviewRepository {
  loadAxes(workspaceRoot: StoryUri): Promise<InterviewAxesFile>;
  saveAxes(workspaceRoot: StoryUri, file: InterviewAxesFile): Promise<void>;
  loadWorkingModel(workspaceRoot: StoryUri, cardId: string): Promise<InterviewWorkingModel | undefined>;
  saveWorkingModel(workspaceRoot: StoryUri, model: InterviewWorkingModel): Promise<void>;
  deleteWorkingModels(workspaceRoot: StoryUri): Promise<void>;
  savePendingStatements(
    workspaceRoot: StoryUri,
    cardId: string,
    statements: readonly Statement[],
  ): Promise<void>;
}
