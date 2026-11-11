import type { Beat, SceneHeader } from '#model/element/scene';

interface CardReferringLine {
  readonly value: string;
  readonly about?: string;
  readonly knownBy?: readonly string[];
}

export interface CardLineRemoval<TLine extends CardReferringLine> {
  readonly lines: readonly TLine[];
  readonly dropped: readonly TLine[];
  readonly hasChanged: boolean;
}

function withoutWitness<TLine extends CardReferringLine>(line: TLine, cardId: string): TLine {
  const knownBy: readonly string[] = (line.knownBy ?? []).filter((id) => id !== cardId);
  const { knownBy: _knownBy, ...rest } = line;

  return (knownBy.length === 0 ? rest : { ...rest, knownBy }) as TLine;
}

export function removeCardFromLines<TLine extends CardReferringLine>(
  lines: readonly TLine[],
  cardId: string,
  options: { readonly shouldDropAboutLines: boolean },
): CardLineRemoval<TLine> {
  const kept: TLine[] = [];
  const dropped: TLine[] = [];

  for (const line of lines) {
    const isAboutTheCard: boolean = options.shouldDropAboutLines && line.about === cardId;
    const isWitnessed: boolean = line.knownBy?.includes(cardId) ?? false;
    const isOnlyWitness: boolean = isWitnessed && line.knownBy?.length === 1;

    if (isAboutTheCard || isOnlyWitness) {
      dropped.push(line);
    } else {
      kept.push(isWitnessed ? withoutWitness(line, cardId) : line);
    }
  }

  const hasChanged: boolean =
    dropped.length > 0 || lines.some((line) => line.knownBy?.includes(cardId) ?? false);
  return { lines: kept, dropped, hasChanged };
}

function withoutCast<TItem extends { readonly cast?: readonly string[]; readonly place?: string }>(
  item: TItem,
  cardId: string,
): TItem {
  const cast: readonly string[] | undefined = item.cast?.filter((id) => id !== cardId);
  const { cast: _cast, place, ...rest } = item;

  return {
    ...rest,
    ...(cast === undefined || cast.length === 0 ? {} : { cast }),
    ...(place === undefined || place === cardId ? {} : { place }),
  } as TItem;
}

function isPlacedIn(
  item: { readonly cast?: readonly string[]; readonly place?: string },
  cardId: string,
): boolean {
  return (item.cast?.includes(cardId) ?? false) || item.place === cardId;
}

export interface SceneCardRemoval {
  readonly header: SceneHeader;
  readonly beats: readonly Beat[];
  readonly hasChanged: boolean;
}

export function removeCardFromScene(
  header: SceneHeader,
  beats: readonly Beat[],
  cardId: string,
): SceneCardRemoval {
  const hasChanged: boolean =
    isPlacedIn(header, cardId) || beats.some((beat) => isPlacedIn(beat, cardId));

  return hasChanged
    ? {
        header: withoutCast(header, cardId),
        beats: beats.map((beat) => withoutCast(beat, cardId)),
        hasChanged,
      }
    : { header, beats, hasChanged };
}
