import type { SceneFileNameParts } from '#model/format/scene';

export interface SceneRename {
  readonly from: SceneFileNameParts;
  readonly to: SceneFileNameParts;
}
