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

interface SceneGroundingGapsPayload {
  version: 1;
  scenes: Record<string, { inputKey: string; fields: SceneGroundingFieldKey[] }>;
}

const sceneGroundingGapsSchema: z.ZodType<SceneGroundingGapsPayload> = z.object({
  version: z.literal(1),
  scenes: z.record(
    z.string(),
    z.object({
      inputKey: z.string().min(1),
      fields: z.array(z.enum(sceneGroundingFieldKeys)),
    }),
  ),
});

export type SceneGroundingGaps = Readonly<Record<string, SceneGroundingGap>>;

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

export function parseSceneGroundingGaps(raw: string): SceneGroundingGaps {
  try {
    const parsed: z.ZodSafeParseResult<SceneGroundingGapsPayload> =
      sceneGroundingGapsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.scenes : {};
  } catch {
    return {};
  }
}

export function serializeSceneGroundingGaps(gaps: SceneGroundingGaps): string {
  return `${JSON.stringify({ version: 1, scenes: gaps }, null, 2)}\n`;
}
