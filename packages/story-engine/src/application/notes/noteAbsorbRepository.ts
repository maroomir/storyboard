import type { StoryUri } from '@storyboard/story-format';

import type { NoteBundle } from '#engine/shared/noteAbsorb';

// What the note import keeps in the workspace's cache. None of it is tracked by git: the notes
// stay the author's, and only what they turn into is written to the workspace proper.
export interface INoteAbsorbRepository {
  saveBundle(workspaceRoot: StoryUri, bundle: NoteBundle): Promise<void>;
}
