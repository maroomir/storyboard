import type { BackgroundCard } from '#model/format/card';
import {
  sceneBeatText,
  sceneGroundingFieldKeys,
  type SceneBeat,
  type SceneFile,
  type SceneGrounding,
} from '#model/format/scene';

const incidentSeparator: string = ': ';

function firstBeatDetail(beats: readonly SceneBeat[] | undefined): {
  readonly text?: string;
  readonly place?: string;
  readonly time?: string;
} {
  const [first] = beats ?? [];
  if (first === undefined) {
    return {};
  }

  return typeof first === 'string'
    ? { text: first }
    : {
        text: sceneBeatText(first),
        ...(first.place === undefined ? {} : { place: first.place }),
        ...(first.time === undefined ? {} : { time: first.time }),
      };
}

function deriveIncident(scene: SceneFile): string | undefined {
  const parts: string[] = [scene.frontmatter.title, firstBeatDetail(scene.card.beats).text]
    .map((part) => part?.trim())
    .filter((part): part is string => part !== undefined && part.length > 0);

  return parts.length > 0 ? parts.join(incidentSeparator) : undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed: string | undefined = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

export function deriveSceneGrounding(
  scene: SceneFile,
  background: BackgroundCard | undefined,
): SceneGrounding {
  const firstBeat: ReturnType<typeof firstBeatDetail> = firstBeatDetail(scene.card.beats);
  const derived: SceneGrounding = {
    incident: deriveIncident(scene),
    place: firstBeat.place ?? background?.name,
    time: firstBeat.time,
  };

  return Object.fromEntries(
    sceneGroundingFieldKeys.flatMap((key) => {
      const value: string | undefined = nonEmpty(derived[key]);
      return value === undefined ? [] : [[key, value]];
    }),
  );
}
