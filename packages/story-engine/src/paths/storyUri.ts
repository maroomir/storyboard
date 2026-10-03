// StoryUri lives in story-model because the file codecs there take a uri too — a second
// definition would leave the two packages unable to describe the same value.
export {
  joinStoryPath,
  NodeUri,
  type StoryUri,
  type StoryWorkspaceFolder,
} from '@storyboard/story-model';
