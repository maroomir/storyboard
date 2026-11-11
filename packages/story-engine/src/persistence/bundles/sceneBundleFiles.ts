import {
  bundleFileRelativePath,
  parseBeatsFile,
  parseSceneDialogue,
  parseSceneStateFile,
  serializeBeatsFile,
  serializeSceneDialogue,
  serializeSceneStateFile,
  type Beat,
  type SceneDialogueRecord,
  type SceneStoryState,
} from '@storyboard/story-model';

import type { BundleFileAccess } from '#engine/persistence/bundles/bundleFileAccess';

export class SceneBundleFiles {
  public constructor(private readonly files: BundleFileAccess) {}

  public async readBeats(scenePath: string): Promise<readonly Beat[]> {
    const path: string = bundleFileRelativePath(scenePath, 'beats');
    const text: string | undefined = await this.files.readTextIfExists(path);

    return text === undefined ? [] : parseBeatsFile(text, path);
  }

  public async writeBeats(scenePath: string, beats: readonly Beat[]): Promise<void> {
    const path: string = bundleFileRelativePath(scenePath, 'beats');
    const text: string = serializeBeatsFile(beats);
    const isUnchanged: boolean = (await this.files.readTextIfExists(path)) === text;
    if (isUnchanged) {
      return;
    }

    await this.files.writeText(path, text);
  }

  public async readState(scenePath: string): Promise<SceneStoryState | undefined> {
    const path: string = bundleFileRelativePath(scenePath, 'state');
    const text: string | undefined = await this.files.readTextIfExists(path);

    return text === undefined ? undefined : parseSceneStateFile(text, path);
  }

  public async writeState(scenePath: string, state: SceneStoryState): Promise<void> {
    await this.files.writeText(
      bundleFileRelativePath(scenePath, 'state'),
      serializeSceneStateFile(state),
    );
  }

  public async readDialogue(scenePath: string): Promise<SceneDialogueRecord | undefined> {
    const text: string | undefined = await this.files.readTextIfExists(
      bundleFileRelativePath(scenePath, 'dialogue'),
    );

    return text === undefined ? undefined : parseSceneDialogue(text);
  }

  public async writeDialogue(scenePath: string, record: SceneDialogueRecord): Promise<void> {
    await this.files.writeText(
      bundleFileRelativePath(scenePath, 'dialogue'),
      serializeSceneDialogue(record),
    );
  }

  public async readSummary(scenePath: string): Promise<string | undefined> {
    return await this.files.readTextIfExists(bundleFileRelativePath(scenePath, 'summary'));
  }

  public async writeSummary(scenePath: string, summaryText: string): Promise<void> {
    await this.files.writeText(bundleFileRelativePath(scenePath, 'summary'), summaryText);
  }
}
