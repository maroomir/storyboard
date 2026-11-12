import type { BackgroundCard } from '#model/format/card';
import type { SceneBeat, SceneFile } from '#model/format/scene';

function placeTokensOf(background: BackgroundCard): ReadonlySet<string> {
  return new Set([background.id, background.name, ...(background.aliases ?? [])].map((token) => token.trim()));
}

function beatCastAt(beat: SceneBeat, tokens: ReadonlySet<string>): readonly string[] {
  const isAtPlace: boolean = typeof beat !== 'string' && beat.place !== undefined && tokens.has(beat.place.trim());
  return isAtPlace && typeof beat !== 'string' ? (beat.cast ?? []) : [];
}

export function listCharactersAtPlace(
  background: BackgroundCard,
  scenes: readonly SceneFile[],
): string[] {
  const tokens: ReadonlySet<string> = placeTokensOf(background);
  const ordered: readonly SceneFile[] = [...scenes].sort((left, right) => left.order - right.order);
  const characters: string[] = ordered.flatMap((scene) => [
    ...(scene.card.location === background.id ? (scene.card.characters ?? []) : []),
    ...(scene.card.beats ?? []).flatMap((beat) => beatCastAt(beat, tokens)),
  ]);

  return [...new Set(characters)];
}

export function withCharactersAtPlace(
  background: BackgroundCard,
  scenes: readonly SceneFile[],
): BackgroundCard {
  return { ...background, characterIds: listCharactersAtPlace(background, scenes) };
}
