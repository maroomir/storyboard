import { createHash } from 'node:crypto';
import { z } from 'zod';

import {
  sceneGroundingFieldKeys,
  type SceneFile,
  type SceneGrounding,
  type SceneGroundingFieldKey,
} from '#model/format/scene';

export interface SceneGroundingGap {
  readonly inputKey: string;
  readonly fields: readonly SceneGroundingFieldKey[];
}

const sceneGroundingGapFieldsSchema: z.ZodType<SceneGroundingFieldKey[]> = z.array(
  z.enum(sceneGroundingFieldKeys),
);

export function computeSceneGroundingInputKey(
  scene: SceneFile,
  characterNames: readonly string[],
): string {
  const grounding: SceneGrounding = scene.frontmatter.grounding ?? {};
  const source: string = JSON.stringify({
    body: scene.body,
    grounding: Object.fromEntries(
      sceneGroundingFieldKeys.flatMap((key) =>
        grounding[key] === undefined ? [] : [[key, grounding[key].trim()]],
      ),
    ),
    characterNames: [...characterNames].sort(),
  });

  return createHash('sha256').update(source).digest('hex');
}

export function parseSceneGroundingGapFields(
  data: unknown,
): readonly SceneGroundingFieldKey[] | undefined {
  const parsed: z.ZodSafeParseResult<SceneGroundingFieldKey[]> =
    sceneGroundingGapFieldsSchema.safeParse(data);
  return parsed.success ? parsed.data : undefined;
}
