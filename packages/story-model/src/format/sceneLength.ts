const DERIVED_SCENE_LENGTH_MIN: number = 2000;
const DERIVED_SCENE_LENGTH_MAX: number = 20000;

export function resolveSceneTargetLength(
  frontmatterTargetLength: number | undefined,
  sceneBody: string,
  lengthMultiplier?: number,
): number | undefined {
  if (frontmatterTargetLength !== undefined && frontmatterTargetLength > 0) {
    return frontmatterTargetLength;
  }

  const match: RegExpExecArray | null = /\[목표 분량\]\s*\n?\s*(?:약\s*)?([\d,]+)\s*자/.exec(
    sceneBody,
  );
  if (match?.[1]) {
    const parsed: number = Number.parseInt(match[1].replace(/,/g, ''), 10);

    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return deriveSceneTargetLength(sceneBody, lengthMultiplier);
}

function deriveSceneTargetLength(
  sceneBody: string,
  lengthMultiplier: number | undefined,
): number | undefined {
  if (lengthMultiplier === undefined || lengthMultiplier <= 0) {
    return undefined;
  }

  const seedLength: number = sceneBody.trim().length;
  if (seedLength === 0) {
    return undefined;
  }

  return Math.min(
    DERIVED_SCENE_LENGTH_MAX,
    Math.max(DERIVED_SCENE_LENGTH_MIN, Math.round(seedLength * lengthMultiplier)),
  );
}
