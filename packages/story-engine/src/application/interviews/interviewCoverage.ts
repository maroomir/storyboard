import {
  normalizeCardListText,
  sceneBeatText,
  type InterviewAxis,
  type InterviewBeatSituation,
  type InterviewOpenAxis,
  type InterviewTallies,
  type SceneBeat,
  type SceneFile,
  type SceneListItem,
  type StoryboardCard,
} from '@storyboard/story-model';

export function chooseUpcomingScenes(
  scenes: readonly SceneListItem[],
  limit: number,
  requestedStems: readonly string[] | undefined,
): SceneListItem[] {
  const ordered: SceneListItem[] = [...scenes].sort((a, b) => a.order - b.order);

  if (requestedStems !== undefined && requestedStems.length > 0) {
    return ordered.filter((scene) => requestedStems.includes(scene.stem));
  }

  const undrafted: SceneListItem[] = ordered.filter((scene) => scene.status !== 'ready');

  return (undrafted.length > 0 ? undrafted : ordered).slice(0, limit);
}

export function cardTokens(card: StoryboardCard): Set<string> {
  return new Set(
    [card.id, card.name, ...(card.aliases ?? [])].map((token) => normalizeCardListText(token)),
  );
}

export function otherPlaceTokens(
  card: StoryboardCard,
  backgrounds: readonly StoryboardCard[],
): Set<string> {
  return new Set(
    backgrounds
      .filter((other) => other.id !== card.id)
      .flatMap((other) => [...cardTokens(other)]),
  );
}

export interface BeatSituationOptions {
  readonly otherPlaceTokens?: ReadonlySet<string>;
}

function isPlaceClaimedByAnother(
  beat: SceneBeat,
  options: BeatSituationOptions,
): boolean {
  return (
    typeof beat !== 'string' &&
    beat.place !== undefined &&
    (options.otherPlaceTokens?.has(normalizeCardListText(beat.place)) ?? false)
  );
}

function beatMentionsCard(beat: SceneBeat, card: StoryboardCard, tokens: Set<string>): boolean {
  if (typeof beat === 'string') {
    return false;
  }

  const refs: readonly string[] =
    card.type === 'character' ? (beat.cast ?? []) : beat.place === undefined ? [] : [beat.place];

  return refs.some((ref) => tokens.has(normalizeCardListText(ref)));
}

function sceneMentionsCard(scene: SceneFile, card: StoryboardCard): boolean {
  return card.type === 'character'
    ? (scene.card.characters ?? []).includes(card.id)
    : scene.card.location === card.id;
}

function isBeatInvolved(
  beat: SceneBeat,
  card: StoryboardCard,
  tokens: Set<string>,
  isSceneWide: boolean,
  options: BeatSituationOptions,
): boolean {
  if (beatMentionsCard(beat, card, tokens)) {
    return true;
  }

  if (card.type === 'character') {
    const hasCoordinates: boolean =
      typeof beat !== 'string' && (beat.cast !== undefined || beat.place !== undefined);
    return !hasCoordinates && isSceneWide;
  }

  return isSceneWide && !isPlaceClaimedByAnother(beat, options);
}

export function collectBeatSituations(
  card: StoryboardCard,
  scenes: readonly SceneFile[],
  options: BeatSituationOptions = {},
): InterviewBeatSituation[] {
  const tokens: Set<string> = cardTokens(card);

  return scenes.flatMap((scene): InterviewBeatSituation[] => {
    const beats: readonly SceneBeat[] = scene.card.beats ?? [];
    const isSceneWide: boolean = sceneMentionsCard(scene, card);

    return beats.flatMap((beat, index): InterviewBeatSituation[] => {
      const isInvolved: boolean = isBeatInvolved(beat, card, tokens, isSceneWide, options);

      return isInvolved
        ? [
            {
              sceneStem: scene.stem,
              beatIndex: index,
              text: sceneBeatText(beat),
              cast: typeof beat === 'string' ? [] : (beat.cast ?? []),
              ...(typeof beat !== 'string' && beat.place !== undefined ? { place: beat.place } : {}),
              ...(typeof beat !== 'string' && beat.time !== undefined ? { time: beat.time } : {}),
            },
          ]
        : [];
    });
  });
}

export function axisTopWeight(tallies: InterviewTallies, axisId: string): number {
  return Math.max(0, ...Object.values(tallies[axisId] ?? {}));
}

export function isAxisDecided(
  tallies: InterviewTallies,
  axisId: string,
  minimumWeight: number,
): boolean {
  return axisTopWeight(tallies, axisId) >= minimumWeight;
}

export function unseenValueIds(tallies: InterviewTallies, axis: InterviewAxis): string[] {
  const seen: Readonly<Record<string, number>> = tallies[axis.id] ?? {};

  return axis.values.filter((value) => (seen[value.id] ?? 0) === 0).map((value) => value.id);
}

export function listOpenAxes(
  axes: readonly InterviewAxis[],
  tallies: InterviewTallies,
  minimumWeight: number,
  beatSituations: readonly InterviewBeatSituation[],
): InterviewOpenAxis[] {
  return axes
    .filter((axis) => !isAxisDecided(tallies, axis.id, minimumWeight))
    .map((axis) => ({ axisId: axis.id, axisLabel: axis.label, beatSituations }));
}

export function describeBeatSituation(situation: InterviewBeatSituation): string {
  const coordinates: string[] = [
    situation.cast.length > 0 ? `출연: ${situation.cast.join(', ')}` : undefined,
    situation.place === undefined ? undefined : `장소: ${situation.place}`,
    situation.time === undefined ? undefined : `시각: ${situation.time}`,
  ].filter((part): part is string => part !== undefined);

  return coordinates.length === 0
    ? `${situation.sceneStem}: ${situation.text}`
    : `${situation.sceneStem}: ${situation.text} (${coordinates.join(' / ')})`;
}
