import { createHash } from 'node:crypto';
import { z } from 'zod';

import {
  sceneGroundingFieldKeys,
  type SceneFile,
  type SceneGroundingFieldKey,
} from '#model/format/scene';

// The fact-sheet fields a model was asked for and left blank, per scene. Asking again with the same
// scene and cast gets the same blank answer at the same price, so the gap is remembered until the
// input changes. It lives in the git-ignored cache: it is a cost record, not part of the work.
export interface SceneGroundingGap {
  readonly inputKey: string;
  readonly fields: readonly SceneGroundingFieldKey[];
}

const sceneGroundingGapsSchema = z.object({
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

// What the proposal reads: the scene's text, its fact sheet so far and the people in it. The
// fields and the names are put in one order first: a sheet an approval screen filled in and the
// same sheet read back from the card must give one key.
export function computeSceneGroundingInputKey(
  scene: SceneFile,
  characterNames: readonly string[],
): string {
  const grounding = scene.frontmatter.grounding ?? {};
  const source = JSON.stringify({
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

// A file that cannot be read is treated as empty: the worst case is one more proposal.
export function parseSceneGroundingGaps(raw: string): SceneGroundingGaps {
  try {
    const parsed = sceneGroundingGapsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.scenes : {};
  } catch {
    return {};
  }
}

export function serializeSceneGroundingGaps(gaps: SceneGroundingGaps): string {
  return `${JSON.stringify({ version: 1, scenes: gaps }, null, 2)}\n`;
}
