// 씬 하나가 목표로 삼을 원고 분량. 명시값 → 본문 마커 → 씬 시드 길이 기반 파생 순으로 정한다.
// 파생 단계가 없으면 목표가 아예 없는 씬은 프롬프트에 분량 제약이 걸리지 않아 원고가 무한정 늘어난다.
const DERIVED_SCENE_LENGTH_MIN = 2000;
const DERIVED_SCENE_LENGTH_MAX = 20000;

export function resolveSceneTargetLength(
  frontmatterTargetLength: number | undefined,
  sceneBody: string,
  lengthMultiplier?: number,
): number | undefined {
  if (frontmatterTargetLength !== undefined && frontmatterTargetLength > 0) {
    return frontmatterTargetLength;
  }

  const match = /\[목표 분량\]\s*\n?\s*(?:약\s*)?([\d,]+)\s*자/.exec(sceneBody);
  if (match?.[1]) {
    const parsed = Number.parseInt(match[1].replace(/,/g, ''), 10);

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

  const seedLength = sceneBody.trim().length;
  if (seedLength === 0) {
    return undefined;
  }

  return Math.min(
    DERIVED_SCENE_LENGTH_MAX,
    Math.max(DERIVED_SCENE_LENGTH_MIN, Math.round(seedLength * lengthMultiplier)),
  );
}
