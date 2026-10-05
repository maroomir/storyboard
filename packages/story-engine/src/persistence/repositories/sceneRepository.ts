import type { StoryUri, SceneFile, SceneGrounding } from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { ISceneRepository } from '#engine/application/drafts/draftRepositories';
import { applySceneBeats, applySceneGrounding, readSceneFile } from '@storyboard/story-model';
export class SceneRepository implements ISceneRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async read(uri: StoryUri, fileName: string): Promise<SceneFile> {
    return await readSceneFile(uri, this.fileSystem, fileName);
  }

  public async writeGrounding(uri: StoryUri, grounding: SceneGrounding): Promise<void> {
    await this.rewriteScene(uri, (rawScene) => applySceneGrounding(rawScene, grounding));
  }

  public async writeBeats(uri: StoryUri, beats: readonly string[]): Promise<void> {
    await this.rewriteScene(uri, (rawScene) => applySceneBeats(rawScene, beats));
  }

  // NOTE: 내용이 같으면 쓰지 않는다. 다시 쓰면 카드의 수정 시각만 새로워져, 그대로 둔 초안이
  // «카드보다 오래된 초안»으로 세어진다(씬 목록의 stale 판정이 수정 시각 비교다).
  private async rewriteScene(uri: StoryUri, rewrite: (rawScene: string) => string): Promise<void> {
    const rawScene = new TextDecoder().decode(await this.fileSystem.readFile(uri));
    const rewritten = rewrite(rawScene);

    if (rewritten !== rawScene) {
      await this.fileSystem.writeFile(uri, new TextEncoder().encode(rewritten));
    }
  }
}
